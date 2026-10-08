package com.formfiberstudio.creatortimeline;

import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.media.ExifInterface;
import android.net.Uri;
import android.provider.MediaStore;
import android.provider.OpenableColumns;

import androidx.core.content.IntentCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;
import java.io.InputStream;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

// "Share to app": photos picked in the phone's gallery and sent with Share >
// Creator Timeline arrive here as an ACTION_SEND / ACTION_SEND_MULTIPLE intent
// (see the two intent filters in AndroidManifest.xml). This only collects the
// content:// URIs and works out when each photo was taken; the web side then
// opens Import Photos with them, reading the pictures themselves through
// DateFilteredPhotoPickerPlugin's getThumbnail / getPhotoData -- the same
// calls the native picker uses -- so a shared photo needs no permission of
// its own beyond the one-time read grant the Share carries.
//
// The web page is loaded from a URL, so on a cold start it is not running yet
// when the intent arrives: the URIs wait here until getSharedPhotos() asks
// for them. When the app is already open, handleOnNewIntent also fires a
// "sharedPhotos" event, kept until the page is listening.
@CapacitorPlugin(name = "SharedPhotos")
public class SharedPhotosPlugin extends Plugin {

    // Waiting for the web side, in the order shared. Keyed by URI string so a
    // photo shared twice is still one photo. Guarded by itself.
    private final Map<String, Uri> pending = new LinkedHashMap<>();

    @Override
    public void load() {
        Intent launch = getActivity().getIntent();
        if (collectFrom(launch)) {
            // Taken: if the activity is ever recreated it would otherwise be
            // handed this same Share again.
            getActivity().setIntent(new Intent(Intent.ACTION_MAIN));
        }
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (collectFrom(intent)) {
            JSObject event = new JSObject();
            event.put("count", pendingCount());
            notifyListeners("sharedPhotos", event, true);
        }
    }

    // Hands over everything waiting, once, with each photo's date.
    @PluginMethod
    public void getSharedPhotos(PluginCall call) {
        List<Uri> batch;
        synchronized (pending) {
            batch = new ArrayList<>(pending.values());
            pending.clear();
        }

        ContentResolver resolver = getContext().getContentResolver();
        JSArray photos = new JSArray();
        for (Uri uri : batch) {
            photos.put(describe(resolver, uri));
        }

        JSObject ret = new JSObject();
        ret.put("photos", photos);
        call.resolve(ret);
    }

    private int pendingCount() {
        synchronized (pending) {
            return pending.size();
        }
    }

    // Takes the images out of a Share intent. True if it was one that carried
    // any. The picture list can sit in EXTRA_STREAM (one Uri or a list) or only
    // in the ClipData, depending on the app that shared it.
    private boolean collectFrom(Intent intent) {
        if (intent == null) return false;
        String action = intent.getAction();
        if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) return false;

        List<Uri> found = new ArrayList<>();
        Uri single = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri.class);
        if (single != null) found.add(single);
        ArrayList<Uri> many = IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri.class);
        if (many != null) found.addAll(many);
        ClipData clip = intent.getClipData();
        if (clip != null) {
            for (int i = 0; i < clip.getItemCount(); i++) {
                Uri uri = clip.getItemAt(i).getUri();
                if (uri != null) found.add(uri);
            }
        }

        ContentResolver resolver = getContext().getContentResolver();
        boolean any = false;
        synchronized (pending) {
            for (Uri uri : found) {
                // A provider that doesn't say what it is serving is given the
                // benefit of the doubt -- the intent filter only lets images in.
                String type = resolver.getType(uri);
                if (type != null && !type.startsWith("image/")) continue;
                pending.put(uri.toString(), uri);
                any = true;
            }
        }
        return any;
    }

    // One shared photo as the web side wants it: where it is, what it is called,
    // and when it was taken -- with how far to trust that date (dateSource):
    //   "exif"       the camera's own capture time, read from the picture
    //   "mediastore" the gallery's recorded capture time
    //   "modified"   only the file's last-changed time (screenshots, saved copies)
    //   "none"       nothing at all; dateTaken is left out
    private JSObject describe(ContentResolver resolver, Uri uri) {
        JSObject photo = new JSObject();
        photo.put("uri", uri.toString());

        long galleryTaken = 0;
        long modified = 0;
        String displayName = null;
        // No fixed column list: a provider that lacks one of these just has no
        // such column, where asking for it by name can throw.
        try (Cursor cursor = resolver.query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int nameCol = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (nameCol >= 0) displayName = cursor.getString(nameCol);
                int takenCol = cursor.getColumnIndex(MediaStore.Images.Media.DATE_TAKEN);
                if (takenCol >= 0 && !cursor.isNull(takenCol)) galleryTaken = cursor.getLong(takenCol);
                // MediaStore keeps its modified time in whole SECONDS; a
                // document provider's "last_modified" is in milliseconds.
                int dateModifiedCol = cursor.getColumnIndex(MediaStore.Images.Media.DATE_MODIFIED);
                if (dateModifiedCol >= 0 && !cursor.isNull(dateModifiedCol)) {
                    modified = cursor.getLong(dateModifiedCol) * 1000;
                } else {
                    int lastModifiedCol = cursor.getColumnIndex("last_modified");
                    if (lastModifiedCol >= 0 && !cursor.isNull(lastModifiedCol)) modified = cursor.getLong(lastModifiedCol);
                }
            }
        } catch (Exception ignored) {
            // A provider that won't be queried still serves the picture itself.
        }
        if (displayName != null) photo.put("displayName", displayName);

        long exifTaken = readExifDate(resolver, uri);
        if (exifTaken > 0) {
            photo.put("dateTaken", exifTaken);
            photo.put("dateSource", "exif");
        } else if (galleryTaken > 0) {
            photo.put("dateTaken", galleryTaken);
            photo.put("dateSource", "mediastore");
        } else if (modified > 0) {
            photo.put("dateTaken", modified);
            photo.put("dateSource", "modified");
        } else {
            photo.put("dateSource", "none");
        }
        return photo;
    }

    // The capture time inside the picture, or 0. EXIF stores it as local wall
    // time with no zone, so it is read as the phone's own local time -- the
    // same reading the web side's exifr makes -- and the date part therefore
    // lands on the day the photo was taken. (The picture's "last edited" time,
    // TAG_DATETIME, is left out on purpose: after any edit it is the edit's
    // date, not the photo's.)
    private long readExifDate(ContentResolver resolver, Uri uri) {
        try (InputStream in = resolver.openInputStream(uri)) {
            if (in == null) return 0;
            ExifInterface exif = new ExifInterface(in);
            String raw = exif.getAttribute(ExifInterface.TAG_DATETIME_ORIGINAL);
            if (raw == null) raw = exif.getAttribute(ExifInterface.TAG_DATETIME_DIGITIZED);
            if (raw == null) return 0;
            SimpleDateFormat format = new SimpleDateFormat("yyyy:MM:dd HH:mm:ss", Locale.US);
            format.setLenient(false);
            Date parsed = format.parse(raw.trim());
            return parsed != null ? parsed.getTime() : 0;
        } catch (IOException | ParseException | RuntimeException e) {
            // No EXIF, an unreadable format, or the all-zero placeholder some
            // cameras write -- fall through to the gallery's own date.
            return 0;
        }
    }
}
