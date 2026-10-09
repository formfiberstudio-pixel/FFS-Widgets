// The sizes behind the desktop Year view's blocks layout (YearBlocks.jsx), kept
// apart so they can be tested.

export const COLUMNS = 3;
export const ROWS = 4;
export const WEEK_ROWS = 6; // the most a month ever spans, so every block is the same height
export const GAP = 10;
// What a block spends on everything but its weeks: padding, the month name, the
// weekday letters.
const BLOCK_CHROME = 44;

// The least height a month's block is given: room for its six week rows at the day
// dots' size (the same size the dot grid draws them at). A window too short for
// four such rows scrolls instead of squeezing the weeks together.
export function minBlockHeightFor(dotSize) {
  return WEEK_ROWS * (dotSize + 1) + BLOCK_CHROME;
}
