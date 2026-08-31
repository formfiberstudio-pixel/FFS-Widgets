// Pure helpers for "faceted" sources -- a source with 3+ independently
// detected Notion property tags (e.g. a food log's Establishment/Cuisine/
// Meal Type), as opposed to the existing source -> type -> project tree
// that sources with 1-2 facets still use unchanged. See api/get-notion-logs.js
// for how `facetSchemas`/`log.facets` are produced.
//
// No React here on purpose: keeps this independently testable and keeps
// App.jsx (already large) from growing further for logic that has no
// natural inline home.

export function isFacetedSource(source, facetSchemas) {
  return (facetSchemas?.[source]?.length || 0) >= 3;
}

// Drops logs from faceted sources so the existing source -> type -> project
// tree (getYearProjects, groupedBySource/groupedProjects, the Palette tab,
// generateProjectColorMap) never sees them -- those stay exactly as they
// are today, just fed a pre-filtered array, rather than being rewritten to
// understand two different shapes of data.
export function filterTreeLogs(logs, facetSchemas) {
  if (!Array.isArray(logs)) return [];
  return logs.filter(log => !isFacetedSource(log.source || 'Activity Log', facetSchemas));
}

// Which facet's value drives a faceted tile's pill/title-bar color. A
// stored viewer preference wins; otherwise default to the first-detected
// facet (self-healing if a source's schema ever changes shape, since
// nothing is written to storage until the viewer actually picks one).
export function resolveColorFacetKey(source, facetSchemas, colorFacetBySource) {
  return colorFacetBySource?.[source] || facetSchemas?.[source]?.[0]?.key || null;
}

// A log is excluded if ANY of its values in a hidden facet key are hidden
// -- hiding "Japanese" also hides a Japanese+American fusion entry, the
// more intuitive reading of an eye-toggle ("don't show me Japanese food")
// than requiring every one of an entry's tags to be hidden first.
export function facetValueExcluded(log, source, hiddenFacetValues) {
  if (!log.facets) return false;
  return Object.entries(log.facets).some(([facetKey, values]) =>
    (values || []).some(v => hiddenFacetValues[`${source}::${facetKey}::${v.name}`])
  );
}

// Standard faceted-search semantics: multiple selected values WITHIN one
// facet are OR'd (checking "Japanese" and "Italian" under Cuisine shows
// either), multiple ACTIVE facets are AND'd (also checking "Dinner" under
// Meal Type narrows to Cuisine-match AND Meal-Type-match).
export function facetSelectionMatches(log, source, selectedFacetFilters) {
  const active = selectedFacetFilters?.[source];
  if (!active) return true;
  return Object.entries(active).every(([facetKey, selectedNames]) => {
    if (!selectedNames || selectedNames.length === 0) return true;
    const values = (log.facets?.[facetKey] || []).map(v => v.name);
    return selectedNames.some(name => values.includes(name));
  });
}

// Aggregates every observed value per facet, per faceted source, for a
// given year -- the flat sidebar's own analog to getYearProjects, since
// there's no tree to adapt for a source with no hierarchy.
// Returns { [source]: { [facetKey]: { label, values: Map<name, {color, count}> } } }
// Every visibility icon in the sidebar (a source header, a tree category,
// or a single facet value) can be in one of three states -- Visible,
// Hidden (just this branch excluded), or Isolated (this is the ONLY
// branch shown anywhere, at any level). Clicking cycles
// Visible -> Hidden -> Isolated -> Visible. Hidden is a per-branch flag
// each branch tracks independently; Isolated is a single GLOBAL choice
// (isolatedTarget), since "show only this" is only meaningful relative to
// everything else at once.
export function cycleVisibility({ ownHidden, setOwnHidden, isTarget, target, setIsolatedTarget }) {
  if (isTarget) {
    setIsolatedTarget(null);
  } else if (ownHidden) {
    setOwnHidden(false);
    setIsolatedTarget(target);
  } else {
    setOwnHidden(true);
  }
}

// Whether `candidate` (one specific source, tree-category, or facet-value
// branch -- `{level, source, type?, facetKey?, valueName?}`) IS the
// current global isolate target, by exact structural match.
export function isIsolateTarget(isolatedTarget, candidate) {
  if (!isolatedTarget || isolatedTarget.level !== candidate.level) return false;
  if (candidate.level === 'source') return isolatedTarget.source === candidate.source;
  if (candidate.level === 'type') return isolatedTarget.source === candidate.source && isolatedTarget.type === candidate.type;
  if (candidate.level === 'facetValue') {
    return isolatedTarget.source === candidate.source
      && isolatedTarget.facetKey === candidate.facetKey
      && isolatedTarget.valueName === candidate.valueName;
  }
  return false;
}

// Whether `candidate` should visually dim because something ELSE (not it,
// and not something whose isolation already keeps it visible) is
// isolated. A source header never dims for something isolated inside its
// own subtree -- only for a target belonging to a different source -- and
// isolating a whole source leaves everything inside that same source
// undimmed; anything more specific than that dims everything except its
// own exact match.
export function isDimmedByOtherIsolate(isolatedTarget, candidate) {
  if (!isolatedTarget) return false;
  if (isIsolateTarget(isolatedTarget, candidate)) return false;
  if (candidate.level === 'source') return isolatedTarget.source !== candidate.source;
  if (isolatedTarget.level === 'source') return isolatedTarget.source !== candidate.source;
  return true;
}

// `isLogInActiveView`, when passed, narrows the aggregation further than
// the year alone -- e.g. to just the visible month or week in App.jsx's
// Month/Week views -- so the sidebar lists only topics/types actually
// present on screen. Optional and defaults to "everything in the year" so
// existing callers are unaffected.
export function getYearFacetGroups(targetYear, timelineLogs, facetSchemas, isLogInActiveView = () => true) {
  const groups = {};
  if (!Array.isArray(timelineLogs)) return groups;

  for (const log of timelineLogs) {
    const source = log.source || 'Activity Log';
    if (!isFacetedSource(source, facetSchemas) || Number(log.year) !== targetYear) continue;
    if (!isLogInActiveView(log)) continue;
    if (!log.facets) continue;

    if (!groups[source]) groups[source] = {};
    const schema = facetSchemas[source];

    for (const { key, label } of schema) {
      const values = log.facets[key] || [];
      if (!groups[source][key]) groups[source][key] = { label, values: new Map() };
      for (const v of values) {
        const existing = groups[source][key].values.get(v.name);
        if (existing) existing.count += 1;
        else groups[source][key].values.set(v.name, { color: v.color, count: 1 });
      }
    }
  }

  return groups;
}
