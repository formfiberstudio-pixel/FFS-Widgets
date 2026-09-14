// Served per-tenant (index.html points its <link rel="manifest"> here with
// ?tenant=... appended) rather than as a static file, because share_target
// registration and start_url both need to be pinned to one tenant's own
// URL -- a single static manifest shared by every tenant couldn't do
// either. Chrome only offers the install prompt (and, once installed,
// only registers the app as a Share target) for a page whose manifest
// resolves like this, so a tenant who installed before this endpoint
// existed needs to reinstall once for sharing to start working.
export default function handler(req, res) {
  const tenantId = typeof req.query.tenant === 'string' ? req.query.tenant : '';
  const startUrl = tenantId ? `/?tenant=${tenantId}` : '/';

  const manifest = {
    name: 'Creator Timeline',
    short_name: 'Creator Timeline',
    description: "A creator's progress calendar, driven by Notion data.",
    start_url: startUrl,
    scope: '/',
    display: 'standalone',
    background_color: '#F8FAFC',
    // Matches the default "Rose" theme's primary accent (see
    // DEFAULT_THEME_PRESETS in src/App.jsx) -- this is what Android uses
    // for the status bar/task-switcher color on an installed PWA. It's
    // fixed at install time from this static manifest, so a tenant who's
    // switched to a different in-app color theme won't see their status
    // bar follow along without reinstalling; there's no PWA-standard way
    // to make that live.
    theme_color: '#F43F5E',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };

  // Sharing only makes sense once this install is tied to a specific
  // tenant -- the generic "no tenant in the URL" manifest (setup page,
  // demo mode) skips it entirely rather than registering a share target
  // that has nowhere to deliver photos to.
  if (tenantId) {
    manifest.share_target = {
      action: `/api/share-target?tenant=${tenantId}`,
      method: 'POST',
      enctype: 'multipart/form-data',
      params: {
        files: [{ name: 'photos', accept: ['image/*'] }],
      },
    };
  }

  res.setHeader('Content-Type', 'application/manifest+json');
  res.setHeader('Cache-Control', 'no-cache');
  return res.status(200).json(manifest);
}
