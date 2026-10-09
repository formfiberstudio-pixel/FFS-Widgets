// The colours chosen for projects and types, as the browser holds them:
// { project: { title: '#hex' }, category: { type: '#hex' } }. They are kept on
// the server too (see api/_lib/customColors.js) so every device shows the same
// ones; App.jsx does the saving and the adopting, and this is the bookkeeping,
// pure so it can be tested.

export const noColors = () => ({ project: {}, category: {} });

function cleanMap(raw) {
  const clean = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return clean;
  for (const [name, colour] of Object.entries(raw)) {
    if (typeof colour === 'string' && colour !== '') clean[name] = colour;
  }
  return clean;
}

export function cleanColors(raw) {
  return { project: cleanMap(raw?.project), category: cleanMap(raw?.category) };
}

export const hasColors = (colors) => Object.keys(colors.project).length + Object.keys(colors.category).length > 0;

const sameMap = (a, b) => {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => key in b && a[key].toLowerCase() === b[key].toLowerCase());
};
export const sameColors = (a, b) => sameMap(a.project, b.project) && sameMap(a.category, b.category);

// The first time a device meets the colours the server holds, it may well have
// colours of its own that the server has never seen (each device was set up on
// its own until now). Both are kept, and where they name the same project or
// type the server's wins -- the device then sends the result back.
export function mergeColors(local, server) {
  return {
    project: { ...local.project, ...server.project },
    category: { ...local.category, ...server.category },
  };
}
