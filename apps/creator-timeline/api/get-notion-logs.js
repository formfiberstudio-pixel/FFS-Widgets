import { isThumbnailableUrl } from './_lib/notionImageHosts.js';
import { decryptSecret } from './_lib/tokenCrypto.js';
import { getTenant, saveTenant, LICENSE_REVERIFY_MS } from './_lib/tenantStore.js';
import { verifyGumroadLicense } from './_lib/gumroad.js';

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
      for (const item of (propVal.rollup?.array || [])) {
        if (item.type === 'select' && item.select) {
          raw.push({ name: item.select.name, color: item.select.color });
        } else if (item.type === 'multi_select') {
          raw.push(...(item.multi_select || []).map(t => ({ name: t.name, color: t.color })));
        } else if (item.type === 'title' && item.title?.length) {
          raw.push({ name: item.title[0].plain_text, color: 'default' });
        } else if (item.type === 'rich_text' && item.rich_text?.length) {
          raw.push({ name: item.rich_text[0].plain_text, color: 'default' });
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

// Rollup -> {name, color} for the ROLLUP SAFEGUARD, factored out so the
// same extraction can serve either role (category, or -- when roles are
// detected as swapped for this tenant -- identity).
function extractRollupFirstValue(prop) {
  if (!prop || prop.type !== 'rollup' || !prop.rollup?.array?.length) return null;
  const firstItem = prop.rollup.array[0];
  if (firstItem.type === 'select' && firstItem.select) {
    return { name: firstItem.select.name, color: firstItem.select.color };
  }
  if (firstItem.type === 'multi_select' && firstItem.multi_select.length > 0) {
    return { name: firstItem.multi_select[0].name, color: firstItem.multi_select[0].color };
  }
  if (firstItem.type === 'title' && firstItem.title.length > 0) {
    return { name: firstItem.title[0].plain_text, color: 'default' };
  }
  if (firstItem.type === 'rich_text' && firstItem.rich_text.length > 0) {
    return { name: firstItem.rich_text[0].plain_text, color: 'default' };
  }
  return null;
}

// A source with both a Relation and a Rollup is a "progress tracking"
// database (Plants, Projects) -- an entity plus its type, always
// rendered as the existing two-level tree -- even if it also happens to
// carry other incidental select/multi_select properties (e.g. a Payment
// Method field) that would otherwise push the facet count to 3+ and flip
// it into the flat, independently-tagged rendering meant for a source
// like Food Log that has no such entity/type hierarchy at all. Only a
// source with no relation+rollup pairing is treated as faceted.
export function isFacetedSchema(facetSchema) {
  const types = new Set(facetSchema.map(f => f.type));
  const looksLikeProgressTracking = types.has('relation') && types.has('rollup');
  return facetSchema.length >= 3 && !looksLikeProgressTracking;
}

// Computed once per source (not per page) from every fetched row, since
// this is a property of the DATABASE's schema, not any individual page.
export function detectSwappedRoles(allResults, relationPropName, rollupPropName) {
  if (!relationPropName || !rollupPropName) return false;

  if (allResults.length >= 4) {
    const relationIds = new Set();
    const rollupNames = new Set();
    for (const page of allResults) {
      const relId = page.properties?.[relationPropName]?.relation?.[0]?.id;
      if (relId) relationIds.add(relId);
      const rollupVal = extractRollupFirstValue(page.properties?.[rollupPropName]);
      if (rollupVal) rollupNames.add(rollupVal.name);
    }
    if (rollupNames.size !== relationIds.size) return rollupNames.size > relationIds.size;
  }

  // Too few rows to trust cardinality, or a tie -- fall back to naming.
  return typeNameScore(relationPropName) > typeNameScore(rollupPropName);
}

// Builds the category fields for one page. Sources with 2 or fewer
// detected facets go through the ORIGINAL single-value logic, with one
// addition: rolesSwapped (detected once per source, see
// detectSwappedRoles above) picks which of the relation/rollup values
// feeds projectName vs typeName. With rolesSwapped false -- the case for
// every tenant whose database matches the original relation-is-identity
// assumption -- this reduces to the original behavior exactly. Sources
// with 3+ facets get the new `facets` map instead, with legacy
// Projects/projectType/projectTypeColor synthesized from facets #1/#2 as a
// safety net for any caller that isn't facet-aware yet.
export async function buildLogFields(props, facetSchema, isFaceted, getRelationTitle, rolesSwapped = false) {
  const propValues = Object.values(props);
  let projectName = 'General';
  let typeName = 'Log';
  let typeColor = 'default';
  let facets;

  if (!isFaceted) {
    const validRelations = propValues.filter(p => p.type === 'relation' && p.relation?.length > 0);
    const validRollups = propValues.filter(p => p.type === 'rollup' && p.rollup?.array?.length > 0);

    const relationValue = validRelations.length > 0
      ? await getRelationTitle(validRelations[0].relation[0].id)
      : null;
    // Relations carry no native Notion color -- if a relation ends up in
    // the category role, its type badge just renders in the neutral gray.
    const rollupValue = validRollups.length > 0 ? extractRollupFirstValue(validRollups[0]) : null;

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
async function fetchDatabaseLogs(databaseId, sourceLabel, headers, targetTimeZone) {
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
  const isFaceted = isFacetedSchema(facetSchema);

  // Which literal property is the Relation vs the Rollup, for the
  // swapped-roles check below -- only meaningful for a 2-facet source.
  const schemaSampleProps = allResults[0]?.properties || {};
  const relationPropName = Object.entries(schemaSampleProps).find(([, v]) => v.type === 'relation')?.[0];
  const rollupPropName = Object.entries(schemaSampleProps).find(([, v]) => v.type === 'rollup')?.[0];
  const rolesSwapped = !isFaceted && detectSwappedRoles(allResults, relationPropName, rollupPropName);

  // Many rows share the same related project page, so without this we'd
  // re-fetch that same relation (and hit Notion's rate limit) once per
  // row. Memoize by related-page id, storing the in-flight promise (not
  // just the resolved value) so concurrent rows awaiting the same id
  // share one request instead of each kicking off their own.
  const relationTitleCache = new Map();
  function getRelationTitle(relatedPageId) {
    if (!relationTitleCache.has(relatedPageId)) {
      const promise = (async () => {
        try {
          const relRes = await fetch(`https://api.notion.com/v1/pages/${relatedPageId}`, { method: 'GET', headers });
          if (relRes.ok) {
            const relData = await relRes.json();
            const relTitleProp = Object.values(relData.properties).find(p => p.type === 'title');
            if (relTitleProp && relTitleProp.title.length > 0) {
              return relTitleProp.title[0].plain_text;
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

      const { projectName, typeName, typeColor, facets } = await buildLogFields(props, facetSchema, isFaceted, getRelationTitle, rolesSwapped);

      // --- DEEP FETCH SAFEGUARD ---
      let imageUrl = null;
      let pageContent = '';

      try {
        const blockRes = await fetch(`https://api.notion.com/v1/blocks/${page.id}/children?page_size=25`, {
          method: 'GET',
          headers
        });

        if (blockRes.ok) {
          const blockData = await blockRes.json();
          const imgBlock = blockData.results.find(b => b.type === 'image');
          if (imgBlock) {
            const rawImageUrl = imgBlock.image.type === 'external' ? imgBlock.image.external.url : imgBlock.image.file.url;
            imageUrl = toThumbnailUrl(rawImageUrl);
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

  return {
    logs: formattedLogs.filter(log => log !== null),
    facetSchema: isFaceted ? facetSchema.map(({ name, type, key }) => ({ key, label: name, type })) : [],
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
      sources.map(s => fetchDatabaseLogs(s.databaseId, s.label || 'Activity Log', headers, targetTimeZone))
    );
    const validLogs = perSourceResults.flatMap(r => r.logs);

    // Each faceted source's schema (key -> label/type, in Notion's own
    // property order) is the same for every log entry from that source --
    // ship it once per source rather than duplicating it onto every row.
    const facetSchemas = {};
    perSourceResults.forEach((r, i) => {
      const label = sources[i].label || 'Activity Log';
      if (r.facetSchema.length > 0) facetSchemas[label] = r.facetSchema;
    });

    console.log(`[Diagnostic] Successfully returning ${validLogs.length} valid logs to frontend across ${sources.length} database(s) for tenant ${tenantId}.`);

    return res.status(200).json({ success: true, data: validLogs, savedViews: tenant.savedViews || [], facetSchemas });

  } catch (error) {
    console.error('[Diagnostic] Fatal API Error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}
