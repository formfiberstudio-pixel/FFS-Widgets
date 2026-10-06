// The Year view's right-hand tab: the year's photos as a gallery, the
// counterpart of the project list on the left. Which photos it shows follows
// the month or week in the year grid: hovering one is a quick look, a click
// pins it (the ✕ here, or leaving the view, lets go), and clicking the pinned
// one again opens it (see yearGalleryRange). The order toggles between oldest
// and newest first. Sized by dragging its left edge, like the project list.
// Clicking a photo opens that day.
export default function YearGalleryPanel({
  photos,
  rangeLabel,
  filtered,
  pinned,
  onClearFilter,
  newestFirst,
  onToggleOrder,
  onOpenDay,
  width,
  radius,
  onResizeStart,
  onPointerEnter,
  onPointerLeave,
}) {
  return (
    <aside
      style={{ width: `${width}px`, borderRadius: `${radius}px`, backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}
      className="shrink-0 h-full flex flex-col p-4 border shadow-sm relative lf-frame"
      onMouseEnter={onPointerEnter}
      onMouseLeave={onPointerLeave}
    >
      {/* Resize handle on the LEFT edge -- dragging it left widens the panel. */}
      <div
        onMouseDown={onResizeStart}
        className="absolute top-0 left-0 w-2.5 h-full cursor-col-resize z-30 group flex items-center justify-center"
        title="Click & drag to resize the gallery"
      >
        <div className="w-0.5 h-8 rounded-full bg-[var(--theme-border)] group-hover:bg-[var(--theme-primary)] transition-colors" />
      </div>

      <div className="mb-3 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold">Gallery</h2>
          <span className="text-xs opacity-60 tabular-nums">{photos.length} photo{photos.length === 1 ? '' : 's'}</span>
        </div>
        <div className="flex items-center justify-between gap-2 pb-2 border-b" style={{ borderColor: 'var(--theme-border)' }}>
          <span className="flex items-center gap-1 min-w-0">
            <span className="text-[11px] font-semibold truncate" style={{ color: filtered ? 'var(--theme-primary)' : undefined, opacity: filtered ? 1 : 0.7 }} title={pinned ? 'Pinned -- click that month or week again to open it' : filtered ? 'A quick look at the month or week you are pointing at -- click to pin it' : 'Point at a month or week for a quick look, click to pin it'}>
              {rangeLabel}
            </span>
            {pinned && (
              <button
                onClick={onClearFilter}
                title="Unpin -- show the whole year"
                aria-label="Unpin the month or week and show the whole year"
                className="shrink-0 text-[11px] leading-none px-1 cursor-pointer opacity-60 hover:opacity-100"
              >
                ✕
              </button>
            )}
          </span>
          <button
            onClick={onToggleOrder}
            title={newestFirst ? 'Showing newest first -- click to show oldest first' : 'Showing oldest first -- click to show newest first'}
            className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer opacity-60 hover:opacity-100 transition-opacity shrink-0"
          >
            <span>{newestFirst ? 'Newest first' : 'Oldest first'}</span>
            <span className="inline-block transition-transform" style={{ transform: newestFirst ? 'rotate(180deg)' : 'none' }}>↓</span>
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        {photos.length === 0 ? (
          <div className="h-full flex items-center justify-center text-center text-sm italic opacity-50 px-4">
            {filtered ? 'No photos in this period.' : 'No photos this year yet.'}
          </div>
        ) : (
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))' }}>
            {photos.map(({ log, dateObj }) => (
              <button
                key={log.id}
                onClick={() => onOpenDay(dateObj)}
                title={`${log.title || 'Untitled'} -- open this day`}
                className="group flex flex-col text-left cursor-pointer min-w-0"
              >
                <span
                  className="block aspect-square w-full overflow-hidden border lf-frame"
                  style={{ borderColor: 'var(--theme-border)', backgroundColor: 'var(--theme-bg)', borderRadius: `${radius}px` }}
                >
                  <img src={log.imageUrl} alt="" loading="lazy" className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105" />
                </span>
                <span className="mt-1 text-[10px] font-bold opacity-60 tabular-nums">
                  {dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
                <span className="text-[11px] font-semibold truncate">{log.title || 'Untitled'}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
