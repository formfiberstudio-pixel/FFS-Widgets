package com.formfiberstudio.creatortimeline;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;

// The whole reason this widget is being wrapped as a native app instead of
// staying a plain PWA: a website has no API to query or pre-filter the
// device's photo library, so the web-only Import Photos flow is stuck
// handing the user the OS's full, unfiltered system Photo Picker no matter
// what date range they're importing into. This plugin queries MediaStore
// directly -- the same thing Mandalart does -- so the JS side can build its
// own picker showing only photos actually taken (or, failing that, last
// modified) within the requested day/week.
// Two separate aliases, not one alias listing both permission strings --
// Capacitor's getPermissionState() requires EVERY string under an alias to
// be granted (AND, not OR), and READ_MEDIA_IMAGES doesn't exist at all
// below API 33 (pm/checkSelfPermission just reports it as perpetually
// ungranted there), so a single combined alias could never report GRANTED
// on any pre-13 device even after the real applicable permission
// (READ_EXTERNAL_STORAGE) was granted. activeAlias() below picks whichever
// one actually applies to the OS this is running on.
@CapacitorPlugin(
    name = "DateFilteredPhotoPicker",
    permissions = {
        @Permission(alias = "photosModern", strings = { Manifest.permission.READ_MEDIA_IMAGES }),
        @Permission(alias = "photosLegacy", strings = { Manifest.permission.READ_EXTERNAL_STORAGE }),
    }
)
public class DateFilteredPhotoPickerPlugin extends Plugin {

    // Matches imageResize.js's resizeImageForUpload defaults -- same
    // pipeline, same cap (Vercel's 4.5MB request body limit), just done
    // natively here instead of via <canvas> since these bytes never pass
    // through a File/Blob on the JS side at all.
    private static final int FULL_MAX_DIM = 1800;
    private static final int FULL_QUALITY = 82;
    // Small enough for a fast-loading picker grid, big enough to actually
    // tell photos apart.
    private static final int THUMB_MAX_DIM = 240;
    private static final int THUMB_QUALITY = 60;

    private String activeAlias() {
        return Build.VERSION.SDK_INT >= 33 ? "photosModern" : "photosLegacy";
    }

    @PluginMethod
    public void queryByDateRange(PluginCall call) {
        String alias = activeAlias();
        if (getPermissionState(alias) != PermissionState.GRANTED) {
            requestPermissionForAlias(alias, call, "photosPermCallback");
            return;
        }
        doQuery(call);
    }

    @PermissionCallback
    private void photosPermCallback(PluginCall call) {
        if (getPermissionState(activeAlias()) == PermissionState.GRANTED) {
            doQuery(call);
        } else {
            call.reject("Photo library permission was denied");
        }
    }

    private void doQuery(PluginCall call) {
        long startMillis = call.getLong("startMillis", 0L);
        Long endMillisArg = call.getLong("endMillis");
        long endMillis = endMillisArg != null ? endMillisArg : Long.MAX_VALUE;

        // DATE_TAKEN is null for a fair number of real photos (screenshots,
        // anything re-saved by another app that stripped EXIF) -- for
        // those, fall back to DATE_MODIFIED, the same "trust the file's own
        // timestamp when there's no real capture date" call the web-side
        // EXIF fallback already makes. DATE_MODIFIED is stored in whole
        // SECONDS, not millis, unlike everything else in MediaStore -- easy
        // place to silently be off by 1000x if you don't convert it.
        String selection =
            "(" + MediaStore.Images.Media.DATE_TAKEN + " BETWEEN ? AND ?) OR "
                + "(" + MediaStore.Images.Media.DATE_TAKEN + " IS NULL AND "
                + MediaStore.Images.Media.DATE_MODIFIED + " BETWEEN ? AND ?)";
        String[] selectionArgs = {
            String.valueOf(startMillis), String.valueOf(endMillis),
            String.valueOf(startMillis / 1000), String.valueOf(endMillis / 1000),
        };

        String[] projection = {
            MediaStore.Images.Media._ID,
            MediaStore.Images.Media.DATE_TAKEN,
            MediaStore.Images.Media.DATE_MODIFIED,
            MediaStore.Images.Media.DISPLAY_NAME,
        };

        ContentResolver resolver = getContext().getContentResolver();
        JSArray results = new JSArray();

        try (Cursor cursor = resolver.query(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            projection,
            selection,
            selectionArgs,
            MediaStore.Images.Media.DATE_TAKEN + " DESC"
        )) {
            if (cursor != null) {
                int idCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media._ID);
                int dateTakenCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_TAKEN);
                int dateModifiedCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_MODIFIED);
                int nameCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME);

                while (cursor.moveToNext()) {
                    long id = cursor.getLong(idCol);
                    Uri uri = ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id);
                    long dateTaken = cursor.isNull(dateTakenCol) ? cursor.getLong(dateModifiedCol) * 1000 : cursor.getLong(dateTakenCol);

                    JSObject photo = new JSObject();
                    photo.put("uri", uri.toString());
                    photo.put("dateTaken", dateTaken);
                    photo.put("displayName", cursor.getString(nameCol));
                    results.put(photo);
                }
            }
        } catch (Exception e) {
            call.reject("MediaStore query failed: " + e.getMessage());
            return;
        }

        JSObject ret = new JSObject();
        ret.put("photos", results);
        call.resolve(ret);
    }

    @PluginMethod
    public void getThumbnail(PluginCall call) {
        // Static preview only -- a still frame is the normal, expected
        // thumbnail for a GIF (same as Notion's or any gallery app's own
        // grid), so this always goes through the regular Bitmap decode
        // below rather than the raw-bytes GIF path getPhotoData uses.
        resolveEncodedImage(call, THUMB_MAX_DIM, THUMB_QUALITY, false);
    }

    @PluginMethod
    public void getPhotoData(PluginCall call) {
        resolveEncodedImage(call, FULL_MAX_DIM, FULL_QUALITY, true);
    }

    private void resolveEncodedImage(PluginCall call, int maxDim, int quality, boolean preserveGifAnimation) {
        String uriStr = call.getString("uri");
        if (uriStr == null) {
            call.reject("Missing uri");
            return;
        }

        Uri uri = Uri.parse(uriStr);
        ContentResolver resolver = getContext().getContentResolver();

        try {
            // Animated GIFs can't survive the Bitmap decode below -- it
            // only ever captures a single frame, and Bitmap.compress has
            // no GIF encoder at all (JPEG/PNG/WEBP only), so resizing one
            // here would silently flatten it to a static frame -- the
            // actual cause of uploaded GIFs coming out non-moving on
            // Notion's side. For the real upload (not the picker grid's
            // own static thumbnail), the original bytes are read and
            // returned untouched instead, same as the web upload path's
            // own GIF passthrough (imageResize.js).
            if (preserveGifAnimation && "image/gif".equals(resolver.getType(uri))) {
                try (InputStream gifStream = resolver.openInputStream(uri)) {
                    if (gifStream == null) {
                        call.reject("Could not open GIF");
                        return;
                    }
                    ByteArrayOutputStream gifOut = new ByteArrayOutputStream();
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = gifStream.read(buf)) != -1) gifOut.write(buf, 0, n);
                    String gifBase64 = Base64.encodeToString(gifOut.toByteArray(), Base64.NO_WRAP);
                    JSObject gifRet = new JSObject();
                    gifRet.put("base64", "data:image/gif;base64," + gifBase64);
                    call.resolve(gifRet);
                    return;
                }
            }

            // Decode bounds only first -- decoding a 12MP original into
            // memory just to immediately shrink it would be wasteful for
            // every photo in what could be a grid of dozens.
            BitmapFactory.Options boundsOptions = new BitmapFactory.Options();
            boundsOptions.inJustDecodeBounds = true;
            try (InputStream boundsStream = resolver.openInputStream(uri)) {
                BitmapFactory.decodeStream(boundsStream, null, boundsOptions);
            }

            int sampleSize = 1;
            int longSide = Math.max(boundsOptions.outWidth, boundsOptions.outHeight);
            while (longSide / (sampleSize * 2) >= maxDim) sampleSize *= 2;

            BitmapFactory.Options decodeOptions = new BitmapFactory.Options();
            decodeOptions.inSampleSize = sampleSize;
            Bitmap bitmap;
            try (InputStream stream = resolver.openInputStream(uri)) {
                bitmap = BitmapFactory.decodeStream(stream, null, decodeOptions);
            }
            if (bitmap == null) {
                call.reject("Could not decode image");
                return;
            }

            // inSampleSize only lands on powers of 2 -- one more precise
            // pass to actually hit maxDim on the long edge.
            int w = bitmap.getWidth(), h = bitmap.getHeight();
            int scaledLongSide = Math.max(w, h);
            if (scaledLongSide > maxDim) {
                float scale = (float) maxDim / scaledLongSide;
                bitmap = Bitmap.createScaledBitmap(bitmap, Math.round(w * scale), Math.round(h * scale), true);
            }

            bitmap = applyExifRotation(bitmap, uri, resolver);

            ByteArrayOutputStream out = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.JPEG, quality, out);
            String base64 = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);

            JSObject ret = new JSObject();
            ret.put("base64", "data:image/jpeg;base64," + base64);
            call.resolve(ret);
        } catch (IOException e) {
            call.reject("Failed to read photo: " + e.getMessage());
        }
    }

    // BitmapFactory doesn't auto-rotate for EXIF orientation the way
    // <canvas>'s imageOrientation:'from-image' does on the web side --
    // without this, anything shot in portrait comes out sideways once the
    // orientation tag is dropped by re-encoding.
    private Bitmap applyExifRotation(Bitmap bitmap, Uri uri, ContentResolver resolver) {
        int orientation = ExifInterface.ORIENTATION_NORMAL;
        try (InputStream exifStream = resolver.openInputStream(uri)) {
            if (exifStream != null) {
                ExifInterface exif = new ExifInterface(exifStream);
                orientation = exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
            }
        } catch (IOException ignored) {
            // No EXIF to read -- leave the bitmap as decoded.
        }

        int degrees;
        switch (orientation) {
            case ExifInterface.ORIENTATION_ROTATE_90: degrees = 90; break;
            case ExifInterface.ORIENTATION_ROTATE_180: degrees = 180; break;
            case ExifInterface.ORIENTATION_ROTATE_270: degrees = 270; break;
            default: return bitmap;
        }
        Matrix matrix = new Matrix();
        matrix.postRotate(degrees);
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), matrix, true);
    }
}
