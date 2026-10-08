import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assignmentFrom,
  currentValues,
  patchFromAssignment,
  projectHolders,
  ProjectChangeError,
  readValue,
  sameValues,
} from '../_lib/entryProject.js';

const A = 'aaaaaaaa-1111-2222-3333-444444444444';
const B = 'bbbbbbbb-1111-2222-3333-444444444444';

// A projects database: a relation to the project page, its type rolled up.
const relationEntry = (ids) => ({
  Name: { type: 'title', title: [{ plain_text: 'x' }] },
  'Post-Date': { type: 'date', date: { start: '2026-08-01' } },
  Projects: { type: 'relation', relation: ids.map((id) => ({ id })) },
  'Project Type': { type: 'rollup', rollup: { array: [] } },
});

// A database that keeps topic and type as selects on the entry itself.
const selectEntry = (topic, medium) => ({
  Name: { type: 'title', title: [] },
  topic: { type: 'select', select: topic ? { name: topic, color: 'blue' } : null },
  medium: { type: 'select', select: medium ? { name: medium, color: 'gray' } : null },
});

test('in a relation + rollup database the project is the relation, and the type follows it', () => {
  assert.deepEqual(projectHolders(relationEntry([A]), null), { topic: { name: 'Projects', type: 'relation' }, type: null });
});

test('an entry with no project yet still shows which relation is the project, when there is one', () => {
  assert.deepEqual(projectHolders(relationEntry([]), null).topic, { name: 'Projects', type: 'relation' });
});

test('two relations and none filled in: it can not tell which is the project', () => {
  const props = { ...relationEntry([]), Related: { type: 'relation', relation: [] } };
  assert.throws(() => projectHolders(props, null), ProjectChangeError);
});

test('with two relations, the one that holds a project is the project', () => {
  const props = { ...relationEntry([A]), Related: { type: 'relation', relation: [] } };
  assert.equal(projectHolders(props, null).topic.name, 'Projects');
});

test('a database with a topic and a type on the entry has both as holders', () => {
  const holders = projectHolders(selectEntry('Birds', 'Ink'), null);
  assert.deepEqual(holders, { topic: { name: 'topic', type: 'select' }, type: { name: 'medium', type: 'select' } });
});

test('the properties chosen in Settings are the holders', () => {
  const holders = projectHolders(selectEntry('Birds', 'Ink'), { topicFacetKey: 'medium', typeFacetKey: 'topic' });
  assert.deepEqual(holders, { topic: { name: 'medium', type: 'select' }, type: { name: 'topic', type: 'select' } });
});

test('a project kept somewhere that can not be written is refused, not guessed at', () => {
  const props = { ...relationEntry([A]), Status: { type: 'select', select: null } };
  const source = { topicFacetKey: 'projectType', typeFacetKey: '' }; // the rollup
  assert.throws(() => projectHolders(props, source), /can’t be changed/);
});

test('values are read in a plain shape', () => {
  assert.deepEqual(readValue({ type: 'relation', relation: [{ id: A }, { id: B }] }), { type: 'relation', ids: [A, B] });
  assert.deepEqual(readValue({ type: 'select', select: { name: 'Ink', color: 'gray' } }), { type: 'select', name: 'Ink' });
  assert.deepEqual(readValue({ type: 'select', select: null }), { type: 'select', name: null });
  assert.deepEqual(readValue({ type: 'multi_select', multi_select: [{ name: 'a' }, { name: 'b' }] }), { type: 'multi_select', names: ['a', 'b'] });
  assert.deepEqual(readValue({ type: 'rich_text', rich_text: [{ plain_text: 'he' }, { plain_text: 'llo' }] }), { type: 'rich_text', text: 'hello' });
  assert.equal(readValue({ type: 'rollup' }), null);
});

test('the assignment to copy is what the project entry holds, in each holder', () => {
  assert.deepEqual(assignmentFrom(relationEntry([B]), null), { Projects: { type: 'relation', ids: [B] } });
  assert.deepEqual(assignmentFrom(selectEntry('Birds', 'Ink'), null), {
    topic: { type: 'select', name: 'Birds' },
    medium: { type: 'select', name: 'Ink' },
  });
  // a project with no type: the type is cleared, not left as it was
  assert.deepEqual(assignmentFrom(selectEntry('Birds', null), null).medium, { type: 'select', name: null });
});

test('writing an assignment gives the Notion payloads, checked against the entry', () => {
  const patch = patchFromAssignment(relationEntry([A]), { Projects: { type: 'relation', ids: [B] } });
  assert.deepEqual(patch, { Projects: { relation: [{ id: B }] } });

  const selects = patchFromAssignment(selectEntry('Birds', 'Ink'), {
    topic: { type: 'select', name: 'Fish, big' },
    medium: { type: 'select', name: null },
  });
  assert.deepEqual(selects, { topic: { select: { name: 'Fish big' } }, medium: { select: null } });

  assert.deepEqual(
    patchFromAssignment({ tags: { type: 'multi_select', multi_select: [] }, note: { type: 'rich_text', rich_text: [] } }, {
      tags: { type: 'multi_select', names: ['a', ' b '] },
      note: { type: 'rich_text', text: '' },
    }),
    { tags: { multi_select: [{ name: 'a' }, { name: 'b' }] }, note: { rich_text: [] } },
  );
});

test('a project cleared of its relation writes an empty relation', () => {
  assert.deepEqual(patchFromAssignment(relationEntry([A]), { Projects: { type: 'relation', ids: [] } }), { Projects: { relation: [] } });
});

test('nothing is written for a property the entry lacks, or of another kind', () => {
  assert.throws(() => patchFromAssignment(relationEntry([A]), { Elsewhere: { type: 'relation', ids: [B] } }), ProjectChangeError);
  assert.throws(() => patchFromAssignment(relationEntry([A]), { Name: { type: 'select', name: 'x' } }), ProjectChangeError);
  assert.throws(() => patchFromAssignment(relationEntry([A]), { Projects: { type: 'select', name: 'x' } }), ProjectChangeError);
  assert.throws(() => patchFromAssignment(relationEntry([A]), {}), /nothing to change/);
});

test('values that are not what they say are refused', () => {
  const entry = relationEntry([A]);
  assert.throws(() => patchFromAssignment(entry, { Projects: { type: 'relation', ids: ['not-an-id'] } }), ProjectChangeError);
  assert.throws(() => patchFromAssignment(entry, { Projects: { type: 'relation', ids: 'nope' } }), ProjectChangeError);
  assert.throws(() => patchFromAssignment(entry, { Projects: { type: 'relation', ids: Array(26).fill(A) } }), ProjectChangeError);
  assert.throws(() => patchFromAssignment(entry, { Projects: { type: 'files' } }), ProjectChangeError);
  assert.throws(() => patchFromAssignment(entry, { Projects: null }), ProjectChangeError);
});

test('the values a move replaces are read off the entry, for undoing it', () => {
  const entry = selectEntry('Birds', 'Ink');
  const assignment = { topic: { type: 'select', name: 'Fish' }, medium: { type: 'select', name: null } };
  assert.deepEqual(currentValues(entry, assignment), { topic: { type: 'select', name: 'Birds' }, medium: { type: 'select', name: 'Ink' } });
});

test('a move to what the entry already has changes nothing', () => {
  const a = { Projects: { type: 'relation', ids: [A, B] } };
  assert.equal(sameValues(a, { Projects: { type: 'relation', ids: [B, A] } }), true);
  assert.equal(sameValues(a, { Projects: { type: 'relation', ids: [A] } }), false);
  assert.equal(sameValues({ t: { type: 'select', name: 'x' } }, { t: { type: 'select', name: 'y' } }), false);
  assert.equal(sameValues({ t: { type: 'select', name: 'x' } }, { u: { type: 'select', name: 'x' } }), false);
});
