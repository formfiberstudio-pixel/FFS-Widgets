// Universal Storage Keys across all FFS Widgets
const THEME_LIBRARY_KEY = 'ffs_studio_theme_library';
const ACTIVE_THEME_KEY_PREFIX = 'ffs_active_theme_';

// Default Fallback Themes
export const DEFAULT_THEMES = [
  {
    id: 'modern-dark',
    name: 'Modern Dark',
    colors: {
      primary: '#ef4444',
      secondary: '#3b82f6',
      bg: '#09090b',
      panelBg: '#18181b',
      text: '#f4f4f5'
    }
  },
  {
    id: 'cyber-cozy',
    name: 'Cyber Cozy (Cyworld)',
    colors: {
      primary: '#e8a598',
      secondary: '#a3c4bc',
      bg: '#b5d5e5',
      panelBg: '#eef6f8',
      text: '#2b3a42'
    }
  }
];

// Read all custom + default themes
export const getThemeLibrary = () => {
  if (typeof window === 'undefined') return DEFAULT_THEMES;
  const stored = localStorage.getItem(THEME_LIBRARY_KEY);
  return stored ? JSON.parse(stored) : DEFAULT_THEMES;
};

// Save an updated theme library
export const saveThemeLibrary = (themes) => {
  if (typeof window !== 'undefined') {
    localStorage.setItem(THEME_LIBRARY_KEY, JSON.stringify(themes));
    // Trigger window event so other widgets on the page re-render instantly
    window.dispatchEvent(new Event('storage'));
  }
};

// Get active theme ID for a specific widget (e.g. 'travel-log' or 'creator-calendar')
export const getActiveThemeId = (widgetId, fallbackId = 'modern-dark') => {
  if (typeof window === 'undefined') return fallbackId;
  return localStorage.getItem(`${ACTIVE_THEME_KEY_PREFIX}${widgetId}`) || fallbackId;
};

// Set active theme ID for a specific widget
export const setActiveThemeId = (widgetId, themeId) => {
  if (typeof window !== 'undefined') {
    localStorage.setItem(`${ACTIVE_THEME_KEY_PREFIX}${widgetId}`, themeId);
    window.dispatchEvent(new Event('storage'));
  }
};