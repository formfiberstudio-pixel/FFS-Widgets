// The thumbnail proxy (api/image-thumb.js) fetches whatever URL it's given
// server-side, so without a host allowlist it'd be an open SSRF proxy --
// anyone could point it at an internal address. Notion serves uploaded
// images from a small, stable set of hosts; only those are allowed through.
const ALLOWED_HOST_SUFFIXES = [
  'notion-static.com',
  'amazonaws.com',
  'notion.so',
];

export function isAllowedImageHost(hostname) {
  const host = hostname.toLowerCase();
  return ALLOWED_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

export function isThumbnailableUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' && isAllowedImageHost(parsed.hostname);
}
