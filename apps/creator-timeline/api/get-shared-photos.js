import { getSharedPhotos, deleteSharedPhotos } from './_lib/sharedPhotoStore.js';

// One-time pickup for whatever share-target.js just stashed -- deleted
// immediately after being read so a refresh of the landing page doesn't
// re-import the same photos a second time.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { token } = req.query;
  if (!token || typeof token !== 'string') return res.status(400).json({ error: 'Missing token' });

  let photos;
  try {
    photos = await getSharedPhotos(token);
  } catch (err) {
    console.error('[get-shared-photos] Failed to read shared photos:', err.message);
    return res.status(500).json({ error: 'Could not load the shared photos.' });
  }

  if (!photos) {
    return res.status(404).json({ error: 'These shared photos have expired or were already imported.' });
  }

  deleteSharedPhotos(token).catch((err) => console.error('[get-shared-photos] Cleanup failed (non-fatal):', err.message));

  return res.status(200).json({ photos });
}
