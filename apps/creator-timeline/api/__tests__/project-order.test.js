import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanOrder,
  moveAmong,
  moveRelative,
  orderProjectList,
  orderTree,
  projectsKey,
  sortByOrder,
  SOURCES_KEY,
  typesKey,
  withVisibleOrder,
} from '../../src/projectOrder.js';
import { sanitizeProjectOrder } from '../_lib/projectOrder.js';

test('names come out in the arranged order, the rest after them in their own order', () => {
  assert.deepEqual(sortByOrder(['a', 'b', 'c', 'd'], ['c', 'a']), ['c', 'a', 'b', 'd']);
  assert.deepEqual(sortByOrder(['a', 'b', 'c'], []), ['a', 'b', 'c']);
  assert.deepEqual(sortByOrder(['a', 'b', 'c'], undefined), ['a', 'b', 'c']);
});

test('names in the order that are no longer there are ignored', () => {
  assert.deepEqual(sortByOrder(['a', 'b'], ['gone', 'b', 'also gone', 'a']), ['b', 'a']);
});

test('a name repeated in the order counts at its first place', () => {
  assert.deepEqual(sortByOrder(['a', 'b', 'c'], ['c', 'b', 'c']), ['c', 'b', 'a']);
});

const tree = () => ({
  KNITS: { Log: [{ title: 'Cardigan' }, { title: 'Cotton reknit' }, { title: 'General' }] },
  PLANTS: {
    Cycads: [{ title: 'Sago' }],
    Dicots: [{ title: 'Avocado 1' }, { title: 'Avocado 2' }, { title: 'Okra' }],
  },
});
const titles = (grouped) => Object.fromEntries(Object.entries(grouped).map(([s, types]) => [s, Object.fromEntries(Object.entries(types).map(([t, ps]) => [t, ps.map((p) => p.title)]))]));

test('with no arranging the tree is as it was', () => {
  assert.deepEqual(titles(orderTree(tree(), {})), titles(tree()));
  assert.deepEqual(Object.keys(orderTree(tree(), {})), ['KNITS', 'PLANTS']);
});

test('every level can be arranged on its own', () => {
  const ordered = orderTree(tree(), {
    [SOURCES_KEY]: ['PLANTS', 'KNITS'],
    [typesKey('PLANTS')]: ['Dicots', 'Cycads'],
    [projectsKey('PLANTS', 'Dicots')]: ['Okra', 'Avocado 2'],
    [projectsKey('KNITS', 'Log')]: ['General'],
  });
  assert.deepEqual(Object.keys(ordered), ['PLANTS', 'KNITS']);
  assert.deepEqual(Object.keys(ordered.PLANTS), ['Dicots', 'Cycads']);
  assert.deepEqual(ordered.PLANTS.Dicots.map((p) => p.title), ['Okra', 'Avocado 2', 'Avocado 1']);
  assert.deepEqual(ordered.KNITS.Log.map((p) => p.title), ['General', 'Cardigan', 'Cotton reknit']);
});

test('ordering never loses or changes a project, and leaves the input alone', () => {
  const input = tree();
  const before = JSON.stringify(input);
  const ordered = orderTree(input, { [projectsKey('PLANTS', 'Dicots')]: ['Okra'] });
  assert.equal(JSON.stringify(input), before);
  assert.equal(ordered.PLANTS.Dicots[0], input.PLANTS.Dicots[2]); // the same project object
  assert.equal(Object.values(ordered).flatMap((types) => Object.values(types).flat()).length, 7);
});

test('a flat project list is arranged by database, then type, then project', () => {
  const flat = [
    { source: 'PLANTS', projectType: 'Dicots', title: 'Okra' },
    { source: 'KNITS', projectType: 'Log', title: 'Cardigan' },
    { source: 'PLANTS', projectType: 'Dicots', title: 'Avocado' },
    { source: 'PLANTS', projectType: 'Cycads', title: 'Sago' },
    { source: 'KNITS', projectType: 'Log', title: 'General' },
  ];
  const ordered = orderProjectList(flat, {
    [SOURCES_KEY]: ['PLANTS'],
    [typesKey('PLANTS')]: ['Cycads'],
    [projectsKey('KNITS', 'Log')]: ['General'],
  });
  assert.deepEqual(ordered.map((p) => p.title), ['Sago', 'Okra', 'Avocado', 'General', 'Cardigan']);
});

test('a project with no type is filed under the fallback type', () => {
  const ordered = orderProjectList([{ source: 'A', title: 'x' }, { source: 'A', projectType: 'T', title: 'y' }], {}, 'General');
  assert.deepEqual(ordered.map((p) => p.title), ['x', 'y']);
});

test('a name can be put before or after another', () => {
  assert.deepEqual(moveRelative(['a', 'b', 'c', 'd'], 'd', 'b', 'before'), ['a', 'd', 'b', 'c']);
  assert.deepEqual(moveRelative(['a', 'b', 'c', 'd'], 'a', 'c', 'after'), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveRelative(['a', 'b', 'c'], 'a', 'a', 'before'), ['a', 'b', 'c']);
  assert.deepEqual(moveRelative(['a', 'b'], 'x', 'a', 'before'), ['a', 'b']);
  assert.deepEqual(moveRelative(['a', 'b'], 'a', 'x', 'before'), ['a', 'b']);
});

test('moving up or down steps past the neighbour that is showing', () => {
  const showing = ['a', 'c', 'e'];
  assert.deepEqual(moveAmong(showing, 'c', -1), ['c', 'a', 'e']);
  assert.deepEqual(moveAmong(showing, 'c', 1), ['a', 'e', 'c']);
  // at an end there is nowhere to go
  assert.equal(moveAmong(showing, 'a', -1), showing);
  assert.equal(moveAmong(showing, 'e', 1), showing);
  assert.equal(moveAmong(showing, 'zzz', 1), showing);
});

test('the showing names take the new order and the others keep their places', () => {
  const base = ['a', 'b', 'c', 'd', 'e'];
  // a, c and e are showing; c has been moved to the front of them
  assert.deepEqual(withVisibleOrder(base, ['c', 'a', 'e']), ['c', 'b', 'a', 'd', 'e']);
  // everything showing: the new order is the list
  assert.deepEqual(withVisibleOrder(base, ['e', 'd', 'c', 'b', 'a']), ['e', 'd', 'c', 'b', 'a']);
  // a name showing that the list did not have yet goes at the end
  assert.deepEqual(withVisibleOrder(['a', 'b'], ['b', 'a', 'new']), ['b', 'a', 'new']);
  assert.deepEqual(withVisibleOrder([], ['x', 'y']), ['x', 'y']);
});

test('the first move writes the order the person was looking at, not the base list', () => {
  // the sidebar showed Garden Notes, Reading, Daily Sketch (by date); the base
  // list (alphabetical) is something else entirely. Moving Reading up must
  // leave Daily Sketch last.
  const showing = ['Garden Notes', 'Reading', 'Daily Sketch'];
  const alphabetical = ['Daily Sketch', 'Garden Notes', 'Reading'];
  const stored = withVisibleOrder(sortByOrder(alphabetical, []), moveAmong(showing, 'Reading', -1));
  assert.deepEqual(sortByOrder(showing, stored), ['Reading', 'Garden Notes', 'Daily Sketch']);
});

test('an order is cleaned to the three kinds of list of distinct names', () => {
  assert.deepEqual(cleanOrder({
    sources: ['A', 'B', 'A', '', 3],
    'types:A': ['T'],
    'projects:A::T': ['x', 'y'],
    other: ['nope'],
    'types:B': 'not a list',
    'projects:A::U': [],
  }), { sources: ['A', 'B'], 'types:A': ['T'], 'projects:A::T': ['x', 'y'] });
  assert.deepEqual(cleanOrder(null), {});
  assert.deepEqual(cleanOrder([1, 2]), {});
  assert.deepEqual(cleanOrder('x'), {});
});

test('the server keeps only what is fit to store', () => {
  const clean = sanitizeProjectOrder({
    sources: ['A', 'B', 'A'],
    'projects:A::T': ['x', 'y', 42, '', 'z'.repeat(201)],
    ['types:' + 'k'.repeat(500)]: ['too long a key'],
    bogus: ['a'],
    'types:B': { not: 'a list' },
  });
  assert.deepEqual(clean, { sources: ['A', 'B'], 'projects:A::T': ['x', 'y'] });
  assert.deepEqual(sanitizeProjectOrder(undefined), {});
  assert.deepEqual(sanitizeProjectOrder([]), {});
  // a huge list is cut, not refused
  assert.equal(sanitizeProjectOrder({ sources: Array.from({ length: 900 }, (_, i) => `n${i}`) }).sources.length, 500);
});
