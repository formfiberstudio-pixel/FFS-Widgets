import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findMinutesPropName,
  formatMinutesLabel,
  buildSessionNote,
  parseMinutesFromNote,
  extractMinutes,
  buildSessionProperties,
  sanitizeSessionNotes,
  buildSessionTitle,
  MAX_SESSION_TITLE_PROJECT_LENGTH,
  toRichTextChunks,
  MAX_SESSION_NOTES,
  MAX_SESSION_NOTE_LENGTH,
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

test('sanitizeSessionNotes keeps real notes, one line each, and drops the rest', () => {
  const clean = sanitizeSessionNotes([
    { at: '14:12', text: '  outlined\nthe intro  ' },
    { at: '14:20', text: '   ' },
    { at: 'soon', text: 'bad time label' },
    { text: 'no time at all' },
    null,
    'a bare string',
    { at: '14:30', text: 42 },
  ]);
  assert.deepEqual(clean, [
    { at: '14:12', text: 'outlined the intro' },
    { at: '', text: 'bad time label' },
    { at: '', text: 'no time at all' },
  ]);
  assert.deepEqual(sanitizeSessionNotes(undefined), []);
  assert.deepEqual(sanitizeSessionNotes('nope'), []);
});

test('sanitizeSessionNotes caps the list and each note', () => {
  const many = Array.from({ length: MAX_SESSION_NOTES + 20 }, (_, i) => ({ at: '10:00', text: `n${i}` }));
  assert.equal(sanitizeSessionNotes(many).length, MAX_SESSION_NOTES);
  const [long] = sanitizeSessionNotes([{ at: '10:00', text: 'x'.repeat(MAX_SESSION_NOTE_LENGTH + 100) }]);
  assert.equal(long.text.length, MAX_SESSION_NOTE_LENGTH);
});

test('buildSessionNote puts the marker on line 1 and one line per note after it', () => {
  const text = buildSessionNote({
    minutes: 80,
    startLabel: '14:05',
    endLabel: '15:25',
    notes: [{ at: '14:12', text: 'outlined the intro' }, { at: '', text: 'undated' }],
  });
  assert.equal(text, '⏱ 80 min · 14:05–15:25\n14:12 · outlined the intro\nundated');
  // The minutes still read back from the first line, even if a note quotes a marker.
  assert.equal(parseMinutesFromNote(buildSessionNote({ minutes: 80, notes: [{ at: '', text: '⏱ 999 min' }] })), 80);
  // No notes: exactly the old single line.
  assert.equal(buildSessionNote({ minutes: 80, startLabel: '14:05', endLabel: '15:25' }), '⏱ 80 min · 14:05–15:25');
});

test('toRichTextChunks stays under the limit, breaks only between lines, and loses nothing', () => {
  const lines = Array.from({ length: 40 }, (_, i) => `${i} ${'w'.repeat(480)}`);
  const text = lines.join('\n');
  const chunks = toRichTextChunks(text);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(chunk.text.content.length <= 2000);
  assert.equal(chunks.map((c) => c.text.content).join(''), text);
  assert.equal(toRichTextChunks('one line').length, 1);
});

test('buildSessionTitle is date_project_length, with dots in the date', () => {
  assert.equal(buildSessionTitle({ dateStr: '2026-10-05', projectTitle: 'Personal Blog', minutes: 80 }), '2026.10.05_Personal Blog_1h 20m');
  assert.equal(buildSessionTitle({ dateStr: '2026-01-09', projectTitle: 'Site', minutes: 45 }), '2026.01.09_Site_45m');
  assert.equal(buildSessionTitle({ dateStr: '2026-01-09', projectTitle: 'Site', minutes: 120 }), '2026.01.09_Site_2h');
});

test('buildSessionTitle tidies the project name and falls back without one', () => {
  assert.equal(buildSessionTitle({ dateStr: '2026-10-05', projectTitle: '  Two\n  lines  ', minutes: 5 }), '2026.10.05_Two lines_5m');
  const long = buildSessionTitle({ dateStr: '2026-10-05', projectTitle: 'x'.repeat(300), minutes: 5 });
  assert.equal(long, `2026.10.05_${'x'.repeat(MAX_SESSION_TITLE_PROJECT_LENGTH)}_5m`);
  // No project name (an older client): the previous title format.
  assert.equal(buildSessionTitle({ dateStr: '2026-10-05', minutes: 80 }), '⏱ 1h 20m');
  assert.equal(buildSessionTitle({ dateStr: '2026-10-05', projectTitle: '   ', minutes: 80 }), '⏱ 1h 20m');
});
