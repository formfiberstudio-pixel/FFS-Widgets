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
export function getYearFacetGroups(targetYear, timelineLogs, facetSchemas) {
  const groups = {};
  if (!Array.isArray(timelineLogs)) return groups;

  for (const log of timelineLogs) {
    const source = log.source || 'Activity Log';
    if (!isFacetedSource(source, facetSchemas) || Number(log.year) !== targetYear) continue;
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
