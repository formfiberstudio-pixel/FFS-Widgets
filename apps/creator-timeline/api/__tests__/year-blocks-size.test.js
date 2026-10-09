import { test } from 'node:test';
import assert from 'node:assert/strict';
import { minBlockHeightFor, COLUMNS, ROWS, WEEK_ROWS } from '../../src/yearBlocksSize.js';

test('the blocks are three across and four down', () => {
  assert.equal(COLUMNS * ROWS, 12);
  assert.equal(COLUMNS, 3);
  assert.equal(ROWS, 4);
});

test('a block is always tall enough for its six week rows at the dots\' size', () => {
  for (const dot of [12, 16, 20, 22]) {
    const block = minBlockHeightFor(dot);
    assert.ok(block >= WEEK_ROWS * dot, `${dot}: ${block}`);
  }
});

test('bigger dots need taller blocks', () => {
  assert.ok(minBlockHeightFor(20) > minBlockHeightFor(16));
  assert.ok(minBlockHeightFor(16) > minBlockHeightFor(12));
});
