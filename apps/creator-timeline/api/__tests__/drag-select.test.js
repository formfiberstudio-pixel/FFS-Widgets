import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idsBetween, shiftRange, idsInBox, edgeScrollSpeed } from '../../src/dragSelect.js';

const ids = ['a', 'b', 'c', 'd', 'e'];

test('a range is the photos between two positions, both included, either way round', () => {
  assert.deepEqual(idsBetween(ids, 1, 3), ['b', 'c', 'd']);
  assert.deepEqual(idsBetween(ids, 3, 1), ['b', 'c', 'd']);
  assert.deepEqual(idsBetween(ids, 2, 2), ['c']);
  assert.deepEqual(idsBetween(ids, 0, 4), ids);
});

test('a position that is not in the list gives no range', () => {
  assert.deepEqual(idsBetween(ids, -1, 2), []);
  assert.deepEqual(idsBetween(ids, 1, 5), []);
  assert.deepEqual(idsBetween(ids, null, 2), []);
  assert.deepEqual(idsBetween([], 0, 0), []);
});

test('shift+click runs from the last photo clicked, or from the first when none was', () => {
  assert.deepEqual(shiftRange(ids, 1, 3), ['b', 'c', 'd']);
  assert.deepEqual(shiftRange(ids, 3, 0), ['a', 'b', 'c', 'd']);
  assert.deepEqual(shiftRange(ids, null, 2), ['a', 'b', 'c']);
  assert.deepEqual(shiftRange(ids, undefined, 1), ['a', 'b']);
});

const tile = (left, top) => ({ left, top, right: left + 100, bottom: top + 100 });
const tiles = [['a', tile(0, 0)], ['b', tile(112, 0)], ['c', tile(0, 112)], ['d', tile(112, 112)]];

test('a box picks up every tile it touches, even by a pixel', () => {
  assert.deepEqual(idsInBox(tiles, { left: 50, top: 50, right: 150, bottom: 150 }), ['a', 'b', 'c', 'd']);
  assert.deepEqual(idsInBox(tiles, { left: 90, top: 10, right: 120, bottom: 20 }), ['a', 'b']);
  assert.deepEqual(idsInBox(tiles, { left: 10, top: 90, right: 20, bottom: 120 }), ['a', 'c']);
});

test('a box in the gap between tiles, or outside them, picks up nothing', () => {
  assert.deepEqual(idsInBox(tiles, { left: 101, top: 10, right: 111, bottom: 20 }), []);
  assert.deepEqual(idsInBox(tiles, { left: 500, top: 500, right: 600, bottom: 600 }), []);
});

test('a box that only meets an edge does not count as touching', () => {
  assert.deepEqual(idsInBox(tiles, { left: 100, top: 0, right: 112, bottom: 100 }), []);
});

test('scrolling is still in the middle, and picks up speed towards the ends', () => {
  assert.equal(edgeScrollSpeed(300, 0, 600), 0);
  assert.equal(edgeScrollSpeed(40, 0, 600), 0);
  assert.equal(edgeScrollSpeed(20, 0, 600), -8);
  assert.equal(edgeScrollSpeed(0, 0, 600), -16);
  assert.equal(edgeScrollSpeed(580, 0, 600), 8);
  assert.equal(edgeScrollSpeed(600, 0, 600), 16);
});

test('dragged outside the area it scrolls no faster than the top speed', () => {
  assert.equal(edgeScrollSpeed(-300, 0, 600), -16);
  assert.equal(edgeScrollSpeed(900, 0, 600), 16);
});

test('a very small or empty area never scrolls both ways at once', () => {
  assert.equal(edgeScrollSpeed(10, 0, 20), 0);
  assert.equal(edgeScrollSpeed(5, 10, 10), 0);
  assert.equal(edgeScrollSpeed(5, 10, 0), 0);
});
