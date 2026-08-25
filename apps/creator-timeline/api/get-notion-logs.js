export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Extract the dynamically passed timeZone from the frontend
  const { notionToken, databaseId, timeZone } = req.body;

  if (!notionToken || !databaseId) {
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
    console.log(`[Diagnostic] Attempting to fetch Database ID: ${databaseId}`);
    
    const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: 'POST',
      headers: headers
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('[Diagnostic] Notion API Error Response:', errorData);
      throw new Error(errorData.message || 'Failed to fetch from Notion database');
    }

    const rawData = await response.json();
    console.log(`[Diagnostic] Successfully fetched ${rawData.results.length} rows.`);

    const formattedLogs = await Promise.all(rawData.results.map(async (page) => {
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
          try {
            const relRes = await fetch(`https://api.notion.com/v1/pages/${relatedPageId}`, { method: 'GET', headers });
            if (relRes.ok) {
              const relData = await relRes.json();
              const relTitleProp = Object.values(relData.properties).find(p => p.type === 'title');
              if (relTitleProp && relTitleProp.title.length > 0) {
                projectName = relTitleProp.title[0].plain_text;
              }
            } else {
               console.warn(`[Diagnostic] Relation fetch failed. Missing integration access to related DB.`);
            }
          } catch (err) {
            console.warn(`[Diagnostic] Network error fetching relation for page ${page.id}`);
          }
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
            headers: headers
          });
          
          if (blockRes.ok) {
            const blockData = await blockRes.json();
            const imgBlock = blockData.results.find(b => b.type === 'image');
            if (imgBlock) {
              imageUrl = imgBlock.image.type === 'external' ? imgBlock.image.external.url : imgBlock.image.file.url;
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

    // Filter out any rows that crashed
    const validLogs = formattedLogs.filter(log => log !== null);
    console.log(`[Diagnostic] Successfully returning ${validLogs.length} valid logs to frontend.`);

    return res.status(200).json({ success: true, data: validLogs });

  } catch (error) {
    console.error('[Diagnostic] Fatal API Error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}