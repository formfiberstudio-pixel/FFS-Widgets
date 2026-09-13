// Deliberately minimal -- this widget doesn't need offline caching, but
// Android's WebAPK/install pipeline (which is what lets a PWA register as
// a Share target at the OS level -- see manifest.js) is only reliable
// once a service worker with a fetch handler is registered and active.
// A pure passthrough is enough to satisfy that without changing how any
// request behaves.
self.addEventListener('fetch', () => {});
