// Pure helpers for the Year view's gallery tab (no React, no DOM), so they can
// be unit-tested with node:test.

const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The Sunday that starts the calendar week the Year grid's week row
// (mIdx, weekIndex) belongs to. The grid draws a week that straddles two
// months as two rows (Mar 29-31 at the end of March, Apr 1-4 at the start of
// April), but it is ONE week: both rows give the same Sunday (Mar 29), so a
// highlight or a filter can treat them as one. weekIndex is the grid's own
// row number within the month: row 0 holds the month's first days up to its
// first Saturday, since the grid's columns start on Sunday.
export function weekStartFor(year, mIdx, weekIndex) {
  const daysInMonth = new Date(year, mIdx + 1, 0).getDate();
  const startOffset = new Date(year, mIdx, 1).getDay();
  const day = Math.min(daysInMonth, Math.max(1, weekIndex * 7 - startOffset + 1));
  return new Date(year, mIdx, day - new Date(year, mIdx, day).getDay());
}

// The Sunday that starts the week containing `dateObj`.
export const weekStartOf = (dateObj) => new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate() - dateObj.getDay());

// The date range the gallery shows for `filter`: null (the whole year), a
// month ({ kind: 'month', mIdx }) or a calendar week ({ kind: 'week',
// weekStart }, weekStart the Sunday's time -- see weekStartFor). A week is
// seven days even across a month boundary ("Mar 29–Apr 4"); only the year's
// own edges cut it short, since the grid shows one year at a time.
export function yearGalleryRange(year, filter) {
  if (!filter) {
    return { start: new Date(year, 0, 1), end: new Date(year, 11, 31), label: String(year) };
  }
  if (filter.kind === 'month') {
    const { mIdx } = filter;
    return { start: new Date(year, mIdx, 1), end: new Date(year, mIdx + 1, 0), label: `${MONTH_LONG[mIdx]} ${year}` };
  }
  const weekStart = new Date(filter.weekStart);
  const weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6);
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31);
  const start = weekStart < yearStart ? yearStart : weekStart;
  const end = weekEnd > yearEnd ? yearEnd : weekEnd;
  return { start, end, label: formatDayRange(start, end) };
}

// "Mar 8–14", "Mar 29–Apr 4", or "Mar 8" for a single day.
function formatDayRange(start, end) {
  if (start.getMonth() !== end.getMonth()) {
    return `${MONTH_SHORT[start.getMonth()]} ${start.getDate()}–${MONTH_SHORT[end.getMonth()]} ${end.getDate()}`;
  }
  const days = start.getDate() === end.getDate() ? `${start.getDate()}` : `${start.getDate()}–${end.getDate()}`;
  return `${MONTH_SHORT[start.getMonth()]} ${days}`;
}

// Every entry with a photo between start and end (inclusive), as
// { log, dateObj }, oldest first or newest first. Entries on the same day
// keep the order getLogsForDate gave them in either direction, so a day's
// photos don't shuffle when the order is flipped.
export function collectYearPhotos(getLogsForDate, start, end, newestFirst) {
  const days = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateObj = new Date(d);
    const photos = getLogsForDate(dateObj).filter((log) => log.imageUrl).map((log) => ({ log, dateObj }));
    if (photos.length) days.push(photos);
  }
  if (newestFirst) days.reverse();
  return days.flat();
}

// Splits the photos (as collectYearPhotos returns them, in either order) into
// the sections the gallery shows, each { key, label, photos }, in the order
// they appear: the whole year is grouped by month ("March"), a month by
// calendar week ("Mar 8–14", cut at the month's edges so a week that runs into
// the next month reads "Mar 29–31"), and a single week isn't grouped at all
// (one section with no label). Months and weeks with no photos are left out.
// `range` is the { start, end } the photos were collected for.
export function groupYearPhotos(photos, filter, range) {
  if (filter?.kind === 'week') return photos.length ? [{ key: 'week', label: null, photos }] : [];
  const keyOf = filter ? (d) => weekStartOf(d).getTime() : (d) => d.getMonth();
  const labelOf = filter
    ? (d) => {
        const weekStart = weekStartOf(d);
        const weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6);
        return formatDayRange(weekStart < range.start ? range.start : weekStart, weekEnd > range.end ? range.end : weekEnd);
      }
    : (d) => MONTH_LONG[d.getMonth()];
  const groups = [];
  for (const photo of photos) {
    const key = keyOf(photo.dateObj);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.photos.push(photo);
    else groups.push({ key, label: labelOf(photo.dateObj), photos: [photo] });
  }
  return groups;
}

// The proportions a gallery frame can take (width : height), landscape first,
// then portrait. `id` is what gets remembered; `label` is for the tooltip.
export const YEAR_GALLERY_RATIOS = [
  { id: '1:1', label: 'Square', w: 1, h: 1 },
  { id: '4:3', label: 'Landscape 4:3', w: 4, h: 3 },
  { id: '3:2', label: 'Landscape 3:2', w: 3, h: 2 },
  { id: '16:9', label: 'Wide 16:9', w: 16, h: 9 },
  { id: '3:4', label: 'Portrait 3:4', w: 3, h: 4 },
  { id: '2:3', label: 'Portrait 2:3', w: 2, h: 3 },
];

// The ratio with this id, or the square one for anything unknown (a stale or
// hand-edited saved value).
export const yearGalleryRatio = (id) => YEAR_GALLERY_RATIOS.find((r) => r.id === id) || YEAR_GALLERY_RATIOS[0];
