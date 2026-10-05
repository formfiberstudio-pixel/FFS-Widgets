// A compact year-by-year calendar for the project gallery's side panel --
// month labels in a two-per-row layout, each a miniature 7-column grid of
// plain day NUMBERS rather than boxed month cards -- logged days are a
// colored number, everything else a faint one, no per-month border/
// background so the whole thing reads as one light grid instead of a wall
// of cards. Hovering a logged day highlights the matching photo in the
// gallery grid and vice versa (see hoveredLogId/onHoverLog, lifted to the
// gallery view so both sides share one source of truth). Deliberately
// reuses the exact month-grid layout math (leading blanks for the first
// day's weekday, cell count rounded up to a full week) that the main
// calendar's Month view uses, just parameterized by an explicit
// year/month instead of `currentDate`, since this renders many months at
// once rather than one at a time.
import { useState } from 'react';
import { formatMinutes } from './timeFormat.js';

function buildMonthSlots(year, monthIndex) {
  const startDayOffset = new Date(year, monthIndex, 1).getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const totalSlots = Math.ceil((daysInMonth + startDayOffset) / 7) * 7;
  const slots = [];
  for (let i = 0; i < totalSlots; i++) {
    const dayNum = i - startDayOffset + 1;
    const isValid = dayNum > 0 && dayNum <= daysInMonth;
    slots.push(isValid ? dayNum : null);
  }
  return slots;
}

function MonthBlock({ year, monthIndex, logsByDay, hoveredLogId, onHoverLog }) {
  const slots = buildMonthSlots(year, monthIndex);
  const monthName = new Date(year, monthIndex, 1).toLocaleDateString('en-US', { month: 'short' });

  return (
    <div className="flex flex-col">
      <div className="text-[10px] font-bold uppercase tracking-wide opacity-50 mb-1.5">{monthName}</div>
      <div className="grid grid-cols-7 gap-y-1">
        {slots.map((dayNum, i) => {
          if (dayNum === null) return <div key={i} />;
          const log = logsByDay[dayNum];
          const isHovered = Boolean(log) && log.id === hoveredLogId;
          return (
            <div
              key={i}
              onMouseEnter={() => log && onHoverLog(log.id)}
              onMouseLeave={() => log && onHoverLog(null)}
              title={log ? `${monthName} ${dayNum}` : undefined}
              className="flex items-center justify-center"
              style={{ cursor: log ? 'pointer' : 'default' }}
            >
              <span
                className="text-[10px] leading-none tabular-nums rounded-full flex items-center justify-center transition-all"
                style={{
                  width: '16px',
                  height: '16px',
                  fontWeight: log ? 700 : 400,
                  color: log ? (isHovered ? 'var(--theme-on-secondary)' : 'var(--theme-on-primary)') : 'var(--theme-text)',
                  backgroundColor: log ? (isHovered ? 'var(--theme-secondary)' : 'var(--theme-primary)') : 'transparent',
                  opacity: log ? 1 : 0.35,
                  transform: isHovered ? 'scale(1.25)' : 'scale(1)',
                }}
              >
                {dayNum}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// minutesByYear: { 2026: 80, ... } of timer-tracked minutes per year, shown at
// the right of each year heading; a year that has tracked time but no photos
// still gets its heading (with an empty calendar). Each year heading toggles
// that year's months open or closed.
export default function GalleryMiniCalendar({ logs, hoveredLogId, onHoverLog, newestFirst, minutesByYear = {} }) {
  const [collapsedYears, setCollapsedYears] = useState({});
  const byYear = {};
  logs.forEach((log) => {
    const y = Number(log.year);
    const m = Number(log.monthNumber) - 1;
    const d = Number(log.dayNumber);
    if (!byYear[y]) byYear[y] = {};
    if (!byYear[y][m]) byYear[y][m] = {};
    // First entry wins if this project ever logs twice in one day -- the
    // mini calendar only needs one representative photo per dot.
    if (!byYear[y][m][d]) byYear[y][m][d] = log;
  });
  // Matches whichever direction the photo grid next to this panel is
  // currently sorted in (see App.jsx's shared galleryNewestFirst toggle) --
  // the two disagreeing on chronological direction was the actual
  // confusion this was built to fix.
  const allYears = new Set(Object.keys(byYear).map(Number));
  for (const [year, minutes] of Object.entries(minutesByYear)) {
    if (minutes > 0) allYears.add(Number(year));
  }
  const years = [...allYears].sort((a, b) => (newestFirst ? b - a : a - b));

  if (years.length === 0) {
    return <div className="text-xs italic opacity-50 p-3">No dated entries yet.</div>;
  }

  return (
    <div className="space-y-5">
      {years.map((year) => {
        const collapsed = collapsedYears[year] === true;
        const yearMinutes = minutesByYear[year] || 0;
        return (
          <div key={year}>
            <div className="flex items-center justify-between gap-3 mb-2">
              <button
                onClick={() => setCollapsedYears((prev) => ({ ...prev, [year]: !prev[year] }))}
                aria-expanded={!collapsed}
                title={collapsed ? `Show ${year}` : `Hide ${year}`}
                className="flex items-center gap-1.5 text-xs font-black opacity-70 hover:opacity-100 cursor-pointer"
              >
                <span>{year}</span>
                <span className="inline-block text-[10px] transition-transform" style={{ transform: collapsed ? 'rotate(-90deg)' : 'none' }}>▾</span>
              </button>
              {yearMinutes > 0 && (
                <span className="text-xs font-semibold tabular-nums opacity-70" title={`Time tracked in ${year}`}>{formatMinutes(yearMinutes)}</span>
              )}
            </div>
            {!collapsed && (
              <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                {Array.from({ length: 12 }, (_, m) => (
                  <MonthBlock
                    key={m}
                    year={year}
                    monthIndex={m}
                    logsByDay={byYear[year]?.[m] || {}}
                    hoveredLogId={hoveredLogId}
                    onHoverLog={onHoverLog}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
