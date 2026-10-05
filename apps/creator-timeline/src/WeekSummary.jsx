import { formatMinutes } from './timeFormat.js';

// The Week view's summary of the projects worked on that week: how long each
// was tracked for (timer sessions) and on how many days it has anything
// logged, plus the week's total. A row can be clicked to pick that project
// out in the week grid, the same highlight the other views' pills give.
// summary comes from summarizeWeekProjects (timeFormat.js).
export default function WeekSummary({ summary, rangeLabel, selectedTitle, onToggle, getDot }) {
  const { rows, totalMinutes } = summary;
  const projectCount = `${rows.length} project${rows.length === 1 ? '' : 's'}`;
  return (
    <section
      aria-label="Projects worked on this week"
      className="shrink-0 mt-3 border p-3"
      style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)', borderRadius: 'var(--theme-radius-md, 0.5rem)' }}
    >
      <div className="flex items-baseline justify-between gap-x-4 gap-y-1 flex-wrap">
        <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">{rangeLabel}</span>
        <span className="text-xs opacity-70 tabular-nums">
          {rows.length === 0
            ? 'Nothing logged'
            : `${projectCount} · ${totalMinutes > 0 ? `${formatMinutes(totalMinutes)} tracked` : 'no time tracked'}`}
        </span>
      </div>
      {rows.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2 max-h-28 overflow-y-auto pr-1">
          {rows.map((row) => {
            const selected = selectedTitle === row.title;
            const dimmed = Boolean(selectedTitle) && !selected;
            const detail = `${row.minutes > 0 ? `${formatMinutes(row.minutes)} · ` : ''}${row.days} day${row.days === 1 ? '' : 's'}`;
            return (
              <li key={row.key} className="min-w-0 max-w-full">
                <button
                  onClick={() => onToggle(row.title)}
                  aria-pressed={selected}
                  title={`${row.title}: ${detail}`}
                  className="flex items-center gap-2 max-w-full rounded-full border px-3 py-1 text-xs cursor-pointer transition-opacity"
                  style={{
                    backgroundColor: 'var(--theme-bg)',
                    borderColor: selected ? 'var(--theme-secondary)' : 'var(--theme-border)',
                    opacity: dimmed ? 0.45 : 1,
                  }}
                >
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: getDot(row) }} />
                  <span className="truncate font-semibold">{row.title}</span>
                  <span className="shrink-0 opacity-70 tabular-nums">{detail}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
