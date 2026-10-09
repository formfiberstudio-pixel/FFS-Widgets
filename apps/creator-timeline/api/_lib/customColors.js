// The colours the person has chosen for their projects and their types (the
// calendar's dots, pills and project list), kept on the tenant record so every
// device shows the same ones. Both are { name: '#rrggbb' } -- a project is named
// by its title and a type by its name, as the calendar does. This only decides
// what is fit to store; src/customColors.js has the browser's side.

const MAX_PER_KIND = 2000;
const MAX_NAME_LENGTH = 200;
const HEX_COLOUR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function cleanMap(raw) {
  const clean = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return clean;
  for (const [name, colour] of Object.entries(raw)) {
    if (Object.keys(clean).length >= MAX_PER_KIND) break;
    if (!name || name.length > MAX_NAME_LENGTH || name === '__proto__') continue;
    if (typeof colour !== 'string' || !HEX_COLOUR.test(colour)) continue;
    clean[name] = colour.toLowerCase();
  }
  return clean;
}

// { project: {...}, category: {...} } with only real names and real colours.
export function sanitizeCustomColors(raw) {
  return { project: cleanMap(raw?.project), category: cleanMap(raw?.category) };
}
