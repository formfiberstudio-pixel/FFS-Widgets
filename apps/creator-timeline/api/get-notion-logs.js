import { isThumbnailableUrl } from './_lib/notionImageHosts.js';
import { decryptSecret } from './_lib/tokenCrypto.js';
import { getTenant, saveTenant, LICENSE_REVERIFY_MS } from './_lib/tenantStore.js';
import { verifyGumroadLicense } from './_lib/gumroad.js';
import { getCachedRelationTitle, setCachedRelationTitle, getCachedBlockData, setCachedBlockData } from './_lib/notionCache.js';

// force-rebuild marker: Vercel's change-detection skipped an earlier deploy

// Route Notion's images (often multi-MB originals straight from a phone)
// through our own resize proxy so the calendar grid decodes/paints small
// thumbnails instead of full-resolution photos. Only rewrite hosts the
// proxy actually accepts (see notionImageHosts.js) -- anything else
// (e.g. an externally-hosted image someone pasted into Notion) is passed
// through unchanged rather than pointed at a proxy that would reject it.
function toThumbnailUrl(rawUrl) {
  if (!rawUrl || !isThumbnailableUrl(rawUrl)) return rawUrl;
  return `/api/image-thumb?url=${encodeURIComponent(rawUrl)}&w=640`;
}

// Auto-detects which Notion property types on a page could serve as a
// "facet" (an independent tag dimension) -- relation, rollup, select, and
// multi_select are all Notion's own ways of tagging a page, so any of them
// qualifies. Computed once per SOURCE, not per page: a single Notion
// database query returns the same property schema for every row, so
// there's no need (and no benefit) to re-detect it 100+ times per sync.
const FACET_PROP_TYPES = new Set(['relation', 'rollup', 'select', 'multi_select']);

function slugifyFacetKey(name) {
  const words = name.trim().split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (words.length === 0) return 'facet';
  return words.map((w, i) => i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()).join('');
}

export function detectFacetSchema(sampleProps) {
  const raw = Object.entries(sampleProps || {})
    .filter(([, v]) => FACET_PROP_TYPES.has(v.type))
    .map(([name, v]) => ({ name, type: v.type, key: slugifyFacetKey(name) }));

  // Two differently-named properties could slug to the same key (e.g.
  // "Meal Type" and "meal-type") -- keep both, just disambiguate.
  const seenKeys = new Map();
  return raw.map(f => {
    const count = (seenKeys.get(f.key) || 0) + 1;
    seenKeys.set(f.key, count);
    return count === 1 ? f : { ...f, key: `${f.key}_${count}` };
  });
}

// Reads every value out of one Notion property (not just the first), so a
// multi_select or multi-relation facet keeps all of its simultaneous tags
// instead of the single-value assumption the legacy path still makes.
export async function extractFacetValues(propVal, type, getRelationTitle) {
  if (!propVal) return [];
  let raw = [];
  switch (type) {
    case 'select':
      if (propVal.select) raw = [{ name: propVal.select.name, color: propVal.select.color }];
      break;
    case 'multi_select':
      raw = (propVal.multi_select || []).map(t => ({ name: t.name, color: t.color }));
      break;
    case 'relation': {
      const ids = (propVal.relation || []).map(r => r.id);
      const names = await Promise.all(ids.map(id => getRelationTitle(id)));
      // Relations carry no native Notion color (today's single-relation
      // "Projects" field has never had one either -- it's colored
      // procedurally on the frontend). Default to a neutral gray.
      raw = names.map(name => ({ name, color: 'default' }));
      break;
    }
    case 'rollup':
      // A rollup can aggregate ANY property type from the related database
      // -- not just a select someone set up specifically as a category.
      // "Show unique values" on a relation (e.g. Home Food Log rolling up
      // each linked recipe's own Cuisine relation) is a common shape this
      // needs to read just as well as a plain select.
      for (const item of (propVal.rollup?.array || [])) {
        if (item.type === 'select' && item.select) {
          raw.push({ name: item.select.name, color: item.select.color });
        } else if (item.type === 'status' && item.status) {
          raw.push({ name: item.status.name, color: item.status.color });
        } else if (item.type === 'multi_select') {
          raw.push(...(item.multi_select || []).map(t => ({ name: t.name, color: t.color })));
        } else if (item.type === 'title' && item.title?.length) {
          raw.push({ name: item.title[0].plain_text, color: 'default' });
        } else if (item.type === 'rich_text' && item.rich_text?.length) {
          raw.push({ name: item.rich_text[0].plain_text, color: 'default' });
        } else if (item.type === 'relation' && item.relation?.length) {
          const nestedIds = item.relation.map(r => r.id);
          const nestedNames = await Promise.all(nestedIds.map(id => getRelationTitle(id)));
          raw.push(...nestedNames.map(name => ({ name, color: 'default' })));
        } else if (item.type === 'people' && item.people?.length) {
          raw.push(...item.people.map(p => ({ name: p.name || 'Unknown', color: 'default' })));
        } else if (item.type === 'formula' && item.formula) {
          const f = item.formula;
          const value = f.type === 'string' ? f.string
            : f.type === 'number' ? (f.number != null ? String(f.number) : null)
            : f.type === 'boolean' ? String(f.boolean)
            : f.type === 'date' ? f.date?.start
            : null;
          if (value) raw.push({ name: value, color: 'default' });
        }
      }
      break;
  }
  // De-dupe by name -- a relation linking the same page twice, or a rollup
  // surfacing the same select value from several related rows, shouldn't
  // render as a duplicate tag.
  const seen = new Set();
  return raw.filter(v => (seen.has(v.name) ? false : (seen.add(v.name), true)));
}

// A "progress tracking" source (Plants, Projects) always has exactly one
// relation (the entity being tracked -- a plant, a project) and one rollup
// (that entity's type/category, pulled through some other relation on the
// linked page). The code has always assumed relation-is-the-entity,
// rollup-is-its-type; a tenant can wire their Notion database the other
// way around (the entity as a Rollup, its type/category as a Relation) and
// still land on a source with exactly one of each. detectSwappedRoles
// below catches that case: an entity dimension always has at least as many
// distinct values across a database as its type does (many projects share
// few categories, never the reverse), so counting distinct values across
// every row tells us which property is actually which, regardless of
// which Notion field type each was implemented as. With too few rows to
// trust that count, it falls back to whether either property's own name
// reads as "type"/"category" vs "project"/"plant"/"name".
const TYPE_NAME_HINTS = ['type', 'category', 'categories', 'genre', 'tag', 'status', 'kind'];
const IDENTITY_NAME_HINTS = ['name', 'project', 'plant', 'title', 'client'];

function typeNameScore(propName) {
  const lower = propName.toLowerCase();
  if (TYPE_NAME_HINTS.some(hint => lower.includes(hint))) return 1;
  if (IDENTITY_NAME_HINTS.some(hint => lower.includes(hint))) return -1;
  return 0;
}

// First value of a rollup, via extractFacetValues (so the ROLLUP SAFEGUARD
// and detectSwappedRoles below share the exact same rollup-parsing logic --
// including nested-relation/status/people/formula support -- as the
// faceted/override paths, rather than a second, narrower copy of it).
async function extractRollupFirstValue(prop, getRelationTitle) {
  if (!prop || prop.type !== 'rollup') return null;
  const values = await extractFacetValues(prop, 'rollup', getRelationTitle);
  return values[0] || null;
}

// A source with both a Relation and a Rollup is a "progress tracking"
// database (Plants, Projects) -- an entity plus its type, always
// rendered as the existing two-level tree -- even if it also happens to
// carry other incidental select/multi_select properties (e.g. a Payment
// Method field). Every other source is "logging one-time instances"
// (Food Log, Home Food Log) and gets the flat, independently-tagged
// rendering -- regardless of how many tag-like properties it has. A
// single-select log (one property) and a five-select log both fit this
// the same way; the property COUNT was never the real signal, the
// presence of an entity+type pair is.
export function isFacetedSchema(facetSchema) {
  if (facetSchema.length === 0) return false;
  const types = new Set(facetSchema.map(f => f.type));
  const looksLikeProgressTracking = types.has('relation') && types.has('rollup');
  return !looksLikeProgressTracking;
}

// Resolves an owner-picked manual override (see ActivationPanel's per-source
// "Organize by: Topic / Type" pickers) against this source's OWN detected
// facetSchema, by key. A stale key -- the owner picked a property that the
// Notion schema has since removed or renamed -- resolves to null rather
// than crashing, falling back to the plain defaults in buildLogFields.
export function resolveFacetOverride(facetSchema, override) {
  const overrideTopicProp = override?.topicFacetKey
    ? facetSchema.find(f => f.key === override.topicFacetKey) || null
    : null;
  const overrideTypeProp = override?.typeFacetKey
    ? facetSchema.find(f => f.key === override.typeFacetKey) || null
    : null;
  return {
    overrideTopicProp,
    overrideTypeProp,
    hasManualOverride: Boolean(overrideTopicProp || overrideTypeProp),
  };
}

// Computed once per source (not per page) from every fetched row, since
// this is a property of the DATABASE's schema, not any individual page.
export async function detectSwappedRoles(allResults, relationPropName, rollupPropName, getRelationTitle) {
  if (!relationPropName || !rollupPropName) return false;

  if (allResults.length >= 4) {
    const relationIds = new Set();
    const rollupNames = new Set();
    for (const page of allResults) {
      const relId = page.properties?.[relationPropName]?.relation?.[0]?.id;
      if (relId) relationIds.add(relId);
      const rollupVal = await extractRollupFirstValue(page.properties?.[rollupPropName], getRelationTitle);
      if (rollupVal) rollupNames.add(rollupVal.name);
    }
    if (rollupNames.size !== relationIds.size) return rollupNames.size > relationIds.size;
  }

  // Too few rows to trust cardinality, or a tie -- fall back to naming.
  return typeNameScore(relationPropName) > typeNameScore(rollupPropName);
}

// Builds the category fields for one page. An owner-picked manual override
// (see resolveFacetOverride above) always wins first, regardless of what
// auto-detection would have produced -- it extracts topic/type via the
// already-generic extractFacetValues, so any of the owner's chosen
// properties (relation, rollup, select, or multi_select) works the same
// way. If only one of topic/type is picked, the other falls back to the
// plain default rather than mixing in auto-detection -- the override is
// atomic. With no override, sources with 2 or fewer detected facets go
// through the ORIGINAL single-value logic, with one addition: rolesSwapped
// (detected once per source, see detectSwappedRoles above) picks which of
// the relation/rollup values feeds projectName vs typeName. With
// rolesSwapped false -- the case for every tenant whose database matches
// the original relation-is-identity assumption -- this reduces to the
// original behavior exactly. Sources with 3+ facets get the new `facets`
// map instead, with legacy Projects/projectType/projectTypeColor
// synthesized from facets #1/#2 as a safety net for any caller that isn't
// facet-aware yet.
export async function buildLogFields(props, facetSchema, isFaceted, getRelationTitle, rolesSwapped = false, override = null) {
  const propValues = Object.values(props);
  let projectName = 'General';
  let typeName = 'Log';
  let typeColor = 'default';
  let facets;

  if (override) {
    const topicVals = override.topicProp
      ? await extractFacetValues(props[override.topicProp.name], override.topicProp.type, getRelationTitle)
      : [];
    const typeVals = override.typeProp
      ? await extractFacetValues(props[override.typeProp.name], override.typeProp.type, getRelationTitle)
      : [];
    if (topicVals[0]) {
      projectName = topicVals[0].name;
    } else if (override.topicProp) {
      console.warn(`[Diagnostic] Manual topic override "${override.topicProp.name}" (${override.topicProp.type}) produced no value. Raw property:`, JSON.stringify(props[override.topicProp.name]));
    }
    if (typeVals[0]) {
      typeName = typeVals[0].name;
      typeColor = typeVals[0].color;
    } else if (override.typeProp) {
      console.warn(`[Diagnostic] Manual type override "${override.typeProp.name}" (${override.typeProp.type}) produced no value. Raw property:`, JSON.stringify(props[override.typeProp.name]));
    }
  } else if (!isFaceted) {
    const validRelations = propValues.filter(p => p.type === 'relation' && p.relation?.length > 0);
    const validRollups = propValues.filter(p => p.type === 'rollup' && p.rollup?.array?.length > 0);

    const relationValue = validRelations.length > 0
      ? await getRelationTitle(validRelations[0].relation[0].id)
      : null;
    // Relations carry no native Notion color -- if a relation ends up in
    // the category role, its type badge just renders in the neutral gray.
    const rollupValue = validRollups.length > 0 ? await extractRollupFirstValue(validRollups[0], getRelationTitle) : null;

    const identityValue = rolesSwapped ? (rollupValue?.name ?? null) : relationValue;
    const categoryValue = rolesSwapped
      ? (relationValue ? { name: relationValue, color: 'default' } : null)
      : rollupValue;

    if (identityValue) projectName = identityValue;
    if (categoryValue) {
      typeName = categoryValue.name;
      typeColor = categoryValue.color;
    }
  } else {
    facets = {};
    for (const f of facetSchema) {
      facets[f.key] = await extractFacetValues(props[f.name], f.type, getRelationTitle);
    }
    const orderedKeys = facetSchema.map(f => f.key);
    const firstVals = facets[orderedKeys[0]] || [];
    const secondVals = facets[orderedKeys[1]] || [];
    projectName = firstVals[0]?.name || 'General';
    typeName = secondVals[0]?.name || 'Log';
    typeColor = secondVals[0]?.color || 'default';
  }

  return { projectName, typeName, typeColor, facets };
}

// Queries one Notion database and maps its pages into the widget's log
// shape, tagged with which configured source (database) they came from so
// the frontend can group entries from different databases (e.g. a project
// tracker and a plant care journal) into their own sidebar sections.
async function fetchDatabaseLogs(databaseId, sourceLabel, headers, targetTimeZone, facetOverride = null) {
  console.log(`[Diagnostic] Attempting to fetch Database ID: ${databaseId} (source: ${sourceLabel})`);

  // Notion caps a single query at 100 rows — without following has_more/
  // next_cursor, anything past the first page silently never comes back.
  let allResults = [];
  let hasMore = true;
  let startCursor = undefined;

  while (hasMore) {
    const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        page_size: 100,
        sorts: [{ timestamp: 'created_time', direction: 'ascending' }],
        ...(startCursor ? { start_cursor: startCursor } : {}),
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error(`[Diagnostic] Notion API Error Response (${sourceLabel}):`, errorData);
      throw new Error(errorData.message || `Failed to fetch from Notion database (${sourceLabel})`);
    }

    const pageData = await response.json();
    allResults = allResults.concat(pageData.results);
    hasMore = pageData.has_more;
    startCursor = pageData.next_cursor;
  }

  console.log(`[Diagnostic] (${sourceLabel}) Successfully fetched ${allResults.length} rows.`);

  // The facet schema (which properties qualify, their type, their order)
  // is a property of the DATABASE, not of any individual row -- detect it
  // once from the first row rather than per-page.
  const facetSchema = detectFacetSchema(allResults[0]?.properties);

  // How many Notion requests this source's sync actually skipped via the
  // persistent caches (see notionCache.js) -- logged once at the end,
  // purely so cache effectiveness is visible in production logs without
  // needing to guess at it.
  const cacheStats = { relationHits: 0, relationMisses: 0, blockHits: 0, blockMisses: 0 };

  // Many rows share the same related project page, so without this we'd
  // re-fetch that same relation (and hit Notion's rate limit) once per
  // row. Memoize by related-page id, storing the in-flight promise (not
  // just the resolved value) so concurrent rows awaiting the same id
  // share one request instead of each kicking off their own. Defined
  // before the swapped-roles check below since a rollup can itself
  // aggregate a relation (extractFacetValues' rollup case resolves those
  // through this same function).
  const relationTitleCache = new Map();
  function getRelationTitle(relatedPageId) {
    if (!relationTitleCache.has(relatedPageId)) {
      const promise = (async () => {
        // Persistent (cross-sync) cache first -- a related page's title
        // rarely changes, so most historical rows can skip this Notion
        // request entirely after the first sync ever resolves them.
        const cachedTitle = await getCachedRelationTitle(relatedPageId);
        if (cachedTitle) { cacheStats.relationHits++; return cachedTitle; }
        cacheStats.relationMisses++;
        try {
          const relRes = await fetch(`https://api.notion.com/v1/pages/${relatedPageId}`, { method: 'GET', headers });
          if (relRes.ok) {
            const relData = await relRes.json();
            const relTitleProp = Object.values(relData.properties).find(p => p.type === 'title');
            if (relTitleProp && relTitleProp.title.length > 0) {
              const title = relTitleProp.title[0].plain_text;
              await setCachedRelationTitle(relatedPageId, title);
              return title;
            }
          } else {
            console.warn(`[Diagnostic] Relation fetch failed. Missing integration access to related DB.`);
          }
        } catch (err) {
          console.warn(`[Diagnostic] Network error fetching relation ${relatedPageId}`);
        }
        return 'General';
      })();
      relationTitleCache.set(relatedPageId, promise);
    }
    return relationTitleCache.get(relatedPageId);
  }

  // An owner-picked manual override (see resolveFacetOverride) always wins
  // over auto-detection entirely, forcing this source into tree-mode
  // rendering using whichever properties were explicitly chosen.
  const { overrideTopicProp, overrideTypeProp, hasManualOverride } = resolveFacetOverride(facetSchema, facetOverride);

  let isFaceted;
  let rolesSwapped = false;
  if (hasManualOverride) {
    isFaceted = false;
  } else {
    isFaceted = isFacetedSchema(facetSchema);

    // Which literal property is the Relation vs the Rollup, for the
    // swapped-roles check below -- only meaningful for a 2-facet source.
    const schemaSampleProps = allResults[0]?.properties || {};
    const relationPropName = Object.entries(schemaSampleProps).find(([, v]) => v.type === 'relation')?.[0];
    const rollupPropName = Object.entries(schemaSampleProps).find(([, v]) => v.type === 'rollup')?.[0];
    rolesSwapped = !isFaceted && await detectSwappedRoles(allResults, relationPropName, rollupPropName, getRelationTitle);
  }

  // One-shot cross-check: if the database-query response's override
  // property looks empty, fetch that exact page directly via
  // pages.retrieve to see if it disagrees -- Notion's query endpoint is
  // documented to sometimes return incomplete relation/rollup values that
  // the single-page endpoint computes fully. Fires at most once per
  // source's sync so it doesn't multiply request volume.
  let crossCheckDone = false;

  const formattedLogs = await Promise.all(allResults.map(async (page) => {
    try {
      const props = page.properties;
      const propValues = Object.values(props);

      // --- DATE SAFEGUARD ---
      const dateProp = propValues.find(p => p.type === 'date');

      // FIX: Removed the .split('T')[0] from page.created_time
      // This preserves the UTC time so we can accurately shift it to the local timezone.
      const dateStr = dateProp?.date?.start || page.created_time;

      if (!dateStr) throw new Error('No valid date string found');

      let year, monthNumber, dayNumber;
      if (dateStr.includes('T')) {
         // Safely shift the preserved UTC timestamp into the user's dynamic local timezone
         const localDateStr = new Date(dateStr).toLocaleString("en-US", { timeZone: targetTimeZone });
         const d = new Date(localDateStr);
         year = d.getFullYear();
         monthNumber = d.getMonth() + 1;
         dayNumber = d.getDate();
      } else {
         // It's a pure date string like "2026-07-22", so we just split it
         const [y, m, d] = dateStr.split('-');
         year = parseInt(y, 10);
         monthNumber = parseInt(m, 10);
         dayNumber = parseInt(d, 10);
      }

      // --- TITLE ---
      const titleProp = propValues.find(p => p.type === 'title');
      const title = titleProp?.title?.[0]?.plain_text || 'Untitled Log';

      const { projectName, typeName, typeColor, facets } = await buildLogFields(
        props, facetSchema, isFaceted, getRelationTitle, rolesSwapped,
        hasManualOverride ? { topicProp: overrideTopicProp, typeProp: overrideTypeProp } : null
      );

      if (hasManualOverride && !crossCheckDone) {
        const looksEmpty = (prop) => {
          if (!prop) return false;
          const v = props[prop.name];
          if (prop.type === 'relation') return !(v?.relation?.length);
          if (prop.type === 'rollup') return !(v?.rollup?.array?.length);
          return false;
        };
        if (looksEmpty(overrideTopicProp) || looksEmpty(overrideTypeProp)) {
          crossCheckDone = true;
          try {
            const pageRes = await fetch(`https://api.notion.com/v1/pages/${page.id}`, { method: 'GET', headers });
            if (pageRes.ok) {
              const pageData = await pageRes.json();
              console.warn(`[Diagnostic] pages.retrieve cross-check for page ${page.id} (query endpoint reported empty):`, JSON.stringify({
                topic: overrideTopicProp ? pageData.properties?.[overrideTopicProp.name] : undefined,
                type: overrideTypeProp ? pageData.properties?.[overrideTypeProp.name] : undefined,
              }));
            } else {
              console.warn(`[Diagnostic] Cross-check fetch failed with status ${pageRes.status}`);
            }
          } catch (err) {
            console.warn('[Diagnostic] Cross-check fetch errored:', err.message);
          }
        }
      }

      // --- DEEP FETCH SAFEGUARD ---
      // Cached first, keyed by this exact page's last_edited_time (already
      // in hand from the database query, no extra cost) -- most historical
      // rows are never edited again after creation, so a repeat sync skips
      // this Notion request for all of them. toThumbnailUrl is applied
      // fresh either way rather than cached, since the underlying Notion
      // file URL is signed and short-lived (see getCachedBlockData/
      // notionCache.js for the freshness bound this relies on).
      let rawImageUrl = null;
      let pageContent = '';

      const cachedBlockData = await getCachedBlockData(page.id, page.last_edited_time);
      if (cachedBlockData) {
        cacheStats.blockHits++;
        rawImageUrl = cachedBlockData.rawImageUrl;
        pageContent = cachedBlockData.pageContent;
      } else {
        cacheStats.blockMisses++;
        try {
          const blockRes = await fetch(`https://api.notion.com/v1/blocks/${page.id}/children?page_size=25`, {
            method: 'GET',
            headers
          });

          if (blockRes.ok) {
            const blockData = await blockRes.json();
            const imgBlock = blockData.results.find(b => b.type === 'image');
            if (imgBlock) {
              rawImageUrl = imgBlock.image.type === 'external' ? imgBlock.image.external.url : imgBlock.image.file.url;
            }

            for (const b of blockData.results) {
              const blockTypeData = b[b.type];
              if (blockTypeData && blockTypeData.rich_text && blockTypeData.rich_text.length > 0) {
                pageContent = blockTypeData.rich_text.map(t => t.plain_text).join('');
                break;
              }
            }
          }
        } catch (err) {
          console.warn(`[Diagnostic] Failed to fetch blocks for page ${page.id}`);
        }
        await setCachedBlockData(page.id, page.last_edited_time, rawImageUrl, pageContent);
      }

      const imageUrl = toThumbnailUrl(rawImageUrl);

      return {
        id: page.id,
        source: sourceLabel,
        year,
        monthNumber,
        dayNumber,
        title,
        Projects: projectName,
        projectType: typeName,
        projectTypeColor: typeColor,
        ...(facets ? { facets } : {}),
        imageUrl,
        pageContent
      };
    } catch (rowError) {
      console.error(`[Diagnostic] Skipped a row due to error:`, rowError.message);
      return null;
    }
  }));

  const skippedRequests = cacheStats.relationHits + cacheStats.blockHits;
  console.log(`[Diagnostic] (${sourceLabel}) Cache: ${cacheStats.relationHits}/${cacheStats.relationHits + cacheStats.relationMisses} relation titles, ${cacheStats.blockHits}/${cacheStats.blockHits + cacheStats.blockMisses} page blocks served from cache (${skippedRequests} Notion requests skipped).`);

  return {
    logs: formattedLogs.filter(log => log !== null),
    facetSchema: isFaceted ? facetSchema.map(({ name, type, key }) => ({ key, label: name, type })) : [],
    // Unlike facetSchema (gated by isFaceted, consumed by src/facets.js's
    // faceted-vs-tree frontend logic), this is always the full candidate
    // list -- it's what lets the owner-facing "Organize by" picker in
    // ActivationPanel see every pickable property for a source, even one
    // currently rendered as a tree.
    facetCandidates: facetSchema.map(({ name, type, key }) => ({ key, label: name, type })),
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { tenantId, sources: sourceFilter, timeZone } = req.body || {};

  if (!tenantId || typeof tenantId !== 'string') {
    return res.status(400).json({ error: 'Missing tenantId' });
  }

  let tenant;
  try {
    tenant = await getTenant(tenantId);
  } catch (err) {
    console.error('[get-notion-logs] Failed to load tenant record:', err.message);
    return res.status(500).json({ error: 'Could not load your setup right now.' });
  }

  if (!tenant) {
    return res.status(404).json({ error: 'This widget has not been set up yet. Visit the setup page to connect your Notion workspace.' });
  }

  // Refunds/chargebacks should cut off access reasonably promptly, but
  // re-checking Gumroad on every single calendar load would add latency
  // and hammer their API for no benefit -- only re-verify once the cached
  // result goes stale.
  if (Date.now() - (tenant.lastVerifiedAt || 0) > LICENSE_REVERIFY_MS) {
    try {
      const licenseKey = decryptSecret(tenant.encryptedLicenseKey);
      const verification = await verifyGumroadLicense(licenseKey);
      if (!verification.valid) {
        return res.status(403).json({ error: `Access no longer valid: ${verification.reason}` });
      }
      tenant.lastVerifiedAt = Date.now();
      await saveTenant(tenantId, tenant);
    } catch (err) {
      console.error('[get-notion-logs] Re-verification failed, serving from last-known-good:', err.message);
    }
  }

  let notionToken;
  try {
    notionToken = decryptSecret(tenant.encryptedNotionToken);
  } catch (err) {
    console.error('[get-notion-logs] Failed to decrypt stored token:', err.message);
    return res.status(500).json({ error: 'Could not load your Notion connection.' });
  }

  // A single embed can restrict to a subset of the tenant's configured
  // databases (e.g. a client-facing page showing only that client's own
  // database) by passing which database ids to include; omitting it shows
  // everything the tenant has configured.
  let sources = tenant.sources || [];
  if (Array.isArray(sourceFilter) && sourceFilter.length > 0) {
    sources = sources.filter(s => sourceFilter.includes(s.databaseId));
  }
  if (sources.length === 0) {
    return res.status(400).json({ error: 'No matching databases configured for this view' });
  }

  const targetTimeZone = timeZone || "UTC";

  const headers = {
    'Authorization': `Bearer ${notionToken}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json'
  };

  try {
    const perSourceResults = await Promise.all(
      sources.map(s => fetchDatabaseLogs(s.databaseId, s.label || 'Activity Log', headers, targetTimeZone, {
        topicFacetKey: s.topicFacetKey || null,
        typeFacetKey: s.typeFacetKey || null,
      }))
    );
    const validLogs = perSourceResults.flatMap(r => r.logs);

    // Each faceted source's schema (key -> label/type, in Notion's own
    // property order) is the same for every log entry from that source --
    // ship it once per source rather than duplicating it onto every row.
    const facetSchemas = {};
    const facetCandidates = {};
    perSourceResults.forEach((r, i) => {
      const label = sources[i].label || 'Activity Log';
      if (r.facetSchema.length > 0) facetSchemas[label] = r.facetSchema;
      if (r.facetCandidates.length > 0) facetCandidates[label] = r.facetCandidates;
    });

    console.log(`[Diagnostic] Successfully returning ${validLogs.length} valid logs to frontend across ${sources.length} database(s) for tenant ${tenantId}.`);

    return res.status(200).json({ success: true, data: validLogs, savedViews: tenant.savedViews || [], facetSchemas, facetCandidates });

  } catch (error) {
    console.error('[Diagnostic] Fatal API Error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}
