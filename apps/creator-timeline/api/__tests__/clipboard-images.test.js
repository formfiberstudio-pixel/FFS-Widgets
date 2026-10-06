import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageFilesFromClipboardData } from '../../src/clipboardImages.js';

const file = (name, type) => new File(['x'], name, { type });

test('a paste carrying an image gives that image back as a file', () => {
  const png = file('image.png', 'image/png');
  assert.deepEqual(imageFilesFromClipboardData({ files: [png], items: [] }), [png]);
});

test('only the images among the pasted files are kept', () => {
  const png = file('a.png', 'image/png');
  const jpg = file('b.jpg', 'image/jpeg');
  const result = imageFilesFromClipboardData({ files: [file('notes.txt', 'text/plain'), png, jpg], items: [] });
  assert.deepEqual(result, [png, jpg]);
});

test('a text-only paste gives nothing, so it is left to paste as text', () => {
  assert.deepEqual(imageFilesFromClipboardData({ files: [], items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }] }), []);
  assert.deepEqual(imageFilesFromClipboardData(null), []);
  assert.deepEqual(imageFilesFromClipboardData({}), []);
});

test('an image listed only under items is found there', () => {
  const png = file('image.png', 'image/png');
  const items = [
    { kind: 'string', type: 'text/plain', getAsFile: () => null },
    { kind: 'file', type: 'image/png', getAsFile: () => png },
    { kind: 'file', type: 'image/png', getAsFile: () => null },
  ];
  assert.deepEqual(imageFilesFromClipboardData({ files: [], items }), [png]);
});
