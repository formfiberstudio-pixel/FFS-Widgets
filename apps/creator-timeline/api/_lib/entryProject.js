// Changing which project an entry belongs to ("re-categorizing" it): working out
// which of the entry's properties say so, copying them from an entry of the
// project it is going to, and writing them back. The same properties are read
// by get-notion-logs.js's buildLogFields, which decides what the calendar shows.
//
//   - relation + rollup (a Projects / Plants database): the project is the
//     entry's relation to a page in the projects database; its type is a rollup
//     of that page, so it follows the project and has nothing to write.
//   - a database whose project and type are properties of the entry itself --
//     chosen in Settings (the "Organize by" pickers), or the first two
//     relation / select properties when nothing was chosen: the first is the
//     project (topic), the second its type. Both are written.
//
// An entry of the project it is moving TO is the model: its project (and type)
// property values are copied -- the same way creating an entry copies its
// reference entry's project -- so nothing here has to resolve a project name to
// a Notion page. What was there before is handed back in the same shape, which
// is what undoing the move writes again.

import { detectFacetSchema, isFacetedSchema, resolveFacetOverride } from '../get-notion-logs.js';

// Property kinds a project can be written to. (A rollup or formula is computed
// from something else; a status can't take a new option through the API.)
const WRITABLE = new Set(['relation', 'select', 'multi_select', 'rich_text']);

const MAX_RELATION_IDS = 25;
const MAX_NAMES = 25;
const MAX_TEXT_LENGTH = 200;
const NOTION_ID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

// A request that can't be honoured, with a reason fit to show.
export class ProjectChangeError extends Error {}

// The property that holds an entry's project (`topic`) and the one that holds its
// type (`type`), each as { name, type } or null. `properties` is any entry of
// the database, `source` the tenant's record of it ({ topicFacetKey,
// typeFacetKey, ... }). A type that is computed (a rollup) comes back null: it
// follows the project.
export function projectHolders(properties, source) {
  const schema = detectFacetSchema(properties);
  const { overrideTopicProp, overrideTypeProp, hasManualOverride } = resolveFacetOverride(schema, source || null);

  let topic = null;
  let type = null;
  if (hasManualOverride) {
    topic = overrideTopicProp;
    type = overrideTypeProp;
  } else if (isFacetedSchema(schema)) {
    topic = schema[0] || null;
    type = schema[1] || null;
  } else {
    // relation + rollup: the relation that has a project in it, or the only one.
    const relations = Object.entries(properties || {}).filter(([, prop]) => prop.type === 'relation');
    const chosen = relations.find(([, prop]) => prop.relation?.length > 0) || (relations.length === 1 ? relations[0] : null);
    topic = chosen ? { name: chosen[0], type: 'relation' } : null;
  }

  if (!topic) throw new ProjectChangeError('Could not tell where this database keeps an entry’s project.');
  if (!WRITABLE.has(topic.type)) {
    throw new ProjectChangeError('This database keeps the project in a property that can’t be changed from here.');
  }
  return {
    topic: { name: topic.name, type: topic.type },
    type: type && WRITABLE.has(type.type) ? { name: type.name, type: type.type } : null,
  };
}

// One property's value in the plain shape this module passes around (and the
// browser keeps for undo): { type: 'relation', ids } | { type: 'select', name }
// | { type: 'multi_select', names } | { type: 'rich_text', text }.
export function readValue(prop) {
  switch (prop?.type) {
    case 'relation':
      return { type: 'relation', ids: (prop.relation || []).map((r) => r.id) };
    case 'select':
      return { type: 'select', name: prop.select?.name ?? null };
    case 'multi_select':
      return { type: 'multi_select', names: (prop.multi_select || []).map((o) => o.name) };
    case 'rich_text':
      return { type: 'rich_text', text: (prop.rich_text || []).map((t) => t.plain_text ?? t.text?.content ?? '').join('') };
    default:
      return null;
  }
}

// What the holders of `properties` (an entry of the project being moved to)
// hold, as { [propertyName]: value } -- the assignment to copy.
export function assignmentFrom(properties, source) {
  const { topic, type } = projectHolders(properties, source);
  const assignment = {};
  for (const holder of [topic, type]) {
    if (!holder) continue;
    const value = readValue(properties[holder.name]);
    if (value) assignment[holder.name] = value;
  }
  return assignment;
}

// The current values, on `properties`, of the properties an assignment sets --
// what a move replaces, and so what undoing it puts back.
export function currentValues(properties, assignment) {
  const values = {};
  for (const name of Object.keys(assignment)) {
    const value = readValue(properties?.[name]);
    if (value) values[name] = value;
  }
  return values;
}

const cleanName = (value) => String(value ?? '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);

// A value as it will be written: only the expected fields, cut to sane sizes.
// Throws on anything that isn't a value of the kind it says it is.
function normalizeValue(value) {
  switch (value?.type) {
    case 'relation': {
      if (!Array.isArray(value.ids) || value.ids.length > MAX_RELATION_IDS || !value.ids.every((id) => typeof id === 'string' && NOTION_ID.test(id))) {
        throw new ProjectChangeError('That project could not be read.');
      }
      return { type: 'relation', ids: value.ids };
    }
    case 'select': {
      const name = value.name == null ? null : cleanName(value.name);
      return { type: 'select', name: name || null };
    }
    case 'multi_select': {
      if (!Array.isArray(value.names) || value.names.length > MAX_NAMES) throw new ProjectChangeError('That project could not be read.');
      return { type: 'multi_select', names: value.names.map(cleanName).filter(Boolean) };
    }
    case 'rich_text': {
      return { type: 'rich_text', text: String(value.text ?? '').slice(0, MAX_TEXT_LENGTH) };
    }
    default:
      throw new ProjectChangeError('That project could not be read.');
  }
}

// The Notion property payloads that write `assignment` onto an entry with
// `entryProperties`. Every property named has to exist on the entry and be of
// the kind the value says, or nothing is written.
export function patchFromAssignment(entryProperties, assignment) {
  const names = Object.keys(assignment || {});
  if (names.length === 0) throw new ProjectChangeError('There is nothing to change.');
  const patch = {};
  for (const name of names) {
    const value = normalizeValue(assignment[name]);
    const prop = entryProperties?.[name];
    if (!prop || prop.type !== value.type || !WRITABLE.has(prop.type)) {
      throw new ProjectChangeError('This entry does not keep its project the way that project does.');
    }
    switch (value.type) {
      case 'relation':
        patch[name] = { relation: value.ids.map((id) => ({ id })) };
        break;
      case 'select':
        patch[name] = { select: value.name ? { name: value.name } : null };
        break;
      case 'multi_select':
        patch[name] = { multi_select: value.names.map((n) => ({ name: n })) };
        break;
      case 'rich_text':
        patch[name] = { rich_text: value.text ? [{ text: { content: value.text } }] : [] };
        break;
      default:
        break;
    }
  }
  return patch;
}

// Whether two sets of values say the same thing (so a move would change nothing).
export function sameValues(a, b) {
  const sorted = (value) => JSON.stringify(value, (key, v) => (key === 'ids' || key === 'names' ? [...v].sort() : v));
  const names = Object.keys(a || {});
  if (names.length !== Object.keys(b || {}).length) return false;
  return names.every((name) => b?.[name] && sorted(a[name]) === sorted(b[name]));
}
