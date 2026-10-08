import { useEffect, useMemo, useRef, useState } from 'react';
import { normalizeSearch, textMatches } from './projectSearch.js';

// A small menu for choosing one project from a list -- opened from an entry's
// card on the Day page to move the entry to another project. The projects come
// in the order they should show (the caller has applied the person's own
// ordering) and are grouped under their type as they are in the project list.
// Type to narrow them; Esc, or a click anywhere else, closes it.
export default function ProjectPicker({ projects, currentTitle, colorFor, onPick, onClose, busy = false }) {
  const [query, setQuery] = useState('');
  const rootRef = useRef(null);

  useEffect(() => {
    const onPointerDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) onClose();
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown, { passive: true });
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const groups = useMemo(() => {
    const term = normalizeSearch(query);
    const byType = new Map();
    for (const project of projects) {
      if (!textMatches(`${project.projectType} ${project.title}`, term)) continue;
      if (!byType.has(project.projectType)) byType.set(project.projectType, []);
      byType.get(project.projectType).push(project);
    }
    return [...byType.entries()];
  }, [projects, query]);

  return (
    <div
      ref={rootRef}
      onClick={(e) => e.stopPropagation()}
      style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)', color: 'var(--theme-text)' }}
      className="absolute left-0 top-full mt-1 z-40 w-[min(22rem,80vw)] rounded-lg border shadow-xl p-2 text-left"
      role="dialog"
      aria-label="Move this entry to another project"
    >
      <div className="text-[10px] font-bold uppercase tracking-wider opacity-60 px-1 pb-1.5">Move to project</div>
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search projects"
        aria-label="Search projects"
        autoComplete="off"
        spellCheck={false}
        style={{ backgroundColor: 'var(--theme-bg)', borderColor: 'var(--theme-border)', color: 'var(--theme-text)', fontSize: '16px' }}
        className="w-full rounded border px-2 py-1.5 mb-2 outline-none focus:border-[var(--theme-primary)]"
      />
      <div className="max-h-64 overflow-y-auto pr-1 space-y-2">
        {groups.length === 0 && <div className="text-xs italic opacity-50 px-1 py-3 text-center">No projects match.</div>}
        {groups.map(([type, list]) => (
          <div key={type}>
            <div className="text-[10px] font-black uppercase tracking-wider opacity-50 px-1 pb-1">{type}</div>
            <div className="space-y-1">
              {list.map((project) => {
                const isCurrent = project.title === currentTitle;
                return (
                  <button
                    key={project.title}
                    type="button"
                    disabled={busy || isCurrent}
                    onClick={() => onPick(project)}
                    style={{ backgroundColor: 'var(--theme-bg)', borderColor: isCurrent ? 'var(--theme-secondary)' : 'var(--theme-border)' }}
                    className="w-full flex items-center gap-2 rounded border px-2 py-1.5 text-xs text-left cursor-pointer disabled:cursor-default hover:border-[var(--theme-primary)] transition-colors"
                  >
                    <span className="w-2.5 h-2.5 rounded-full shrink-0 border border-white/20" style={{ backgroundColor: colorFor(project) }} />
                    <span className="min-w-0 flex-1 truncate">{project.title}</span>
                    {isCurrent && <span className="shrink-0 text-[10px] font-bold opacity-70">current</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
