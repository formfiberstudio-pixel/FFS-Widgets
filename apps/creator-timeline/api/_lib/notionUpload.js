import { notionFetch } from './notionFetch.js';

// Notion's own two-step flow for putting a file into Notion-hosted storage:
// register an upload slot (which hands back where to actually send the
// bytes), then POST the file there. Needs its own Notion-Version (the
// file_uploads endpoint didn't exist under the older version the read
// path uses) -- callers pass whichever version they're already using
// elsewhere so this stays in sync with the rest of their request.
export async function uploadImageToNotion(buffer, contentType, filename, notionToken, notionVersion) {
  const headers = {
    'Authorization': `Bearer ${notionToken}`,
    'Notion-Version': notionVersion,
    'Content-Type': 'application/json',
  };

  const createRes = await notionFetch('https://api.notion.com/v1/file_uploads', {
    method: 'POST',
    headers,
    body: JSON.stringify({ filename, content_type: contentType }),
  });
  const createData = await createRes.json();
  if (!createData.id) throw new Error(createData.message || 'Failed to register the upload with Notion.');

  const targetUrl = createData.upload_url || `https://api.notion.com/v1/file_uploads/${createData.id}/send`;
  const blob = new Blob([buffer], { type: contentType });
  const formData = new FormData();
  formData.append('file', blob, filename);

  const uploadRes = await fetch(targetUrl, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${notionToken}`, 'Notion-Version': notionVersion },
    body: formData,
  });
  if (!uploadRes.ok) throw new Error(await uploadRes.text());

  return createData.id;
}
