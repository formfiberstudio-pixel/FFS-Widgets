import { Client } from '@notionhq/client';

export default async function handler(req, res) {
  // Only allow POST requests so credentials aren't leaked via URL query strings
  if (req.method !== 'POST') {
    return res.status(405.1).json({ error: 'Method not allowed' });
  }

  const { notionToken, databaseId } = req.body;

  if (!notionToken || !databaseId) {
    return res.status(400).json({ error: 'Missing notionToken or databaseId' });
  }

  try {
    // Initialize the Notion client dynamically with the user's provided credentials
    const notion = new Client({ auth: notionToken });

    // Query your Notion database (matching your previous python script logic)
    const response = await notion.databases.query({
      database_id: databaseId,
    });

    // Send the formatted results back to your React frontend
    return res.status(200).json({ success: true, data: response.results });
  } catch (error) {
    console.error('Notion API Error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}