import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTaggedLog } from '../../src/facets.js';

const schema = (n) => Array.from({ length: n }, (_, i) => ({ key: `f${i}`, label: `F${i}`, type: 'select' }));
const facets = { f0: [{ name: 'x', color: 'default' }] };

test('an entry of a source with three or more tags is a tagged entry', () => {
  const log = { source: 'Home Food', facets };
  assert.equal(isTaggedLog(log, { 'Home Food': schema(3) }), true);
  assert.equal(isTaggedLog(log, { 'Home Food': schema(5) }), true);
});

test('an entry of a source with only one or two tags is a project entry, though the server tags it', () => {
  // the server attaches `facets` to every log of a source that is not a
  // relation + rollup pair, however few properties it has -- the app shows
  // such a source as projects, so its entries take their project's colour
  const log = { source: 'Knits', facets };
  assert.equal(isTaggedLog(log, { Knits: schema(1) }), false);
  assert.equal(isTaggedLog(log, { Knits: schema(2) }), false);
});

test('an entry without tags is never a tagged entry', () => {
  assert.equal(isTaggedLog({ source: 'Home Food' }, { 'Home Food': schema(3) }), false);
  assert.equal(isTaggedLog(null, { 'Home Food': schema(3) }), false);
  assert.equal(isTaggedLog(undefined, {}), false);
});

test('a source the app knows nothing about is not tagged', () => {
  assert.equal(isTaggedLog({ source: 'Knits', facets }, {}), false);
  assert.equal(isTaggedLog({ source: 'Knits', facets }, undefined), false);
});

test('an entry with no source is looked up under the default source', () => {
  assert.equal(isTaggedLog({ facets }, { 'Activity Log': schema(3) }), true);
  assert.equal(isTaggedLog({ facets }, { 'Activity Log': schema(2) }), false);
});
