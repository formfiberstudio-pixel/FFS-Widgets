// The sizes behind the desktop Year view's blocks layout (YearBlocks.jsx), kept
// apart so they can be tested.

export const COLUMNS = 3;
export const ROWS = 4;
export const WEEK_ROWS = 6; // the most a month ever spans, so every block is the same height
export const GAP = 10;
// The least height a month's block is given; a window shorter than the four rows
// need at this size scrolls instead of squeezing the weeks together.
export const MIN_BLOCK_HEIGHT = 128;
// What a block spends on everything but its weeks: padding, the month name, the
// weekday letters.
const BLOCK_CHROME = 44;
export const MIN_DOT = 14;

// The day dots follow the height the four rows are given, so a taller window gets
// roomier dots and a short one still fits them, up to `maxDot`.
export function dotSizeFor(availableHeight, maxDot) {
  const block = Math.max(MIN_BLOCK_HEIGHT, (availableHeight - GAP * (ROWS - 1)) / ROWS);
  const perWeek = (block - BLOCK_CHROME) / WEEK_ROWS;
  return Math.max(MIN_DOT, Math.min(maxDot, Math.floor(perWeek) - 3));
}
