import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  projectTimerKey,
  formatDuration,
  formatClock,
  dialSweepDegrees,
  timerElapsedMs,
  buildSessionNoteText,
  buildSessionTitle,
  MAX_SESSION_TITLE_PROJECT_LENGTH as CLIENT_MAX_TITLE_PROJECT,
  cleanNoteText,
  MAX_SESSION_NOTES as CLIENT_MAX_NOTES,
  MAX_SESSION_NOTE_LENGTH as CLIENT_MAX_NOTE_LENGTH,
  formatMinutes,
  clockLabel,
  localDateString,
  sumProjectMinutes,
} from '../../src/timeFormat.js';
import {
  formatMinutesLabel,
  buildSessionNote,
  sanitizeSessionNotes,
  buildSessionTitle as buildServerSessionTitle,
  MAX_SESSION_TITLE_PROJECT_LENGTH,
  MAX_SESSION_NOTES,
  MAX_SESSION_NOTE_LENGTH,
} from '../_lib/timeTracking.js';

test('formatDuration renders the running clock', () => {
  assert.equal(formatDuration(0), '0:00:00');
  assert.equal(formatDuration(5_000), '0:00:05');
  assert.equal(formatDuration(65_000), '0:01:05');
  assert.equal(formatDuration(3_725_000), '1:02:05');
  assert.equal(formatDuration(-500), '0:00:00');
});

test('formatClock pads the hour for the dial', () => {
  assert.equal(formatClock(2_724_000), '00:45:24');
  assert.equal(formatClock(0), '00:00:00');
  assert.equal(formatClock(3_725_000), '01:02:05');
  assert.equal(formatClock(12 * 3600_000 + 5_000), '12:00:05');
});

test('dialSweepDegrees sweeps once round per hour and never reaches 360', () => {
  assert.equal(dialSweepDegrees(0), 0);
  assert.equal(dialSweepDegrees(15 * 60_000), 90);
  assert.equal(dialSweepDegrees(2_724_000), 272.4); // 45:24 into the hour
  assert.equal(dialSweepDegrees(3_599_000), 359.9);
  assert.equal(dialSweepDegrees(3_600_000), 0); // wraps at the hour
  assert.equal(dialSweepDegrees(3_600_000 + 30 * 60_000), 180);
  assert.equal(dialSweepDegrees(-5_000), 0);
});

test('timerElapsedMs subtracts pauses and freezes while paused or ended', () => {
  const MIN = 60_000;
  const t0 = 1_000_000;
  // Running, never paused.
  assert.equal(timerElapsedMs({ startedAt: t0 }, t0 + 10 * MIN), 10 * MIN);
  // Running after a 4-minute pause that already ended.
  assert.equal(timerElapsedMs({ startedAt: t0, pausedMs: 4 * MIN }, t0 + 10 * MIN), 6 * MIN);
  // Paused now: the clock stands at the moment of the pause, however late `now` is.
  assert.equal(timerElapsedMs({ startedAt: t0, pausedAt: t0 + 7 * MIN }, t0 + 60 * MIN), 7 * MIN);
  assert.equal(timerElapsedMs({ startedAt: t0, pausedMs: 2 * MIN, pausedAt: t0 + 7 * MIN }, t0 + 60 * MIN), 5 * MIN);
  // Finished: endedAt wins, even over a leftover pausedAt.
  assert.equal(timerElapsedMs({ startedAt: t0, pausedMs: MIN, endedAt: t0 + 9 * MIN }, t0 + 60 * MIN), 8 * MIN);
  assert.equal(timerElapsedMs({ startedAt: t0, pausedAt: t0 + 9 * MIN, endedAt: t0 + 9 * MIN }, t0 + 60 * MIN), 9 * MIN);
  // Never negative (clock adjustments).
  assert.equal(timerElapsedMs({ startedAt: t0 }, t0 - 5 * MIN), 0);
});

test('formatMinutes matches the server-side session title format', () => {
  for (const minutes of [0, 1, 45, 59.6, 60, 80, 120, 725]) {
    assert.equal(formatMinutes(minutes), formatMinutesLabel(minutes));
  }
});

test('clockLabel and localDateString use local time, zero-padded', () => {
  const d = new Date(2026, 9, 5, 9, 7); // Oct 5 2026, 09:07 local
  assert.equal(clockLabel(d), '09:07');
  assert.equal(localDateString(d), '2026-10-05');
  // 11:59pm stays on its own date (a toISOString-based version would not).
  assert.equal(localDateString(new Date(2026, 11, 31, 23, 59)), '2026-12-31');
});

const logs = [
  { source: 'Work', Projects: 'Site', year: 2026, monthNumber: 10, dayNumber: 3, minutes: 60 },
  { source: 'Work', Projects: 'Site', year: 2026, monthNumber: 9, dayNumber: 20, minutes: 30 },
  { source: 'Work', Projects: 'Blog', year: 2026, monthNumber: 10, dayNumber: 4, minutes: 15 },
  { source: 'Home', Projects: 'Site', year: 2026, monthNumber: 10, dayNumber: 4, minutes: 5 },
  { source: 'Work', Projects: 'Site', year: 2026, monthNumber: 10, dayNumber: 5 }, // ordinary entry, no minutes
];

test('sumProjectMinutes totals per source+project, ignoring entries without minutes', () => {
  const { all, inRange } = sumProjectMinutes(logs, null);
  assert.equal(inRange, null);
  assert.equal(all.get(projectTimerKey('Work', 'Site')), 90);
  assert.equal(all.get(projectTimerKey('Work', 'Blog')), 15);
  // Same project name in a different source is a different project.
  assert.equal(all.get(projectTimerKey('Home', 'Site')), 5);
});

test('sumProjectMinutes also totals within an inclusive range', () => {
  const range = { start: new Date(2026, 9, 1), end: new Date(2026, 9, 31) };
  const { all, inRange } = sumProjectMinutes(logs, range);
  assert.equal(all.get(projectTimerKey('Work', 'Site')), 90);
  assert.equal(inRange.get(projectTimerKey('Work', 'Site')), 60); // the Sept 20 session is outside
  assert.equal(inRange.get(projectTimerKey('Work', 'Blog')), 15);
});

test('sumProjectMinutes falls back to the same labels the sidebar uses', () => {
  const { all } = sumProjectMinutes([{ year: 2026, monthNumber: 10, dayNumber: 1, minutes: 10 }], null);
  assert.equal(all.get(projectTimerKey('Activity Log', 'Untitled Project')), 10);
});

test('the client note text matches what the server writes to Notion', () => {
  for (const input of [
    { minutes: 80, startLabel: '14:05', endLabel: '15:25', notes: [{ at: '14:12', text: 'outlined the intro' }, { at: '', text: 'undated' }] },
    { minutes: 1, startLabel: '09:00', endLabel: '09:01', notes: [] },
    { minutes: 45, notes: [{ at: '10:30', text: 'no range' }] },
  ]) {
    assert.equal(buildSessionNoteText(input), buildSessionNote(input));
  }
});

test('client and server agree on the note caps and cleaning', () => {
  assert.equal(CLIENT_MAX_NOTES, MAX_SESSION_NOTES);
  assert.equal(CLIENT_MAX_NOTE_LENGTH, MAX_SESSION_NOTE_LENGTH);
  const messy = '  two\nlines   here ' + 'x'.repeat(600);
  assert.equal(cleanNoteText(messy), sanitizeSessionNotes([{ at: '10:00', text: messy }])[0].text);
  assert.equal(cleanNoteText('   '), '');
  assert.equal(cleanNoteText(undefined), '');
});

test('the client entry title matches what the server writes to Notion', () => {
  for (const input of [
    { dateStr: '2026-10-05', projectTitle: 'Personal Blog', minutes: 80 },
    { dateStr: '2026-01-09', projectTitle: '  Two\n  lines ', minutes: 45 },
    { dateStr: '2026-12-31', projectTitle: 'x'.repeat(300), minutes: 120 },
    { dateStr: '2026-10-05', projectTitle: '', minutes: 7 },
    { dateStr: '2026-10-05', minutes: 7 },
  ]) {
    assert.equal(buildSessionTitle(input), buildServerSessionTitle(input));
  }
  assert.equal(CLIENT_MAX_TITLE_PROJECT, MAX_SESSION_TITLE_PROJECT_LENGTH);
});
