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
