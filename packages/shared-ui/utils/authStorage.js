// packages/shared-ui/utils/authStorage.js

const NOTION_TOKEN_KEY = 'ffs_notion_api_token';

// Save the master Notion token
export const saveNotionToken = (token) => {
  if (typeof window !== 'undefined') {
    localStorage.setItem(NOTION_TOKEN_KEY, token);
  }
};

// Retrieve the master Notion token
export const getNotionToken = () => {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(NOTION_TOKEN_KEY);
};

// Save a specific database ID for a widget (e.g., 'travel_log_db_id' or 'creator_calendar_db_id')
export const saveDatabaseId = (widgetId, dbId) => {
  if (typeof window !== 'undefined') {
    localStorage.setItem(`${widgetId}_db_id`, dbId);
  }
};

export const getDatabaseId = (widgetId) => {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(`${widgetId}_db_id`);
};