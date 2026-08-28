import { isThumbnailableUrl } from './_lib/notionImageHosts.js';

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

      // --- RELATION SAFEGUARD ---
      let projectName = 'General';
      const validRelations = propValues.filter(p => p.type === 'relation' && p.relation?.length > 0);

      if (validRelations.length > 0) {
        const relatedPageId = validRelations[0].relation[0].id;
        projectName = await getRelationTitle(relatedPageId);
      }

      // --- ROLLUP SAFEGUARD ---
      let typeName = 'Log';
      let typeColor = 'default';
      const validRollups = propValues.filter(p => p.type === 'rollup' && p.rollup?.array?.length > 0);

      if (validRollups.length > 0) {
        const firstItem = validRollups[0].rollup.array[0];
        if (firstItem.type === 'select' && firstItem.select) {
          typeName = firstItem.select.name;
          typeColor = firstItem.select.color;
        } else if (firstItem.type === 'multi_select' && firstItem.multi_select.length > 0) {
          typeName = firstItem.multi_select[0].name;
          typeColor = firstItem.multi_select[0].color;
        } else if (firstItem.type === 'title' && firstItem.title.length > 0) {
          typeName = firstItem.title[0].plain_text;
        } else if (firstItem.type === 'rich_text' && firstItem.rich_text.length > 0) {
          typeName = firstItem.rich_text[0].plain_text;
        }
      }

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
        imageUrl,
        pageContent
      };
    } catch (rowError) {
      console.error(`[Diagnostic] Skipped a row due to error:`, rowError.message);
      return null;
    }
  }));

  return formattedLogs.filter(log => log !== null);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { notionToken, timeZone } = req.body;

  // sources replaces the old single databaseId -- accept a list of
  // { label, databaseId } so entries from more than one Notion database
  // (e.g. a project tracker and a separate plant care journal) can be
  // merged into one timeline. Older callers sending a lone databaseId are
  // still handled as a single-item source list.
  let sources = Array.isArray(req.body.sources) ? req.body.sources : [];
  if (sources.length === 0 && req.body.databaseId) {
    sources = [{ label: 'Activity Log', databaseId: req.body.databaseId }];
  }
  sources = sources.filter(s => s && s.databaseId);

  if (!notionToken || sources.length === 0) {
    return res.status(400).json({ error: 'Missing credentials in request' });
  }

  // Set the dynamic timezone, falling back to UTC if not provided
  const targetTimeZone = timeZone || "UTC";

  const headers = {
    'Authorization': `Bearer ${notionToken}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json'
  };

  try {
    const perSourceLogs = await Promise.all(
      sources.map(s => fetchDatabaseLogs(s.databaseId, s.label || 'Activity Log', headers, targetTimeZone))
    );
    const validLogs = perSourceLogs.flat();
    console.log(`[Diagnostic] Successfully returning ${validLogs.length} valid logs to frontend across ${sources.length} database(s).`);

    return res.status(200).json({ success: true, data: validLogs });

  } catch (error) {
    console.error('[Diagnostic] Fatal API Error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}
