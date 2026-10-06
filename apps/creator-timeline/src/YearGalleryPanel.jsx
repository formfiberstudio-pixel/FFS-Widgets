// The Year view's right-hand tab: the year's photos as a gallery, the
// counterpart of the project list on the left. Which photos it shows follows
// the month or week in the year grid: hovering one is a quick look, a click
// pins it (the ✕ here, or leaving the view, lets go), and clicking the pinned
// one again opens it (see yearGalleryRange). The order toggles between oldest
// and newest first. Sized by dragging its left edge, like the project list.
// Clicking a photo opens that day. `photos` is every photo shown (for the
// count); `groups` is the same photos in the sections to draw -- the year by
// month, a month by week, a week as one (see groupYearPhotos).
//
// `width` is the width asked for. The panel is a flex item that may shrink
// (down to `minWidth`) so the year grid beside it keeps its own minimum when
// the project list or the window leaves too little room; `panelRef` lets the
// caller read the width it actually has.
export default function YearGalleryPanel({
  panelRef,
  photos,
  groups,
  rangeLabel,
  filtered,
  pinned,
  onClearFilter,
  newestFirst,
  onToggleOrder,
  onOpenDay,
  thumbSize,
  minThumbSize,
  maxThumbSize,
  onThumbSizeChange,
  width,
  minWidth,
  radius,
  onResizeStart,
  onPointerEnter,
  onPointerLeave,
}) {
  return (
    <aside
      ref={panelRef}
      style={{ flex: `0 1 ${width}px`, minWidth: `${minWidth}px`, borderRadius: `${radius}px`, backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}
      className="h-full flex flex-col p-4 border shadow-sm relative lf-frame"
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
        <div className="flex items-center justify-between gap-3 mb-2">
          <h2 className="text-sm font-bold">Gallery</h2>
          {/* Photo size: the width of each frame (never wider than the panel). */}
          <input
            type="range"
            min={minThumbSize}
            max={maxThumbSize}
            step={8}
            value={thumbSize}
            onChange={(e) => onThumbSizeChange(Number(e.target.value))}
            title="Photo size"
            aria-label="Photo size"
            className="min-w-0 flex-1 max-w-24 h-1 cursor-pointer"
            style={{ accentColor: 'var(--theme-primary)' }}
          />
          <span className="text-xs opacity-60 tabular-nums shrink-0">{photos.length} photo{photos.length === 1 ? '' : 's'}</span>
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
          <div className="flex flex-col gap-4">
            {groups.map((group) => (
              <section key={group.key}>
                {/* The group's heading (a month, or a week) -- stays at the top
                    of the scroll area while its photos go past. A single
                    week has no heading. */}
                {group.label && (
                  <h3
                    className="sticky top-0 z-10 -mt-1 mb-1.5 pt-1 pb-1 flex items-baseline justify-between text-[11px] font-bold uppercase tracking-wide"
                    style={{ backgroundColor: 'var(--theme-card)' }}
                  >
                    <span className="opacity-70">{group.label}</span>
                    <span className="text-[10px] font-semibold normal-case opacity-50 tabular-nums">{group.photos.length}</span>
                  </h3>
                )}
                <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(auto-fill, min(${thumbSize}px, 100%))` }}>
                  {group.photos.map(({ log, dateObj }) => (
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
              </section>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
