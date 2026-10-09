import { weekStartFor } from './yearGallery.js';

// The desktop Year view's "blocks" layout: twelve small month calendars (four
// across, three down) instead of the dot grid's twelve columns. It does what the
// dot grid does -- pointing at a month name or a day gives the gallery and the
// project list a quick look at that month or week, a click pins it, a click on
// the pinned one opens it -- but the weeks run along rows, as on a wall
// calendar. App.jsx owns the state (hover, pin) and draws each day's dot
// (`renderDay`), so a day looks the same in both layouts; this only lays it out.
//
// A month name and a day are marked data-year-target: those are what a click
// pins or opens. Everything else (the gaps, the weekday letters, the blank
// cells) is empty space, and pressing it lets go of the pin (see yearPin.js).

const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const WEEK_ROWS = 6; // the most a month ever spans, so every block is the same height

export default function YearBlocks({
  year,
  monthNames,
  renderDay,
  litMonths,
  highlightedWeekStarts,
  onMonthEnter,
  onMonthLeave,
  onMonthClick,
  onDayEnter,
  onDayLeave,
  onWeekClick,
  radius,
}) {
  return (
    <div className="h-full w-full min-h-0 min-w-0 overflow-y-auto">
      <div
        className="grid h-full"
        style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gridAutoRows: 'minmax(176px, 1fr)', gap: '10px' }}
      >
        {monthNames.map((monthLabel, mIdx) => {
          const startOffset = new Date(year, mIdx, 1).getDay();
          const daysInMonth = new Date(year, mIdx + 1, 0).getDate();
          const lit = litMonths.has(mIdx);

          return (
            <div
              key={monthLabel}
              className="flex flex-col min-h-0 border px-2 pt-1.5 pb-1 transition-colors"
              style={{
                borderRadius: `${radius}px`,
                // No frame of its own at rest -- the month sits straight on the
                // calendar. The border is kept (transparent) so lighting a month
                // up doesn't nudge anything.
                borderColor: lit ? 'rgb(245 158 11)' : 'transparent',
                backgroundColor: lit ? 'rgb(245 158 11 / 0.1)' : 'transparent',
              }}
            >
              <div className="flex items-center justify-between shrink-0 mb-0.5">
                <span
                  data-year-target
                  onClick={() => onMonthClick(mIdx)}
                  onMouseEnter={() => onMonthEnter(mIdx)}
                  onMouseLeave={onMonthLeave}
                  className="text-[11px] font-bold tracking-wide px-1.5 py-0.5 rounded cursor-pointer"
                  style={{ backgroundColor: lit ? 'rgb(245 158 11 / 0.2)' : 'transparent' }}
                >
                  {monthLabel}
                </span>
              </div>

              <div className="grid grid-cols-7 shrink-0">
                {WEEKDAY_LETTERS.map((letter, i) => (
                  <div
                    key={i}
                    className={`text-center text-[8px] font-black ${i === 0 || i === 6 ? '' : 'opacity-40'}`}
                    style={{ color: i === 0 || i === 6 ? 'var(--theme-primary)' : undefined }}
                  >
                    {letter}
                  </div>
                ))}
              </div>

              <div className="flex-1 min-h-0 grid" style={{ gridTemplateRows: `repeat(${WEEK_ROWS}, minmax(0, 1fr))` }}>
                {Array.from({ length: WEEK_ROWS }, (_, weekIndex) => {
                  const cells = Array.from({ length: 7 }, (_, col) => {
                    const dayNum = weekIndex * 7 + col - startOffset + 1;
                    return dayNum >= 1 && dayNum <= daysInMonth ? dayNum : null;
                  });
                  const firstCol = cells.findIndex((n) => n !== null);
                  const lastCol = cells.length - 1 - [...cells].reverse().findIndex((n) => n !== null);
                  const weekLit = firstCol !== -1 && highlightedWeekStarts.has(weekStartFor(year, mIdx, weekIndex).getTime());

                  return (
                    <div key={weekIndex} className="relative grid grid-cols-7 items-center min-h-0">
                      {weekLit && (
                        <span
                          aria-hidden="true"
                          className="absolute pointer-events-none border border-amber-500 bg-amber-500/20 rounded-full"
                          style={{ top: 1, bottom: 1, left: `calc(${firstCol} * 100% / 7 + 1px)`, right: `calc(${6 - lastCol} * 100% / 7 + 1px)` }}
                        />
                      )}
                      {cells.map((dayNum, col) => {
                        if (dayNum === null) return <div key={col} />;
                        const dateObj = new Date(year, mIdx, dayNum);
                        return (
                          <div
                            key={col}
                            data-year-target
                            onClick={() => onWeekClick(mIdx, weekIndex)}
                            onMouseEnter={() => onDayEnter(mIdx, weekIndex, dateObj)}
                            onMouseLeave={onDayLeave}
                            className="relative h-full flex items-center justify-center cursor-pointer"
                          >
                            {renderDay(dateObj, dayNum)}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
