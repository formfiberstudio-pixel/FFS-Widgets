// Downscales+recompresses a photo client-side before it ever leaves the
// browser. A phone photo can easily be 5-15MB; Vercel serverless functions
// hard-cap the incoming request body at 4.5MB regardless of how the body
// is parsed, so sending originals would fail outright for exactly the
// photos this exists to handle. imageOrientation: 'from-image' asks the
// browser to bake in the EXIF rotation flag so a photo shot in portrait
// doesn't come out sideways once EXIF is stripped by re-encoding.
//
// Shared by ImportPhotosPanel (backlogging a batch of photos) and
// LogNoteEditor (adding a single photo to an existing text-only entry) --
// both eventually POST to the same /api/backlog-photo endpoint, which is
// what the 4.5MB cap applies to.
export async function resizeImageForUpload(file, maxDim = 1800, quality = 0.82) {
  // An animated GIF can't survive this pipeline: createImageBitmap only
  // ever decodes a single frame, and canvas.toBlob has no GIF encoder at
  // all (png/jpeg/webp only) -- resizing one here would silently flatten
  // it to one static frame, which is exactly the "uploaded GIFs don't
  // move" bug this guards against. Passed straight through as its own
  // original bytes instead; Notion hosts animated GIFs natively, and the
  // content-type sniffing on the receiving end (backlog-photo.js) already
  // treats type as something to detect, not assume, so it only needs the
  // right bytes here to do the right thing with them.
  if (file.type === 'image/gif') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  let { width, height } = bitmap;
  if (width > maxDim || height > maxDim) {
    const scale = maxDim / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('Could not encode image'));
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    }, 'image/jpeg', quality);
  });
}
