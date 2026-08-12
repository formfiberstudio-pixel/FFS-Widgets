module.exports = async function handler(req, res) {
  // CORS Headers for SaaS flexibility
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-notion-api-key, x-trips-db-id, x-photos-db-id');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // STRICT AUTHENTICATION: 
  // Credentials must come from headers, never from URL query parameters.
  const apiKey = req.headers['x-notion-api-key'];
  const tripsDbId = req.headers['x-trips-db-id'];
  const photosDbId = req.headers['x-photos-db-id'];

  if (!apiKey || !tripsDbId || !photosDbId) {
    return res.status(401).json({ error: 'Missing Notion credentials. Please check your settings.' });
  }

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json'
  };

  // Helper function to find properties regardless of exact capitalization or trailing spaces
  const getProp = (props, name) => {
    const key = Object.keys(props).find(k => k.toLowerCase().trim() === name.toLowerCase());
    return key ? props[key] : null;
  };

  try {
    // 1. Fetch Trips Database
    const tripsReq = await fetch(`https://api.notion.com/v1/databases/${tripsDbId}/query`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ sorts: [{ property: 'DATE', direction: 'ascending' }] })
    });
    const tripsResponse = await tripsReq.json();

    if (tripsResponse.object === 'error') {
      return res.status(400).json({ error: `Trips DB Error: ${tripsResponse.message}` });
    }

    const formattedTrips = tripsResponse.results.map(page => ({
      id: page.id,
      title: getProp(page.properties, 'name')?.title[0]?.plain_text || getProp(page.properties, 'title')?.title[0]?.plain_text || 'Untitled',
      start: getProp(page.properties, 'date')?.date?.start || null,
      end: getProp(page.properties, 'date')?.date?.end || null,
      type: getProp(page.properties, 'type')?.select?.name || 'default',
      place_relation_id: getProp(page.properties, 'travel - places')?.relation[0]?.id || null
    }));

    // 2. Fetch Photos/Clusters Database Properties
    const photosReq = await fetch(`https://api.notion.com/v1/databases/${photosDbId}/query`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({})
    });
    const photosResponse = await photosReq.json();

    if (photosResponse.object === 'error') {
      return res.status(400).json({ error: `Photos DB Error: ${photosResponse.message}` });
    }

    const formattedPhotos = [];

    // 3. Sequential Fetch to prevent Notion API Rate Limits (429 Error)
    for (const page of photosResponse.results) {
      const props = page.properties;

      let dateProp = getProp(props, 'date') || getProp(props, 'timestamp');
      let rawTime = dateProp?.date?.start || null;

      let nameProp = getProp(props, 'name') || getProp(props, 'title');
      let rawTitle = nameProp?.title?.[0]?.plain_text || 'Unknown Cluster';

      let latProp = getProp(props, 'latitude') || getProp(props, 'lat');
      let rawLat = latProp?.number || null;

      let lonProp = getProp(props, 'longitude') || getProp(props, 'lon') || getProp(props, 'long');
      let rawLon = lonProp?.number || null;

      const webPhotos = [];
      const webVideos = [];

      // Check for Page Cover image as a fallback
      if (page.cover) {
        const coverUrl = page.cover.file?.url || page.cover.external?.url;
        if (coverUrl) webPhotos.push(coverUrl);
      }

      // Check standard Files & Media column just in case
      let mediaProp = getProp(props, 'media') || getProp(props, 'photos') || getProp(props, 'files') || getProp(props, 'files & media');
      let rawMedia = mediaProp?.files || [];
      rawMedia.forEach(file => {
        const url = file.file?.url || file.external?.url;
        if (url) url.match(/\.(mp4|mov)(\?|$)/i) ? webVideos.push(url) : webPhotos.push(url);
      });

      // Fetch the embedded page blocks sequentially
      try {
        const blocksReq = await fetch(`https://api.notion.com/v1/blocks/${page.id}/children`, {
          method: 'GET',
          headers: headers
        });
        const blocksRes = await blocksReq.json();

        // If blocks exist, extract images and videos
        if (blocksRes.results) {
          blocksRes.results.forEach(block => {
            if (block.type === 'image') {
              const url = block.image?.file?.url || block.image?.external?.url;
              if (url) webPhotos.push(url);
            } else if (block.type === 'video') {
              const url = block.video?.file?.url || block.video?.external?.url;
              if (url) webVideos.push(url);
            }
          });
        }
      } catch (err) {
        console.error(`Failed to fetch blocks for ${page.id}`);
      }

      formattedPhotos.push({
        activity_id: page.id,
        title: rawTitle,
        timestamp: rawTime,
        center_lat: rawLat,
        center_lon: rawLon,
        web_photos: webPhotos,
        web_videos: webVideos
      });
    }

    return res.status(200).json({ trips: formattedTrips, clusters: formattedPhotos });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}