async function uploadImageToNotion(rawInput, notionToken) {
  try {
    const cleanBase64 = String(rawInput).replace(/^data:image\/\w+;base64,/, '').replace(/[\r\n\s]/g, '');
    if (!cleanBase64) return { id: null, error: 'Empty base64 string' };

    const isPng = cleanBase64.startsWith('iVBORw');
    const contentType = isPng ? 'image/png' : 'image/jpeg';
    const fileExt = isPng ? 'png' : 'jpg';
    const fileName = `photo_upload.${fileExt}`;

    const buffer = Buffer.from(cleanBase64, 'base64');
    const headers = {
      'Authorization': `Bearer ${notionToken}`,
      'Notion-Version': '2026-03-11',
      'Content-Type': 'application/json',
    };

    const createRes = await fetch('https://api.notion.com/v1/file_uploads', {
      method: 'POST',
      headers,
      body: JSON.stringify({ filename: fileName, content_type: contentType }),
    });
    const createData = await createRes.json();
    if (!createData.id) return { id: null, error: createData.message };

    const targetUrl = createData.upload_url || `https://api.notion.com/v1/file_uploads/${createData.id}/send`;
    const blob = new Blob([buffer], { type: contentType });
    const formData = new FormData();
    formData.append('file', blob, fileName);

    const uploadRes = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${notionToken}`, 'Notion-Version': '2026-03-11' },
      body: formData,
    });

    if (!uploadRes.ok) return { id: null, error: await uploadRes.text() };
    return { id: createData.id, error: null };
  } catch (err) {
    return { id: null, error: err.message };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    let body = req.body;
    if (typeof body === 'string') try { body = JSON.parse(body); } catch (e) {}

    const { notionToken, databaseId, title, dateTaken, latitude, longitude, location, imageBase64, pageId } = body || {};

    if (!notionToken || !imageBase64) {
      return res.status(400).json({ error: 'Missing token or image data.' });
    }

    const uploadResult = await uploadImageToNotion(imageBase64, notionToken);
    if (uploadResult.error) return res.status(400).json({ error: uploadResult.error });
    const fileId = uploadResult.id;

    const imageBlock = {
      object: 'block',
      type: 'image',
      image: { type: 'file_upload', file_upload: { id: fileId } }
    };

    const headers = {
      'Authorization': `Bearer ${notionToken}`,
      'Notion-Version': '2026-03-11',
      'Content-Type': 'application/json',
    };

    // 1. IF PAGE ID EXISTS -> Append image block and return pageId explicitly
    if (pageId && String(pageId).trim() !== '') {
      const appendRes = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ children: [imageBlock] })
      });
      const appendData = await appendRes.json();
      if (appendData.object === 'error') return res.status(400).json({ error: appendData.message });
      
      return res.status(200).json({ success: true, pageId: String(pageId).trim() });
    }

    // 2. IF NO PAGE ID -> Create a brand new page with properties (First photo)
    let validIsoDate = new Date().toISOString();
    if (dateTaken && !isNaN(new Date(dateTaken).getTime())) validIsoDate = new Date(dateTaken).toISOString();

    let placeProperty = undefined;
    const latNum = parseFloat(latitude);
    const lonNum = parseFloat(longitude);
    
    if (!isNaN(latNum) && !isNaN(lonNum)) {
      placeProperty = {
        place: {
          lat: latNum,
          lon: lonNum,
          name: location && String(location).trim() !== '' ? String(location).trim() : 'Pinned Location'
        }
      };
    }

    const properties = {
      Name: { title: [{ text: { content: String(title || 'Untitled Log') } }] },
      'Post-Date': { date: { start: validIsoDate } },
    };

    if (placeProperty) {
      properties['Place'] = placeProperty;
    }

    const pagePayload = {
      parent: { database_id: databaseId },
      properties,
      children: [imageBlock],
      cover: { type: 'file_upload', file_upload: { id: fileId } }
    };

    const createRes = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers,
      body: JSON.stringify(pagePayload),
    });
    const createData = await createRes.json();

    if (createData.object === 'error') return res.status(400).json({ error: createData.message });

    return res.status(200).json({ success: true, pageId: createData.id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}