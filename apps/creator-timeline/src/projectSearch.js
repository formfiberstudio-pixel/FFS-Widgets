// The project list's search box. Pure, so the matching rules can be unit-tested;
// App.jsx and FacetedSidebarGroup.jsx do the rendering.

// What is typed, made comparable: composed Unicode (so Korean typed on one
// keyboard matches the same text stored decomposed), lower case, no spaces
// around it.
export function normalizeSearch(text) {
  return String(text ?? '').normalize('NFC').toLowerCase().trim();
}

// Whether `text` matches the (already normalized) search term. Every word of
// the term has to appear somewhere in the text, in any order -- so "tweed
// cardigan" finds "YR's | Faux Tweed Cardigan" -- and an empty term matches all.
export function textMatches(text, term) {
  if (!term) return true;
  const haystack = normalizeSearch(text);
  return term.split(/\s+/).every((word) => haystack.includes(word));
}

// The same for the tagged sources' groups ({ source: { facetKey: { label,
// values: Map(name -> { color, count }) } } }, see getYearFacetGroups): a value is
// matched on its database and group (Topic, Medium...) as well as its own name.
export function filterFacetGroups(groups, term) {
  if (!term) return groups;
  const result = {};
  for (const [source, facets] of Object.entries(groups)) {
    const keptFacets = {};
    for (const [facetKey, group] of Object.entries(facets)) {
      const values = new Map([...group.values].filter(([name]) => textMatches(`${source} ${group.label} ${name}`, term)));
      if (values.size > 0) keptFacets[facetKey] = { ...group, values };
    }
    if (Object.keys(keptFacets).length > 0) result[source] = keptFacets;
  }
  return result;
}

// The sidebar's source -> type -> projects tree, cut down to what matches. A
// project is matched on its database and category as well as its own name
// ("plants cycads" finds the plants in the Cycads category), so naming a
// category or database brings in everything under it. Anything left empty is
// dropped. Without a term the tree comes back as it was.
export function filterProjectTree(grouped, term) {
  if (!term) return grouped;
  const result = {};
  for (const [source, types] of Object.entries(grouped)) {
    const keptTypes = {};
    for (const [type, projects] of Object.entries(types)) {
      const kept = projects.filter((project) => textMatches(`${source} ${type} ${project.title}`, term));
      if (kept.length > 0) keptTypes[type] = kept;
    }
    if (Object.keys(keptTypes).length > 0) result[source] = keptTypes;
  }
  return result;
}
