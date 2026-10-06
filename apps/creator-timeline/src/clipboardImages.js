// Getting a copied picture (a screenshot, "Copy image" in a browser) in as a
// photo, without saving it to a file first. Two ways in:
//   - a paste event (Ctrl/Cmd+V): its clipboardData carries the image as a
//     file -- imageFilesFromClipboardData;
//   - the async Clipboard API, for a "Paste" button -- readClipboardImageFiles.
//     It needs a secure page and the browser's permission, and not every
//     browser or WebView has it (canReadClipboardImages says), so a paste
//     event stays the dependable route.

// The images in a paste event's clipboardData, as File objects; [] when the
// clipboard holds only text (or anything else), so such a paste is left alone.
export function imageFilesFromClipboardData(data) {
  if (!data) return [];
  const fromFiles = Array.from(data.files || []).filter((file) => String(file.type).startsWith('image/'));
  if (fromFiles.length) return fromFiles;
  // Some browsers only list the image under `items`.
  return Array.from(data.items || [])
    .filter((item) => item.kind === 'file' && String(item.type).startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter(Boolean);
}

export const canReadClipboardImages = () =>
  typeof navigator !== 'undefined' && !!navigator.clipboard?.read && typeof window !== 'undefined' && window.isSecureContext;

// The images on the clipboard right now, as File objects. Rejects if reading
// is refused (the person said no, or the page isn't focused); resolves to []
// when the clipboard holds no image.
export async function readClipboardImageFiles() {
  const files = [];
  for (const item of await navigator.clipboard.read()) {
    const type = item.types.find((t) => t.startsWith('image/'));
    if (!type) continue;
    const blob = await item.getType(type);
    files.push(new File([blob], `pasted-${Date.now()}.${type.split('/')[1] || 'png'}`, { type }));
  }
  return files;
}
