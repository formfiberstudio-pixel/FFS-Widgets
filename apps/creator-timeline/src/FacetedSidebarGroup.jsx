import { useState } from 'react';
import { getYearFacetGroups, cycleVisibility, isIsolateTarget, isDimmedByOtherIsolate } from './facets.js';

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
// The third visibility state: solo this branch, hiding every other
// source/category/value instead of just this one. See src/facets.js's
// cycleVisibility for the click-cycle logic this drives.
const IconIsolate = () => (
  <svg className="w-3.5 h-3.5 fill-none stroke-current" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
    <line x1="6" y1="6" x2="4" y2="3" />
    <line x1="12" y1="4" x2="12" y2="1" />
    <line x1="18" y1="6" x2="20" y2="3" />
  </svg>
);

// Renders one independent filter group per facet (e.g. Cuisine,
// Establishment, Meal Type) for sources that don't fit the existing
// source -> type -> project tree (3+ simultaneous tags -- see
// src/facets.js). Each row is a value observed this year, with its own
// visibility toggle (Visible -> Hidden -> Isolated, see cycleVisibility)
// and click-to-filter (show only), entirely independent of the other
// facets on the same source.
export default function FacetedSidebarGroup({
  year,
  timelineLogs,
  facetSchemas,
  hiddenSources,
  setSourceHidden,
  hiddenFacetValues,
  setHiddenFacetValues,
  selectedFacetFilters,
  setSelectedFacetFilters,
  scaleFactor,
  colorMap,
  isolatedTarget,
  setIsolatedTarget,
  isLogInActiveView,
}) {
  const [collapsedGroups, setCollapsedGroups] = useState({}); // key: `${source}::${facetKey}`

  const groups = getYearFacetGroups(year, timelineLogs, facetSchemas, isLogInActiveView);
  const sources = Object.keys(groups);
  if (sources.length === 0) return null;

  const toggleGroup = (key) => setCollapsedGroups(prev => ({ ...prev, [key]: !prev[key] }));

  const setValueHidden = (source, facetKey, valueName, value) => {
    const key = `${source}::${facetKey}::${valueName}`;
    setHiddenFacetValues(prev => ({ ...prev, [key]: value }));
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
        const sourceTarget = { level: 'source', source };
        const isSourceIsolated = isIsolateTarget(isolatedTarget, sourceTarget);
        const sourceDimmedByIsolate = isDimmedByOtherIsolate(isolatedTarget, sourceTarget);
        return (
          <div key={source} className={`space-y-3 ${sourceDimmedByIsolate ? 'opacity-40' : ''}`}>
            {showSourceHeaders && (
              <div className={`flex items-center justify-between px-0.5 select-none ${isSourceHidden ? 'opacity-40' : ''}`}>
                <span className="font-black uppercase tracking-wider opacity-80" style={{ fontSize: `${Math.round(11 * scaleFactor)}px` }}>{source}</span>
                <button
                  onClick={() => cycleVisibility({
                    ownHidden: isSourceHidden,
                    setOwnHidden: (v) => setSourceHidden(source, v),
                    isTarget: isSourceIsolated,
                    target: sourceTarget,
                    setIsolatedTarget,
                  })}
                  title={isSourceIsolated ? 'Isolated -- click to show everything again' : isSourceHidden ? 'Hidden -- click to isolate' : 'Visible -- click to hide'}
                  className="cursor-pointer hover:opacity-100"
                  style={{ opacity: isSourceIsolated ? 1 : 0.7, color: isSourceIsolated ? 'var(--theme-primary)' : 'inherit' }}
                >
                  {isSourceIsolated ? <IconIsolate /> : isSourceHidden ? <IconEyeOff /> : <IconEye />}
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
                        const valueTarget = { level: 'facetValue', source, facetKey, valueName: name };
                        const isValueIsolated = isIsolateTarget(isolatedTarget, valueTarget);
                        const valueDimmedByIsolate = isDimmedByOtherIsolate(isolatedTarget, valueTarget);
                        return (
                          <div
                            key={name}
                            onClick={() => toggleFilterValue(source, facetKey, name)}
                            style={{
                              backgroundColor: 'var(--theme-bg)',
                              borderColor: isSelected ? 'var(--theme-secondary)' : 'var(--theme-border)',
                              opacity: (isHidden || valueDimmedByIsolate) ? 0.4 : (anySelected && !isSelected ? 0.35 : 1),
                              fontSize: `${Math.round(12 * scaleFactor)}px`,
                            }}
                            className="p-2.5 rounded border transition-all cursor-pointer flex items-center gap-2"
                          >
                            <span className="w-2.5 h-2.5 rounded-full shrink-0 border border-white/20 shadow-sm" style={{ backgroundColor: colorMap[color] || colorMap.default }} />
                            <span className="truncate flex-1">{name}</span>
                            <span className="text-[9px] font-mono opacity-50">{count}</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                cycleVisibility({
                                  ownHidden: isHidden,
                                  setOwnHidden: (v) => setValueHidden(source, facetKey, name, v),
                                  isTarget: isValueIsolated,
                                  target: valueTarget,
                                  setIsolatedTarget,
                                });
                              }}
                              title={isValueIsolated ? 'Isolated -- click to show everything again' : isHidden ? 'Hidden -- click to isolate' : 'Visible -- click to hide'}
                              className="cursor-pointer hover:opacity-100 shrink-0"
                              style={{ opacity: isValueIsolated ? 1 : 0.7, color: isValueIsolated ? 'var(--theme-primary)' : 'inherit' }}
                            >
                              {isValueIsolated ? <IconIsolate /> : isHidden ? <IconEyeOff /> : <IconEye />}
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
