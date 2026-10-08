import { registerPlugin, Capacitor } from '@capacitor/core';

// Only has a real implementation inside the Capacitor Android shell (see
// android/app/src/main/java/.../DateFilteredPhotoPickerPlugin.java) --
// registerPlugin() still returns a usable proxy on the plain web/PWA
// build, but every call on it would reject since nothing backs it there.
// isNativePhotoPickerSupported() below is what callers should actually
// gate on before touching this at all.
const DateFilteredPhotoPicker = registerPlugin('DateFilteredPhotoPicker');

export function isNativePhotoPickerSupported() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

// start/end are bare "YYYY-MM-DD" strings in LOCAL date semantics, same as
// everywhere else in this app -- converted here to the local
// midnight-to-midnight millisecond range the plugin compares MediaStore's
// DATE_TAKEN/DATE_MODIFIED columns against.
export async function queryPhotosByDateRange(start, end) {
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const startMillis = new Date(sy, sm - 1, sd, 0, 0, 0, 0).getTime();
  const endMillis = new Date(ey, em - 1, ed, 23, 59, 59, 999).getTime();
  const { photos } = await DateFilteredPhotoPicker.queryByDateRange({ startMillis, endMillis });
  return photos;
}

export async function getPhotoThumbnail(uri) {
  const { base64 } = await DateFilteredPhotoPicker.getThumbnail({ uri });
  return base64;
}

export async function getPhotoData(uri) {
  const { base64 } = await DateFilteredPhotoPicker.getPhotoData({ uri });
  return base64;
}

// "Share to app" (Android only, see SharedPhotosPlugin.java): photos picked in
// the gallery and sent with Share > Creator Timeline. The plugin holds them
// until asked -- the page may not even have been running when they arrived --
// and hands over each one's content:// uri, name, and capture date with how far
// to trust it. The pictures themselves are then read with getPhotoThumbnail /
// getPhotoData above, like any other native photo.
const SharedPhotos = registerPlugin('SharedPhotos');

// Everything shared and not yet taken, once. Empty on the web, and on an app
// build from before this plugin existed (the call is refused there).
export async function takeSharedPhotos() {
  if (!isNativePhotoPickerSupported()) return [];
  try {
    const { photos } = await SharedPhotos.getSharedPhotos();
    return Array.isArray(photos) ? photos : [];
  } catch {
    return [];
  }
}

// Called when more photos are shared while the app is already open. Returns a
// function that stops listening.
export function onSharedPhotosArrived(callback) {
  if (!isNativePhotoPickerSupported()) return () => {};
  let handle = null;
  let stopped = false;
  try {
    Promise.resolve(SharedPhotos.addListener('sharedPhotos', callback))
      .then((added) => { if (stopped) added?.remove?.(); else handle = added; })
      .catch(() => {});
  } catch {
    // An older app build without the plugin: nothing to listen to.
  }
  return () => {
    stopped = true;
    handle?.remove?.();
  };
}
