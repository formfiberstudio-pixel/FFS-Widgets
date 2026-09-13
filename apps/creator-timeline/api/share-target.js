import Busboy from 'busboy';
import sharp from 'sharp';
import exifr from 'exifr';
import crypto from 'node:crypto';
import { saveSharedPhotos } from './_lib/sharedPhotoStore.js';

// Registered as this tenant's PWA share_target action (see manifest.js) --
// Android's Share sheet POSTs whatever photos the user picked here as
// multipart/form-data. There's no React app alive to hand them to yet
// (this request opens a brand new tab), so the only option is: read the
// files, stash them, and 303-redirect into the app with a token it can
// fetch them by (see get-shared-photos.js). Vercel doesn't apply its own
// bodyParser here since it's disabled below -- Busboy reads the raw
// multipart stream directly.
export const config = {
  api: {
    bodyParser: false,
  },
};

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({ headers: req.headers });
    const files = [];
    busboy.on('file', (name, file, info) => {
      const chunks = [];
      file.on('data', (chunk) => chunks.push(chunk));
      file.on('end', () => {
        files.push({ filename: info.filename || 'photo.jpg', mimeType: info.mimeType || 'image/jpeg', buffer: Buffer.concat(chunks) });
      });
    });
    busboy.on('finish', () => resolve({ files }));
    busboy.on('error', reject);
    req.pipe(busboy);
  });
}

function redirect(res, location) {
  res.writeHead(303, { Location: location });
  res.end();
}

export default async function handler(req, res) {
  const tenantId = req.query.tenant;
  if (req.method !== 'POST' || !tenantId) {
    return redirect(res, '/');
  }

  try {
    const { files } = await parseMultipart(req);
    const imageFiles = files.filter((f) => f.mimeType.startsWith('image/'));
    if (imageFiles.length === 0) {
      return redirect(res, `/?tenant=${tenantId}`);
    }

    // The date this feature exists to capture only survives on the
    // ORIGINAL bytes -- read it here, before sharp's re-encode below
    // strips EXIF, so the app doesn't need the compressed copy to still
    // carry it.
    const processed = await Promise.all(imageFiles.map(async (f) => {
      let capturedAt = null;
      try {
        const exif = await exifr.parse(f.buffer, { pick: ['DateTimeOriginal', 'CreateDate'] });
        const d = exif?.DateTimeOriginal || exif?.CreateDate;
        if (d instanceof Date && !isNaN(d.getTime())) capturedAt = d.toISOString();
      } catch (err) {
        // No EXIF, or an unreadable format -- the review screen already
        // has a manual-date fallback for exactly this case.
      }

      const resized = await sharp(f.buffer)
        .rotate() // bakes in the EXIF orientation flag before it's stripped
        .resize(1800, 1800, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer();

      return { filename: f.filename, mimeType: 'image/jpeg', base64: resized.toString('base64'), capturedAt };
    }));

    const token = crypto.randomBytes(12).toString('hex');
    await saveSharedPhotos(token, processed);

    return redirect(res, `/?tenant=${tenantId}&shareToken=${token}`);
  } catch (err) {
    console.error('[share-target] Failed:', err.message);
    return redirect(res, `/?tenant=${tenantId}`);
  }
}
