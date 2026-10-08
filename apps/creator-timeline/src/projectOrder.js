// The person's own order for the project list -- databases, the types within
// each, and the projects within each type -- kept the same on every device (it
// is saved with the rest of their setup, see api/backlog-photo.js's
// setProjectOrder, and comes back with each sync). Pure, so it can be tested;
// App.jsx does the saving and the drawing.
//
// An order is a plain object of name lists, one per list that has been arranged:
//   'sources'                   -> [database names]
//   'types:<source>'            -> [type names]
//   'projects:<source>::<type>' -> [project names]
// A list that was never arranged has no entry and keeps its usual order. A name
// not in its list (a project added since) goes after the arranged ones, in its
// usual order, so nothing ever disappears from view.
//
// The server cleans what it stores the same way (api/_lib/projectOrder.js).

export const SOURCES_KEY = 'sources';
export const typesKey = (source) => `types:${source}`;
export const projectsKey = (source, type) => `projects:${source}::${type}`;

// `names` in the order `list` gives them; any it doesn't mention follow, in
// their own order.
export function sortByOrder(names, list = []) {
  const rank = new Map();
  list.forEach((name, index) => { if (!rank.has(name)) rank.set(name, index); });
  const listed = names.filter((name) => rank.has(name)).sort((a, b) => rank.get(a) - rank.get(b));
  const unlisted = names.filter((name) => !rank.has(name));
  return [...listed, ...unlisted];
}

// The sidebar's { source: { type: [project, ...] } } tree with every level in
// the person's order. Returns a new tree; the input is untouched.
export function orderTree(tree, orders = {}) {
  const result = {};
  for (const source of sortByOrder(Object.keys(tree), orders[SOURCES_KEY])) {
    result[source] = {};
    for (const type of sortByOrder(Object.keys(tree[source]), orders[typesKey(source)])) {
      const byTitle = new Map(tree[source][type].map((project) => [project.title, project]));
      const titles = sortByOrder([...byTitle.keys()], orders[projectsKey(source, type)]);
      result[source][type] = titles.map((title) => byTitle.get(title));
    }
  }
  return result;
}

// The same order, for a flat list of projects ({ source, projectType, title }):
// by database, then type, then project. A project with no type is filed under
// `fallbackType`.
export function orderProjectList(projects, orders = {}, fallbackType = 'General') {
  const tree = {};
  for (const project of projects) {
    const type = project.projectType || fallbackType;
    if (!tree[project.source]) tree[project.source] = {};
    if (!tree[project.source][type]) tree[project.source][type] = [];
    tree[project.source][type].push(project);
  }
  const ordered = orderTree(tree, orders);
  return Object.values(ordered).flatMap((types) => Object.values(types).flat());
}

// `list` with `name` taken out and put just before or after `target`. A list
// that lacks either name comes back as it was.
export function moveRelative(list, name, target, placement = 'before') {
  if (name === target || !list.includes(name) || !list.includes(target)) return list;
  const without = list.filter((item) => item !== name);
  const at = without.indexOf(target);
  without.splice(placement === 'after' ? at + 1 : at, 0, name);
  return without;
}

// `names` (the ones showing, in the order they show) with `name` moved one place
// towards the start (-1) or the end (+1). The same array when there is nowhere
// to go.
export function moveAmong(names, name, direction) {
  const at = names.indexOf(name);
  const neighbour = names[at + direction];
  if (at === -1 || neighbour === undefined) return names;
  return moveRelative(names, name, neighbour, direction < 0 ? 'before' : 'after');
}

// The whole list once the names that are showing have been put in the order
// `visibleOrdered`. Only part of a list may be showing (a month's projects, what
// a search left), so `base` is the list as it stood, every name in it: the
// showing names are put into the places the showing names held, in their new
// order, and the others stay where they were. What is showing but was not in
// `base` goes at the end.
export function withVisibleOrder(base, visibleOrdered) {
  const showing = new Set(visibleOrdered);
  const queue = [...visibleOrdered];
  const merged = base.map((name) => (showing.has(name) ? queue.shift() : name));
  return [...merged, ...queue];
}

// An order as it should be kept: only the three kinds of list, each made of
// distinct, non-empty names. (The server does the same to what it is sent.)
export function cleanOrder(raw) {
  const clean = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return clean;
  for (const [key, list] of Object.entries(raw)) {
    if (!(key === SOURCES_KEY || key.startsWith('types:') || key.startsWith('projects:'))) continue;
    if (!Array.isArray(list)) continue;
    const names = [...new Set(list.filter((name) => typeof name === 'string' && name))];
    if (names.length > 0) clean[key] = names;
  }
  return clean;
}
