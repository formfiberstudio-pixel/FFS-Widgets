import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCustomColors } from '../_lib/customColors.js';
import { cleanColors, hasColors, sameColors, mergeColors, noColors } from '../../src/customColors.js';

test('only real names with real colours are fit to store, and colours are kept lower case', () => {
  assert.deepEqual(
    sanitizeCustomColors({
      project: { 'Garden Notes': '#E11D48', 'Short': '#abc', 'Alpha': '#11223344', 'Bad': 'red', 'Worse': 'url(javascript:alert(1))', 'Number': 12, '': '#ffffff' },
      category: { Writing: '#2563EB' },
    }),
    { project: { 'Garden Notes': '#e11d48', Short: '#abc', Alpha: '#11223344' }, category: { Writing: '#2563eb' } }
  );
});

test('anything that is not the right shape becomes no colours at all', () => {
  for (const raw of [null, undefined, 'x', 7, [], { project: [], category: 'red' }]) {
    assert.deepEqual(sanitizeCustomColors(raw), { project: {}, category: {} });
  }
});

test('a name cannot reach into the object it is stored in', () => {
  const raw = JSON.parse('{"project":{"__proto__":"#ffffff","ok":"#000000"},"category":{}}');
  const clean = sanitizeCustomColors(raw);
  assert.deepEqual(Object.keys(clean.project), ['ok']);
  assert.equal(Object.getPrototypeOf(clean.project), Object.prototype);
});

test('there is a limit to how many are kept', () => {
  const many = Object.fromEntries(Array.from({ length: 2500 }, (_, i) => [`project ${i}`, '#ffffff']));
  assert.equal(Object.keys(sanitizeCustomColors({ project: many }).project).length, 2000);
});

test('the browser side reads whatever is in storage safely', () => {
  assert.deepEqual(cleanColors(null), noColors());
  assert.deepEqual(cleanColors({ project: { a: '#fff', b: 3, c: '' } }), { project: { a: '#fff' }, category: {} });
  assert.equal(hasColors(noColors()), false);
  assert.equal(hasColors({ project: {}, category: { x: '#fff' } }), true);
});

test('colours are the same however the letters are cased', () => {
  assert.equal(sameColors({ project: { a: '#E11D48' }, category: {} }, { project: { a: '#e11d48' }, category: {} }), true);
  assert.equal(sameColors({ project: { a: '#e11d48' }, category: {} }, { project: { a: '#e11d49' }, category: {} }), false);
  assert.equal(sameColors({ project: { a: '#fff' }, category: {} }, { project: { a: '#fff', b: '#000' }, category: {} }), false);
});

test('a device meeting the server\'s colours for the first time keeps both, the server winning a tie', () => {
  const local = { project: { Knitting: '#111111', Garden: '#222222' }, category: { Log: '#333333' } };
  const server = { project: { Garden: '#999999', Reading: '#444444' }, category: {} };
  assert.deepEqual(mergeColors(local, server), {
    project: { Knitting: '#111111', Garden: '#999999', Reading: '#444444' },
    category: { Log: '#333333' },
  });
  // the inputs are left alone
  assert.deepEqual(local.project, { Knitting: '#111111', Garden: '#222222' });
});
