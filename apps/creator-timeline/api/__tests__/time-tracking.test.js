import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findMinutesPropName,
  formatMinutesLabel,
  buildSessionNote,
  parseMinutesFromNote,
  extractMinutes,
  buildSessionProperties,
} from '../_lib/timeTracking.js';

test('formatMinutesLabel covers minutes only, hours only and both', () => {
  assert.equal(formatMinutesLabel(45), '45m');
  assert.equal(formatMinutesLabel(120), '2h');
  assert.equal(formatMinutesLabel(80), '1h 20m');
  assert.equal(formatMinutesLabel(0), '0m');
  assert.equal(formatMinutesLabel(59.6), '1h');
});

test('the session note round-trips through parseMinutesFromNote', () => {
  const note = buildSessionNote({ minutes: 80, startLabel: '14:05', endLabel: '15:25' });
  assert.equal(note, '⏱ 80 min · 14:05–15:25');
  assert.equal(parseMinutesFromNote(note), 80);
  // The range is optional.
  assert.equal(buildSessionNote({ minutes: 7 }), '⏱ 7 min');
  assert.equal(parseMinutesFromNote(buildSessionNote({ minutes: 7 })), 7);
});

test('parseMinutesFromNote ignores text that has no marker', () => {
  assert.equal(parseMinutesFromNote('Planning session for the Q4 campaign'), 0);
  assert.equal(parseMinutesFromNote('⏱ soon'), 0);
  assert.equal(parseMinutesFromNote(''), 0);
  assert.equal(parseMinutesFromNote(undefined), 0);
});

test('findMinutesPropName matches common names, only on Number properties', () => {
  assert.equal(findMinutesPropName({ Minutes: { type: 'number' } }), 'Minutes');
  assert.equal(findMinutesPropName({ 'Time Spent': { type: 'number' } }), 'Time Spent');
  assert.equal(findMinutesPropName({ duration: { type: 'number' } }), 'duration');
  // Right name, wrong type: not a usable minutes property.
  assert.equal(findMinutesPropName({ Minutes: { type: 'rich_text' } }), null);
  // Right type, unrelated name.
  assert.equal(findMinutesPropName({ Rating: { type: 'number' } }), null);
  assert.equal(findMinutesPropName(undefined), null);
});

test('extractMinutes prefers a positive Number property, then falls back to the body marker', () => {
  const withProp = { Minutes: { type: 'number', number: 90 } };
  assert.equal(extractMinutes(withProp, '⏱ 80 min'), 90);
  // An empty/zero property doesn't hide the marker.
  assert.equal(extractMinutes({ Minutes: { type: 'number', number: null } }, '⏱ 80 min'), 80);
  assert.equal(extractMinutes({ Minutes: { type: 'number', number: 0 } }, '⏱ 80 min'), 80);
  // No property at all: marker only.
  assert.equal(extractMinutes({ Name: { type: 'title' } }, '⏱ 25 min · 09:00–09:25'), 25);
  // An ordinary entry has no minutes.
  assert.equal(extractMinutes({ Name: { type: 'title' } }, 'Filmed the Halloween special'), 0);
});

const REFERENCE = {
  Name: { type: 'title', title: [{ plain_text: 'Existing entry' }] },
  'Post-Date': { type: 'date', date: { start: '2026-08-01' } },
  Projects: { type: 'relation', relation: [{ id: 'proj-a' }] },
  Status: { type: 'select', select: { name: 'Done' } },
};

test('buildSessionProperties copies title/date/relation shape and drops everything else', () => {
  const { properties, hasRelation } = buildSessionProperties(REFERENCE, {
    title: '⏱ 1h 20m',
    dateStr: '2026-10-05',
    minutes: 80,
  });
  assert.equal(hasRelation, true);
  assert.deepEqual(properties.Name, { title: [{ text: { content: '⏱ 1h 20m' } }] });
  assert.deepEqual(properties['Post-Date'], { date: { start: '2026-10-05' } });
  assert.deepEqual(properties.Projects, { relation: [{ id: 'proj-a' }] });
  // Unrelated properties (a Status select) are not copied onto the session.
  assert.equal('Status' in properties, false);
  // No minutes property in this database, so none is written.
  assert.equal(Object.keys(properties).length, 3);
});

test('buildSessionProperties points the relation at projectPageId when given', () => {
  const { properties } = buildSessionProperties(REFERENCE, {
    title: '⏱ 5m', dateStr: '2026-10-05', minutes: 5, projectPageId: 'proj-new',
  });
  assert.deepEqual(properties.Projects, { relation: [{ id: 'proj-new' }] });
});

test('buildSessionProperties writes minutes into a matching Number property', () => {
  const { properties } = buildSessionProperties(
    { ...REFERENCE, Minutes: { type: 'number', number: null } },
    { title: '⏱ 1h 20m', dateStr: '2026-10-05', minutes: 79.6 }
  );
  assert.deepEqual(properties.Minutes, { number: 80 });
});

test('buildSessionProperties reports when no project relation could be set', () => {
  const noRelation = {
    Name: REFERENCE.Name,
    'Post-Date': REFERENCE['Post-Date'],
    Projects: { type: 'relation', relation: [] },
  };
  const { hasRelation, properties } = buildSessionProperties(noRelation, {
    title: '⏱ 5m', dateStr: '2026-10-05', minutes: 5,
  });
  assert.equal(hasRelation, false);
  assert.equal('Projects' in properties, false);
});
