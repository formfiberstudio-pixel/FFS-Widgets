import { test } from 'node:test';
import assert from 'node:assert/strict';
import { focusAfterDrag, focusCss, withFocus } from '../../src/thumbnailFocus.js';

test('the middle needs no CSS, any other position is object-position', () => {
  assert.equal(focusCss(undefined), undefined);
  assert.equal(focusCss({ x: 50, y: 50 }), undefined);
  assert.equal(focusCss({ x: 20, y: 75.5 }), '20% 75.5%');
  assert.equal(focusCss({ x: 'left', y: 10 }), undefined);
});

// A tall photo (1000 x 2000) in a square frame of 200: it is scaled to 200 x 400,
// so only the up-down side overflows, by 200px.
const tall = { frame: { width: 200, height: 200 }, natural: { width: 1000, height: 2000 } };

test('dragging a picture that overflows downwards moves what shows, against the drag', () => {
  // drag the picture UP by 100px: the lower half comes into view
  assert.deepEqual(focusAfterDrag({ ...tall, start: { x: 50, y: 50 }, dx: 0, dy: -100 }), { x: 50, y: 100 });
  // drag it DOWN by 50px: more of the top
  assert.deepEqual(focusAfterDrag({ ...tall, start: { x: 50, y: 50 }, dx: 0, dy: 50 }), { x: 50, y: 25 });
});

test('the side that does not overflow stays where it was', () => {
  assert.deepEqual(focusAfterDrag({ ...tall, start: { x: 30, y: 50 }, dx: 80, dy: 0 }), { x: 30, y: 50 });
});

test('it cannot be dragged past the edge of the picture', () => {
  assert.deepEqual(focusAfterDrag({ ...tall, start: { x: 50, y: 90 }, dx: 0, dy: -500 }), { x: 50, y: 100 });
  assert.deepEqual(focusAfterDrag({ ...tall, start: { x: 50, y: 10 }, dx: 0, dy: 500 }), { x: 50, y: 0 });
});

test('a wide picture in a tall frame moves sideways', () => {
  const wide = { frame: { width: 100, height: 200 }, natural: { width: 2000, height: 1000 } }; // scaled to 400 x 200: 300px to spare
  assert.deepEqual(focusAfterDrag({ ...wide, start: { x: 50, y: 50 }, dx: -150, dy: 0 }), { x: 100, y: 50 });
  assert.deepEqual(focusAfterDrag({ ...wide, start: { x: 50, y: 50 }, dx: 60, dy: 0 }), { x: 30, y: 50 });
});

test('it starts from the middle when nothing was set, and survives missing sizes', () => {
  assert.deepEqual(focusAfterDrag({ ...tall, dx: 0, dy: -20 }), { x: 50, y: 60 });
  assert.deepEqual(focusAfterDrag({ start: { x: 12, y: 34 }, dx: 5, dy: 5, frame: { width: 0, height: 0 }, natural: { width: 0, height: 0 } }), { x: 12, y: 34 });
});

test('positions are kept to a tenth', () => {
  const moved = focusAfterDrag({ ...tall, start: { x: 50, y: 50 }, dx: 0, dy: -33.33 });
  assert.equal(moved.y, 66.7);
});

test('the map only holds positions that are not the middle', () => {
  const map = withFocus({}, 'a', { x: 10, y: 20 });
  assert.deepEqual(map, { a: { x: 10, y: 20 } });
  assert.deepEqual(withFocus(map, 'b', { x: 70, y: 70 }), { a: { x: 10, y: 20 }, b: { x: 70, y: 70 } });
  assert.deepEqual(withFocus(map, 'a', { x: 50, y: 50 }), {});
  assert.deepEqual(withFocus(map, 'a', null), {});
  assert.deepEqual(map, { a: { x: 10, y: 20 } }); // the input is untouched
});
