// The Year view's pinned month or week is let go of by pressing on empty space
// anywhere on the page -- the calendar around the days, the header, the gallery
// tab, the project list -- and not by pressing on anything that does something.
// App.jsx listens for the press; this decides whether it was on empty space.

// What a press can land on that has a job of its own: the month names and the
// days (they pin and open), buttons and links, fields and sliders, photos.
const DOES_SOMETHING = [
  '[data-year-target]',
  'button', 'a', 'input', 'select', 'textarea', 'label', 'summary', 'img', 'video',
  '[role="button"]', '[role="slider"]', '[role="menuitem"]', '[role="option"]', '[role="tab"]',
  '[contenteditable="true"]', '[draggable="true"]',
].join(',');

// Dialogs, menus laid over the page and toasts: their own empty space is not the
// page's, and clicking it shouldn't change what the page shows underneath.
const LAID_OVER_THE_PAGE = '.fixed, [role="dialog"], [aria-modal="true"]';

// `event` is the press (pointerdown). True when it was on empty space.
export function releasesYearPin(event) {
  const el = event.target;
  if (typeof Element === 'undefined' || !(el instanceof Element)) return false;
  if (event.button !== undefined && event.button !== 0) return false;
  if (!el.closest('#root')) return false;
  if (el.closest(LAID_OVER_THE_PAGE)) return false;
  if (el.closest(DOES_SOMETHING)) return false;
  // Anything with a pointer, a resize arrow or a grabbing hand is for using, even
  // if it isn't a button -- a project row, a panel's drag edge. The cursor is
  // inherited, so the text inside such a thing counts too.
  const cursor = getComputedStyle(el).cursor;
  if (cursor !== 'auto' && cursor !== 'default') return false;
  // A press on a scrollbar lands on the scrolled box itself, at a spot outside
  // what it shows: dragging the gallery's scrollbar mustn't reset the gallery.
  const box = el.getBoundingClientRect();
  if (event.clientX - box.left >= el.clientWidth || event.clientY - box.top >= el.clientHeight) {
    if (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth) return false;
  }
  return true;
}
