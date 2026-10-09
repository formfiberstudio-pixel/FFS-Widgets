import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dotSizeFor, COLUMNS, ROWS, MIN_DOT, MIN_BLOCK_HEIGHT } from '../../src/yearBlocksSize.js';

test('the blocks are three across and four down', () => {
  assert.equal(COLUMNS * ROWS, 12);
  assert.equal(COLUMNS, 3);
  assert.equal(ROWS, 4);
});

test('a taller window gives the day dots more room, up to the largest asked for', () => {
  const short = dotSizeFor(560, 22);
  const tall = dotSizeFor(900, 22);
  const huge = dotSizeFor(2000, 22);
  assert.ok(tall > short, `${tall} > ${short}`);
  assert.equal(huge, 22);
  assert.ok(dotSizeFor(2000, 18) === 18);
});

test('a window too short for four rows keeps the dots readable instead of shrinking them away', () => {
  assert.equal(dotSizeFor(200, 22), MIN_DOT);
  assert.equal(dotSizeFor(0, 22), MIN_DOT);
});

test('the dot never needs more than its week row gives it', () => {
  for (const height of [500, 600, 720, 800, 1000, 1400]) {
    const dot = dotSizeFor(height, 22);
    const block = Math.max(MIN_BLOCK_HEIGHT, (height - 30) / ROWS);
    const weekRow = (block - 44) / 6;
    assert.ok(dot <= Math.max(MIN_DOT, weekRow), `${height}: dot ${dot} in a week row of ${weekRow}`);
  }
});
