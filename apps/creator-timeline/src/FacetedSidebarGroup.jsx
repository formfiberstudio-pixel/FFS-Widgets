import { useState } from 'react';
import { getYearFacetGroups } from './facets.js';

const IconEye = () => (
  <svg className="w-3.5 h-3.5 fill-none stroke-current" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const IconEyeOff = () => (
  <svg className="w-3.5 h-3.5 fill-none stroke-current" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a20.3 20.3 0 0 1 5.06-6.06M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a20.3 20.3 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

// Renders one independent filter group per facet (e.g. Cuisine,
// Establishment, Meal Type) for sources that don't fit the existing
// source -> type -> project tree (3+ simultaneous tags -- see
// src/facets.js). Each row is a value observed this year, with its own
// eye-toggle (hide from the calendar) and click-to-filter (show only),
// entirely independent of the other facets on the same source.
export default function FacetedSidebarGroup({
  year,
  timelineLogs,
  facetSchemas,
  hiddenSources,
  toggleSourceVisibility,
  hiddenFacetValues,
  setHiddenFacetValues,
  selectedFacetFilters,
  setSelectedFacetFilters,
  scaleFactor,
  colorMap,
}) {
  const [collapsedGroups, setCollapsedGroups] = useState({}); // key: `${source}::${facetKey}`

  const groups = getYearFacetGroups(year, timelineLogs, facetSchemas);
  const sources = Object.keys(groups);
  if (sources.length === 0) return null;

  const toggleGroup = (key) => setCollapsedGroups(prev => ({ ...prev, [key]: !prev[key] }));

  const toggleHiddenValue = (source, facetKey, valueName) => {
    const key = `${source}::${facetKey}::${valueName}`;
    setHiddenFacetValues(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleFilterValue = (source, facetKey, valueName) => {
    setSelectedFacetFilters(prev => {
      const current = prev[source]?.[facetKey] || [];
      const next = current.includes(valueName) ? current.filter(n => n !== valueName) : [...current, valueName];
      return { ...prev, [source]: { ...prev[source], [facetKey]: next } };
    });
  };

  const showSourceHeaders = sources.length > 1;

  return (
    <>
      {sources.map(source => {
        const facetGroupsForSource = groups[source];
        const isSourceHidden = hiddenSources[source];
        return (
          <div key={source} className="space-y-3">
            {showSourceHeaders && (
              <div className={`flex items-center justify-between px-0.5 select-none ${isSourceHidden ? 'opacity-40' : ''}`}>
                <span className="font-black uppercase tracking-wider opacity-80" style={{ fontSize: `${Math.round(11 * scaleFactor)}px` }}>{source}</span>
                <button
                  onClick={() => toggleSourceVisibility(source)}
                  title={isSourceHidden ? 'Show this database on the calendar' : 'Hide this database from the calendar'}
                  className="cursor-pointer opacity-70 hover:opacity-100"
                >
                  {isSourceHidden ? <IconEyeOff /> : <IconEye />}
                </button>
              </div>
            )}
            {!isSourceHidden && Object.entries(facetGroupsForSource).map(([facetKey, { label, values }]) => {
              const groupKey = `${source}::${facetKey}`;
              const isCollapsed = collapsedGroups[groupKey] === true;
              const activeSelections = selectedFacetFilters[source]?.[facetKey] || [];
              const sortedValues = [...values.entries()].sort((a, b) => a[0].localeCompare(b[0]));

              return (
                <div key={groupKey} className="border rounded-md overflow-hidden shrink-0 shadow-sm" style={{ borderColor: 'var(--theme-border)', backgroundColor: 'var(--theme-card)' }}>
                  <div onClick={() => toggleGroup(groupKey)} className="text-[10px] font-bold uppercase tracking-wider p-2.5 flex items-center justify-between cursor-pointer transition-colors hover:opacity-80">
                    <span className="tracking-wide font-black" style={{ fontSize: `${Math.round(10 * scaleFactor)}px` }}>{label}</span>
                    <span className="text-[9px] font-mono opacity-60">{isCollapsed ? '▼' : '▲'}</span>
                  </div>
                  {!isCollapsed && (
                    <div className="p-2 pt-0 space-y-1.5 border-t" style={{ borderColor: 'var(--theme-border)', backgroundColor: 'var(--theme-card)' }}>
                      {sortedValues.map(([name, { color, count }]) => {
                        const isHidden = hiddenFacetValues[`${source}::${facetKey}::${name}`];
                        const isSelected = activeSelections.includes(name);
                        const anySelected = activeSelections.length > 0;
                        return (
                          <div
                            key={name}
                            onClick={() => toggleFilterValue(source, facetKey, name)}
                            style={{
                              backgroundColor: 'var(--theme-bg)',
                              borderColor: isSelected ? 'var(--theme-secondary)' : 'var(--theme-border)',
                              opacity: isHidden ? 0.4 : (anySelected && !isSelected ? 0.35 : 1),
                              fontSize: `${Math.round(12 * scaleFactor)}px`,
                            }}
                            className="p-2.5 rounded border transition-all cursor-pointer flex items-center gap-2"
                          >
                            <span className="w-2.5 h-2.5 rounded-full shrink-0 border border-white/20 shadow-sm" style={{ backgroundColor: colorMap[color] || colorMap.default }} />
                            <span className="truncate flex-1">{name}</span>
                            <span className="text-[9px] font-mono opacity-50">{count}</span>
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleHiddenValue(source, facetKey, name); }}
                              title={isHidden ? 'Show this tag on the calendar' : 'Hide this tag from the calendar'}
                              className="cursor-pointer opacity-70 hover:opacity-100 shrink-0"
                            >
                              {isHidden ? <IconEyeOff /> : <IconEye />}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}
