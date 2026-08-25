import { useState, useEffect, useRef } from 'react';

// Relative imports matching your folder structure
import themeTokens from '../tokens.json';

// Notion tag color palette lookup map
const NOTION_COLOR_MAP = {
  default: '#787774',
  gray: '#9B9A97',
  brown: '#64473A',
  orange: '#D9730D',
  yellow: '#DFAB01',
  green: '#0F7B6C',
  blue: '#0B6E99',
  purple: '#6940A5',
  pink: '#AD1A72',
  red: '#E03E3E',
};

const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const TIMELINE_WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

// -------------------------------------------------------------
// VECTOR LINE ICONS (NO COLOR, NO FILL)
// -------------------------------------------------------------
const IconSync = () => (
  <svg className="w-3.5 h-3.5 fill-none stroke-current" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.19"/>
  </svg>
);

const IconSettings = () => (
  <svg className="w-3.5 h-3.5 fill-none stroke-current" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
);

const IconFolder = () => (
  <svg className="w-3.5 h-3.5 fill-none stroke-current" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
  </svg>
);

const IconLink = () => (
  <svg className="w-3.5 h-3.5 fill-none stroke-current" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
  </svg>
);

const IconTheme = () => (
  <svg className="w-3.5 h-3.5 fill-none stroke-current" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
    <rect x="6" y="6" width="12" height="9" rx="1" ry="1"/>
    <circle cx="12" cy="19.5" r="0.75" fill="currentColor"/>
  </svg>
);

const IconScale = () => (
  <svg className="w-3.5 h-3.5 fill-none stroke-current" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/>
    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
);

const IconPalette = () => (
  <svg className="w-3.5 h-3.5 fill-none stroke-current" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10c.92 0 1.67-.75 1.67-1.67 0-.42-.16-.81-.44-1.11-.27-.29-.44-.68-.44-1.11 0-.92.75-1.67 1.67-1.67H16c3.31 0 6-2.69 6-6 0-4.97-4.03-9-10-9z"/>
    <circle cx="7.5" cy="11.5" r="1" fill="none" stroke="currentColor"/>
    <circle cx="10.5" cy="7.5" r="1" fill="none" stroke="currentColor"/>
    <circle cx="14.5" cy="7.5" r="1" fill="none" stroke="currentColor"/>
    <circle cx="17.5" cy="11.5" r="1" fill="none" stroke="currentColor"/>
  </svg>
);

const IconMoon = () => (
  <svg className="w-3 h-3 fill-none stroke-current" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  </svg>
);

const IconSun = () => (
  <svg className="w-3 h-3 fill-none stroke-current" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5"/>
    <line x1="12" y1="1" x2="12" y2="3"/>
    <line x1="12" y1="21" x2="12" y2="23"/>
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
    <line x1="1" y1="12" x2="3" y2="12"/>
    <line x1="21" y1="12" x2="23" y2="12"/>
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
  </svg>
);

const IconClose = () => (
  <svg className="w-4 h-4 fill-none stroke-current" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

const IconReset = () => (
  <svg className="w-3 h-3 fill-none stroke-current" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
    <path d="M3 3v5h5"/>
  </svg>
);

const IconPlus = () => (
  <svg className="w-3.5 h-3.5 fill-none stroke-current" viewBox="0 0 24 24" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19"/>
    <line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
);

// -------------------------------------------------------------
// BUILT-IN THEME PRESETS
// -------------------------------------------------------------
const DEFAULT_THEME_PRESETS = [
  {
    id: 'default-rose',
    name: 'Default Rose',
    isCustom: false,
    light: {
      bg: '#F8FAFC',
      card: '#FFFFFF',
      border: '#E2E8F0',
      text: '#0F172A',
      primary: '#F43F5E',
      secondary: '#F59E0B',
    },
    dark: {
      bg: '#191919',
      card: '#27272A',
      border: '#3F3F46',
      text: '#F4F4F5',
      primary: '#F43F5E',
      secondary: '#F59E0B',
    },
  },
  {
    id: 'nordic-slate',
    name: 'Nordic Slate',
    isCustom: false,
    light: {
      bg: '#F1F5F9',
      card: '#FFFFFF',
      border: '#CBD5E1',
      text: '#1E293B',
      primary: '#0284C7',
      secondary: '#0D9488',
    },
    dark: {
      bg: '#0F172A',
      card: '#1E293B',
      border: '#334155',
      text: '#F8FAFC',
      primary: '#38BDF8',
      secondary: '#2DD4BF',
    },
  },
  {
    id: 'emerald-forest',
    name: 'Emerald Forest',
    isCustom: false,
    light: {
      bg: '#F0FDF4',
      card: '#FFFFFF',
      border: '#DCFCE7',
      text: '#14532D',
      primary: '#16A34A',
      secondary: '#CA8A04',
    },
    dark: {
      bg: '#064E3B',
      card: '#065F46',
      border: '#047857',
      text: '#ECFDF5',
      primary: '#34D399',
      secondary: '#FBBF24',
    },
  },
  {
    id: 'cyberpunk-neon',
    name: 'Cyberpunk Neon',
    isCustom: false,
    light: {
      bg: '#FAF5FF',
      card: '#FFFFFF',
      border: '#E9D5FF',
      text: '#581C87',
      primary: '#C084FC',
      secondary: '#06B6D4',
    },
    dark: {
      bg: '#180220',
      card: '#2A083B',
      border: '#4C1D95',
      text: '#F3E8FF',
      primary: '#E879F9',
      secondary: '#22D3EE',
    },
  },
];

// -------------------------------------------------------------
// HELPER: HEX COLOR SHADE ADJUSTMENT
// -------------------------------------------------------------
const adjustHexColor = (hex, percent) => {
  if (!hex || !hex.startsWith('#')) return hex;
  let num = parseInt(hex.replace('#',''), 16);
  let amt = Math.round(2.55 * percent);
  let R = (num >> 16) + amt;
  let G = (num >> 8 & 0x00FF) + amt;
  let B = (num & 0x0000FF) + amt;
  return '#' + (
    0x1000000 +
    (R < 230 ? (R < 15 ? 15 : R) : 230) * 0x10000 +
    (G < 230 ? (G < 15 ? 15 : G) : 230) * 0x100 +
    (B < 230 ? (B < 15 ? 15 : B) : 230)
  ).toString(16).slice(1);
};

// -------------------------------------------------------------
// ONTARIO STATUTORY HOLIDAY CALCULATOR
// -------------------------------------------------------------
const getOntarioStatHolidayName = (dateObj) => {
  if (!dateObj) return null;
  const year = dateObj.getFullYear();
  const month = dateObj.getMonth();
  const day = dateObj.getDate();
  const dayOfWeek = dateObj.getDay();

  if (month === 0 && day === 1) return "New Year's Day";
  if (month === 6 && day === 1) return "Canada Day";
  if (month === 11 && day === 25) return "Christmas Day";
  if (month === 11 && day === 26) return "Boxing Day";

  if (month === 1 && dayOfWeek === 1 && day >= 15 && day <= 21) return "Family Day";
  if (month === 4 && dayOfWeek === 1 && day >= 18 && day <= 24) return "Victoria Day";
  if (month === 7 && dayOfWeek === 1 && day <= 7) return "Civic Holiday";
  if (month === 8 && dayOfWeek === 1 && day <= 7) return "Labour Day";
  if (month === 9 && dayOfWeek === 1 && day >= 8 && day <= 14) return "Thanksgiving";

  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const easterMonth = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const easterDay = ((h + l - 7 * m + 114) % 31) + 1;
  
  const goodFriday = new Date(year, easterMonth, easterDay - 2);
  if (month === goodFriday.getMonth() && day === goodFriday.getDate()) return "Good Friday";

  return null;
};

// -------------------------------------------------------------
// HELPER: SPECIAL DAYS MATCHING ENGINE (ANNUAL VS ONCE)
// -------------------------------------------------------------
const getSpecialDayForDate = (dateObj, specialDaysList = []) => {
  if (!dateObj || !Array.isArray(specialDaysList) || specialDaysList.length === 0) return null;

  const targetYear = dateObj.getFullYear();
  const targetMonth = dateObj.getMonth() + 1;
  const targetDay = dateObj.getDate();

  return specialDaysList.find((event) => {
    if (event.occurrence === 'Annual') {
      return event.monthNumber === targetMonth && event.dayNumber === targetDay;
    } else {
      return (
        event.year === targetYear &&
        event.monthNumber === targetMonth &&
        event.dayNumber === targetDay
      );
    }
  });
};

// -------------------------------------------------------------
// HELPER: UNIFIED DAY DOT STYLING
// -------------------------------------------------------------
const getDayDotStyling = (dateObj, hasLog, logDotHex, specialDay) => {
  if (!dateObj) return { bg: 'var(--theme-card)', text: 'var(--theme-text)', border: 'var(--theme-border)' };
  if (hasLog) {
    return { bg: logDotHex, text: '#FFFFFF', border: 'rgba(255,255,255,0.8)' };
  }
  const statName = getOntarioStatHolidayName(dateObj);
  const isWknd = dateObj.getDay() === 0 || dateObj.getDay() === 6;

  if (specialDay) {
    return { bg: 'var(--theme-card)', text: 'var(--theme-secondary)', border: 'var(--theme-secondary)' };
  }
  if (statName) {
    return { bg: 'var(--theme-card)', text: 'var(--theme-secondary)', border: 'var(--theme-secondary)' };
  }
  if (isWknd) {
    return { bg: 'var(--theme-card)', text: 'var(--theme-primary)', border: 'var(--theme-primary)' };
  }
  return { bg: 'var(--theme-card)', text: 'var(--theme-text)', border: 'var(--theme-border)' };
};

// -------------------------------------------------------------
// SUB-COMPONENT: WEEK DAY COLUMN
// -------------------------------------------------------------
function WeekDayColumn({ 
  slot, 
  logs, 
  isTodayDate, 
  displayDotHex, 
  weekCardHeight, 
  cardRadius, 
  hoveredProjectTitle, 
  setHoveredProjectTitle, 
  setSelectedLogModal, 
  getDotColor,
  scaleFactor,
  specialDay
}) {
  const scrollRef = useRef(null);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);

  const checkScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setCanScrollUp(scrollTop > 4);
    setCanScrollDown(scrollTop + clientHeight < scrollHeight - 4);
  };

  useEffect(() => {
    checkScroll();
  }, [logs, weekCardHeight]);

  const hasLog = logs.length > 0;
  const dotPx = Math.round(24 * scaleFactor);
  const dotFontPx = Math.round(11 * scaleFactor);
  const dotStyle = getDayDotStyling(slot.dateObj, hasLog, displayDotHex, specialDay);

  return (
    <div 
      className={`flex flex-col h-full border shadow-sm overflow-hidden transition-all relative ${
        isTodayDate ? 'ring-2 ring-[var(--theme-primary)] ring-offset-1 z-10' : ''
      }`} 
      style={{ 
        borderRadius: `${cardRadius}px`,
        backgroundColor: 'var(--theme-card)',
        borderColor: 'var(--theme-border)',
        color: 'var(--theme-text)'
      }}
    >
      <div 
        className="p-2 shrink-0 border-b flex items-center justify-between z-10 relative"
        style={{ borderColor: 'var(--theme-border)', backgroundColor: 'var(--theme-bg)' }}
      >
        <div 
          className={`rounded-full flex items-center justify-center font-bold shadow-sm border transition-all ${
            isTodayDate && !hasLog ? 'ring-2 ring-[var(--theme-primary)] text-white' : ''
          }`} 
          style={{ 
            width: `${dotPx}px`,
            height: `${dotPx}px`,
            fontSize: `${dotFontPx}px`,
            backgroundColor: isTodayDate && !hasLog ? 'var(--theme-primary)' : dotStyle.bg,
            color: isTodayDate && !hasLog ? '#FFFFFF' : dotStyle.text,
            borderColor: dotStyle.border
          }}
        >
          {slot.dayNum}
        </div>

        {logs.length > 1 && (
          <span 
            className="font-bold px-1.5 py-0.5 rounded-full border"
            style={{ 
              fontSize: `${Math.round(10 * scaleFactor)}px`,
              backgroundColor: 'var(--theme-secondary-20, rgba(245, 158, 11, 0.2))', 
              color: 'var(--theme-secondary)', 
              borderColor: 'var(--theme-secondary)' 
            }}
          >
            {logs.length}
          </span>
        )}
      </div>

      {canScrollUp && (
        <button 
          onClick={() => scrollRef.current?.scrollBy({ top: -(weekCardHeight + 10), behavior: 'smooth' })}
          className="absolute top-[41px] left-0 right-0 z-20 flex items-center justify-center py-1.5 cursor-pointer hover:opacity-100 opacity-80 transition-all"
          style={{ background: 'linear-gradient(to bottom, var(--theme-card), transparent)' }}
          title="Scroll up"
        >
          <svg className="w-6 h-2.5 fill-none" style={{ stroke: 'var(--theme-primary)' }} viewBox="0 0 24 10" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="2 8 12 2 22 8" />
          </svg>
        </button>
      )}

      <div 
        ref={scrollRef}
        onScroll={checkScroll}
        className="flex-1 overflow-y-auto p-2 space-y-2.5 min-h-0 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        {hasLog ? (
          logs.map((log) => {
            const logDotHex = getDotColor(log);
            const isHoveredProject = (log.Projects || 'Untitled Project') === hoveredProjectTitle;
            const isUnrelatedHover = hoveredProjectTitle && !isHoveredProject;

            return (
              <div 
                key={log.id} 
                onClick={() => setSelectedLogModal({ dateObj: slot.dateObj, logs })}
                onMouseEnter={() => setHoveredProjectTitle(log.Projects || 'Untitled Project')}
                onMouseLeave={() => setHoveredProjectTitle(null)}
                style={{ 
                  height: `${weekCardHeight}px`,
                  backgroundColor: 'var(--theme-bg)',
                  borderColor: isHoveredProject ? 'var(--theme-secondary)' : 'var(--theme-border)'
                }}
                className={`relative overflow-hidden rounded-lg border shadow-xs p-2 shrink-0 flex flex-col justify-between transition-all cursor-pointer ${
                  isHoveredProject ? 'ring-2 ring-[var(--theme-secondary)] shadow-md scale-[1.01] z-10' : ''
                } ${isUnrelatedHover ? 'opacity-40 grayscale-[50%]' : ''}`}
              >
                {log.imageUrl && (
                  <img 
                    src={log.imageUrl} 
                    className="absolute inset-0 w-full h-full object-cover z-0 transition-opacity duration-200" 
                    alt="" 
                  />
                )}

                <div className="relative z-10 flex items-center gap-1.5 pointer-events-none">
                  <span 
                    className="inline-flex items-center font-bold text-white px-2 py-0.5 rounded-full backdrop-blur-sm truncate max-w-full leading-none shadow-xs"
                    style={{ backgroundColor: logDotHex, fontSize: `${Math.round(10 * scaleFactor)}px` }}
                  >
                    {log.Projects}
                  </span>
                </div>

                <div className="relative z-10 mt-auto">
                  <div 
                    className="font-bold text-white bg-black/40 p-1.5 rounded-sm backdrop-blur-sm line-clamp-2 leading-tight"
                    style={{ fontSize: `${Math.round(11 * scaleFactor)}px` }}
                  >
                    {log.title}
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="h-full flex items-center justify-center italic opacity-40" style={{ fontSize: `${Math.round(10 * scaleFactor)}px` }}>
            No entries
          </div>
        )}
      </div>

      {canScrollDown && (
        <button 
          onClick={() => scrollRef.current?.scrollBy({ top: weekCardHeight + 10, behavior: 'smooth' })}
          className="absolute bottom-0 left-0 right-0 z-20 flex items-center justify-center py-1.5 cursor-pointer hover:opacity-100 opacity-80 transition-all"
          style={{ background: 'linear-gradient(to top, var(--theme-card), transparent)' }}
          title="Scroll down"
        >
          <svg className="w-6 h-2.5 fill-none" style={{ stroke: 'var(--theme-primary)' }} viewBox="0 0 24 10" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="2 2 12 8 22 2" />
          </svg>
        </button>
      )}
    </div>
  );
}

// -------------------------------------------------------------
// MAIN APP COMPONENT
// -------------------------------------------------------------
function App() {
  const today = new Date();
  const [currentDate, setCurrentDate] = useState(today);
  const [viewMode, setViewMode] = useState('year'); 
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [selectedProjectFilters, setSelectedProjectFilters] = useState([]); 
  const [selectedLogModal, setSelectedLogModal] = useState(null); 
  
  const [thumbnailOverrides, setThumbnailOverrides] = useState(() => {
    const saved = localStorage.getItem('notionWidgetThumbnails');
    return saved ? JSON.parse(saved) : {};
  });

  useEffect(() => {
    localStorage.setItem('notionWidgetThumbnails', JSON.stringify(thumbnailOverrides));
  }, [thumbnailOverrides]);

  const [hoveredProjectTitle, setHoveredProjectTitle] = useState(null);
  const [hoveredWeek, setHoveredWeek] = useState(null);
  const [hoveredMonthButtonIndex, setHoveredMonthButtonIndex] = useState(null);
  const [collapsedTypes, setCollapsedTypes] = useState({});

  // --- SIDEBAR WIDTH RESIZING STATE ---
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('notionWidgetSidebarWidth');
    return saved ? Number(saved) : 260;
  });
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const sidebarDragStartX = useRef(0);
  const sidebarDragStartWidth = useRef(260);

  useEffect(() => {
    localStorage.setItem('notionWidgetSidebarWidth', sidebarWidth);
  }, [sidebarWidth]);

  const handleMouseDownSidebarResize = (e) => {
    e.preventDefault();
    setIsResizingSidebar(true);
    sidebarDragStartX.current = e.clientX;
    sidebarDragStartWidth.current = sidebarWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizingSidebar) return;
      const deltaX = e.clientX - sidebarDragStartX.current;
      const newWidth = Math.min(Math.max(sidebarDragStartWidth.current + deltaX, 180), 480);
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (isResizingSidebar) {
        setIsResizingSidebar(false);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    if (isResizingSidebar) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingSidebar]);

  // --- VIEW SCALE / TEXT SIZE STATE ---
  const [viewScale, setViewScale] = useState(() => {
    const saved = localStorage.getItem('notionWidgetViewScale');
    return saved ? Number(saved) : 100;
  });

  useEffect(() => {
    localStorage.setItem('notionWidgetViewScale', viewScale);
  }, [viewScale]);

  const scaleFactor = viewScale / 100;

  // Derived baseline component dimensions
  const monthDotPx = Math.round(24 * scaleFactor);
  const monthDotFontPx = Math.round(11 * scaleFactor);
  const yearDotPx = Math.round(16 * scaleFactor);
  const yearDotFontPx = Math.round(8 * scaleFactor);
  const cardTitleFontPx = Math.round(11 * scaleFactor);
  const projectTagFontPx = Math.round(10 * scaleFactor);

  // --- THEME MANAGER STATE ---
  const [customThemes, setCustomThemes] = useState(() => {
    const saved = localStorage.getItem('notionWidgetCustomThemes');
    return saved ? JSON.parse(saved) : [];
  });

  const [activeThemeId, setActiveThemeId] = useState(() => {
    const saved = localStorage.getItem('notionWidgetActiveThemeId');
    return saved || 'default-rose';
  });

  const [settingsTab, setSettingsTab] = useState('notion'); 
  const [themeEditMode, setThemeEditMode] = useState('dark');

  useEffect(() => {
    localStorage.setItem('notionWidgetCustomThemes', JSON.stringify(customThemes));
  }, [customThemes]);

  useEffect(() => {
    localStorage.setItem('notionWidgetActiveThemeId', activeThemeId);
  }, [activeThemeId]);

  const allThemes = [...DEFAULT_THEME_PRESETS, ...customThemes];
  const activeTheme = allThemes.find(t => t.id === activeThemeId) || DEFAULT_THEME_PRESETS[0];

  // --- PROJECT DOT COLOR CUSTOMIZATION STATE ---
  const [customCategoryColors, setCustomCategoryColors] = useState(() => {
    const saved = localStorage.getItem('notionWidgetCustomCategoryColors');
    return saved ? JSON.parse(saved) : {};
  });

  const [customProjectColors, setCustomProjectColors] = useState(() => {
    const saved = localStorage.getItem('notionWidgetCustomProjectColors');
    return saved ? JSON.parse(saved) : {};
  });

  useEffect(() => {
    localStorage.setItem('notionWidgetCustomCategoryColors', JSON.stringify(customCategoryColors));
  }, [customCategoryColors]);

  useEffect(() => {
    localStorage.setItem('notionWidgetCustomProjectColors', JSON.stringify(customProjectColors));
  }, [customProjectColors]);

  // --- WEEK VIEW CARD HEIGHT & RESIZING STATE ---
  const [weekCardHeight, setWeekCardHeight] = useState(() => {
    const saved = localStorage.getItem('notionWidgetWeekCardHeight');
    return saved ? Number(saved) : 120;
  });
  const [isResizingCardHeight, setIsResizingCardHeight] = useState(false);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(120);

  useEffect(() => {
    localStorage.setItem('notionWidgetWeekCardHeight', weekCardHeight);
  }, [weekCardHeight]);

  const handleMouseDownResize = (e) => {
    e.preventDefault();
    setIsResizingCardHeight(true);
    dragStartY.current = e.clientY;
    dragStartHeight.current = weekCardHeight;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizingCardHeight) return;
      const deltaY = e.clientY - dragStartY.current;
      const newHeight = Math.min(Math.max(dragStartHeight.current + deltaY, 70), 340);
      setWeekCardHeight(newHeight);
    };

    const handleMouseUp = () => {
      if (isResizingCardHeight) {
        setIsResizingCardHeight(false);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    if (isResizingCardHeight) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingCardHeight]);

  // --- API STATE VARS ---
  const [timelineLogs, setTimelineLogs] = useState([]);
  const [specialDays, setSpecialDays] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [notionToken, setNotionToken] = useState('');
  const [databaseId, setDatabaseId] = useState('');
  const [specialDaysDatabaseId, setSpecialDaysDatabaseId] = useState('');

  // --- PROJECT GRADIENT SHADE MAP ---
  const [projectColorMap, setProjectColorMap] = useState({});

  // --- RESPONSIVE ROTATION VARS ---
  const [yearOrientationMode, setYearOrientationMode] = useState('auto');
  const [calendarSize, setCalendarSize] = useState({ width: 0, height: 0 });

  const appRef = useRef(null);
  const calendarRef = useRef(null);
  const modalCarouselRef = useRef(null);

  const [isDarkMode, setIsDarkMode] = useState(() => 
    window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
  );

  useEffect(() => {
    if (!calendarRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        setCalendarSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(calendarRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e) => setIsDarkMode(e.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const activeYearOrientation = yearOrientationMode === 'auto' 
    ? (calendarSize.width >= calendarSize.height ? 'landscape' : 'portrait') 
    : yearOrientationMode;

  const currentThemeColors = isDarkMode ? activeTheme.dark : activeTheme.light;

  // -------------------------------------------------------------
  // THEME DUPLICATION & EDITING ACTIONS
  // -------------------------------------------------------------
  const handleDuplicateTheme = (sourceTheme) => {
    const newThemeId = `custom-${Date.now()}`;
    const newCustomTheme = {
      id: newThemeId,
      name: `${sourceTheme.name} (Copy)`,
      isCustom: true,
      light: { ...sourceTheme.light },
      dark: { ...sourceTheme.dark },
    };
    setCustomThemes(prev => [...prev, newCustomTheme]);
    setActiveThemeId(newThemeId);
  };

  const handleUpdateCustomThemeName = (name) => {
    setCustomThemes(prev => prev.map(t => t.id === activeThemeId ? { ...t, name } : t));
  };

  const handleUpdateCustomThemeColor = (mode, key, hexValue) => {
    setCustomThemes(prev => prev.map(t => {
      if (t.id !== activeThemeId) return t;
      return {
        ...t,
        [mode]: {
          ...t[mode],
          [key]: hexValue
        }
      };
    }));
  };

  const handleDeleteCustomTheme = (themeId) => {
    setCustomThemes(prev => prev.filter(t => t.id !== themeId));
    setActiveThemeId('default-rose');
  };

  // -------------------------------------------------------------
  // PROJECT DOT COLOR CUSTOMIZATION ACTIONS
  // -------------------------------------------------------------
  const handleResetDotColors = () => {
    setCustomCategoryColors({});
    setCustomProjectColors({});
  };

  const handleUpdateCategoryColor = (type, hexValue) => {
    setCustomCategoryColors(prev => ({ ...prev, [type]: hexValue }));
  };

  const handleUpdateProjectColor = (projTitle, hexValue) => {
    setCustomProjectColors(prev => ({ ...prev, [projTitle]: hexValue }));
  };

  const handleResetCategoryColor = (type) => {
    setCustomCategoryColors(prev => {
      const next = { ...prev };
      delete next[type];
      return next;
    });
  };

  const handleResetProjectColor = (projTitle) => {
    setCustomProjectColors(prev => {
      const next = { ...prev };
      delete next[projTitle];
      return next;
    });
  };

  // -------------------------------------------------------------
  // API FETCHING & DYNAMIC DOT COLOR MAPPING LOGIC
  // -------------------------------------------------------------
  useEffect(() => {
    const savedToken = localStorage.getItem('notionToken');
    const savedDbId = localStorage.getItem('databaseId');
    const savedSpecialDbId = localStorage.getItem('specialDaysDatabaseId') || '';
    if (savedToken && savedDbId) {
      setNotionToken(savedToken);
      setDatabaseId(savedDbId);
      setSpecialDaysDatabaseId(savedSpecialDbId);
      fetchLogsFromNotion(savedToken, savedDbId, savedSpecialDbId);
    } else {
      setShowSettings(true);
    }
  }, []);

  useEffect(() => {
    if (timelineLogs.length > 0) {
      generateProjectColorMap(timelineLogs);
    }
  }, [customCategoryColors, customProjectColors, activeThemeId, isDarkMode]);

  const fetchLogsFromNotion = async (token, dbId, specDbId = specialDaysDatabaseId) => {
    setIsLoading(true);
    setFetchError(null);
    try {
      const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

      const response = await fetch('/api/get-notion-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          notionToken: token, 
          databaseId: dbId,
          specialDaysDatabaseId: specDbId ? specDbId.trim() : '',
          timeZone: userTimeZone
        }),
      });
      
      const result = await response.json();
      if (result.success) {
        setTimelineLogs(result.data || []);
        setSpecialDays(result.specialDays || []);
        generateProjectColorMap(result.data || []);
      } else {
        setFetchError(result.error || 'Failed to sync with Notion.');
      }
    } catch (err) {
      setFetchError('Network error occurred while fetching logs.');
    } finally {
      setIsLoading(false);
    }
  };

  const generateProjectColorMap = (logs) => {
    if (!Array.isArray(logs)) return;
    const typeToProjects = {};
    
    logs.forEach(log => {
      const type = log.projectType || 'General';
      const proj = log.Projects || 'Untitled Project';
      if (!typeToProjects[type]) typeToProjects[type] = new Set();
      typeToProjects[type].add(proj);
    });

    const newColorMap = {};
    Object.entries(typeToProjects).forEach(([type, projSet]) => {
      const projs = Array.from(projSet).sort();
      const total = projs.length;
      
      let baseHex = currentThemeColors.primary;
      if (customCategoryColors[type]) {
        baseHex = customCategoryColors[type];
      } else {
        const sampleLog = logs.find(l => (l.projectType || 'General') === type);
        if (sampleLog?.projectTypeColor && NOTION_COLOR_MAP[sampleLog.projectTypeColor]) {
          baseHex = NOTION_COLOR_MAP[sampleLog.projectTypeColor];
        } else if (themeTokens?.colour?.dot?.[type]?.$value?.hex) {
          baseHex = themeTokens.colour.dot[type].$value.hex;
        }
      }

      projs.forEach((proj, idx) => {
        if (customProjectColors[proj]) {
          newColorMap[proj] = customProjectColors[proj];
        } else {
          const percent = total <= 1 ? 0 : -15 + (idx / (total - 1)) * 25;
          newColorMap[proj] = adjustHexColor(baseHex, percent);
        }
      });
    });

    setProjectColorMap(newColorMap);
  };

  const handleSaveSettings = () => {
    localStorage.setItem('notionToken', notionToken);
    localStorage.setItem('databaseId', databaseId);
    localStorage.setItem('specialDaysDatabaseId', specialDaysDatabaseId);
    setShowSettings(false);
    fetchLogsFromNotion(notionToken, databaseId, specialDaysDatabaseId);
  };

  const gap = themeTokens?.layout?.gridGap?.$value ?? 12;
  const cardRadius = themeTokens?.card?.radius?.$value ?? 6;

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const getDotColor = (log) => {
    if (!log) return currentThemeColors.border;
    const projName = log.Projects || 'Untitled Project';
    if (projectColorMap[projName]) {
      return projectColorMap[projName];
    }
    if (log.projectTypeColor && NOTION_COLOR_MAP[log.projectTypeColor]) {
      return NOTION_COLOR_MAP[log.projectTypeColor];
    }
    if (log.projectType) {
      const tokenHex = themeTokens?.colour?.dot?.[log.projectType]?.$value?.hex;
      if (tokenHex) return tokenHex;
    }
    return currentThemeColors.primary;
  };

  const getDisplayDotColor = (logs, dateObj) => {
    if (!logs || logs.length === 0) return currentThemeColors.border;
    if (hoveredProjectTitle) {
      const matchingLog = logs.find(l => (l.Projects || 'Untitled Project') === hoveredProjectTitle);
      if (matchingLog) {
        return getDotColor(matchingLog);
      }
    }
    const { primaryLog } = getThumbnailLogForDate(dateObj, logs);
    return getDotColor(primaryLog);
  };

  const isToday = (dateObj) => {
    if (!dateObj) return false;
    return (
      dateObj.getFullYear() === today.getFullYear() &&
      dateObj.getMonth() === today.getMonth() &&
      dateObj.getDate() === today.getDate()
    );
  };

  const getLogsForDate = (dateObj) => {
    if (!dateObj || !Array.isArray(timelineLogs)) return [];
    const targetYear = dateObj.getFullYear();
    const targetMonth = dateObj.getMonth() + 1;
    const targetDay = dateObj.getDate();

    return timelineLogs.filter((log) => {
      if (log.year && log.monthNumber && log.dayNumber !== undefined) {
        const matchesDate = (
          Number(log.year) === targetYear &&
          Number(log.monthNumber) === targetMonth &&
          Number(log.dayNumber) === targetDay
        );
        if (!matchesDate) return false;
        if (selectedProjectFilters.length > 0) {
          return selectedProjectFilters.includes(log.Projects);
        }
        return true;
      }
      return false;
    });
  };

  const getThumbnailLogForDate = (dateObj, logs) => {
    if (!logs || logs.length === 0) return { primaryLog: null, isHalftoned: false };
    const dateKey = dateObj.toISOString().split('T')[0];

    if (hoveredProjectTitle) {
      const matchingProjectLog = logs.find(l => (l.Projects || 'Untitled Project') === hoveredProjectTitle);
      if (matchingProjectLog) {
        return { primaryLog: matchingProjectLog, isHalftoned: false };
      } else {
        const overrideId = thumbnailOverrides[dateKey];
        const primaryLog = overrideId ? logs.find(l => l.id === overrideId) || logs[0] : logs[0];
        return { primaryLog, isHalftoned: true };
      }
    }

    const overrideId = thumbnailOverrides[dateKey];
    const primaryLog = overrideId ? logs.find(l => l.id === overrideId) || logs[0] : logs[0];
    return { primaryLog, isHalftoned: false };
  };

  const getYearProjects = (targetYear) => {
    if (!Array.isArray(timelineLogs)) return [];
    const yearLogs = timelineLogs.filter(log => Number(log.year) === targetYear);
    
    const projectMap = {};
    yearLogs.forEach(log => {
      const projectName = log.Projects || 'Untitled Project';
      const key = projectName + '::' + (log.projectType || 'General');
      const logDate = new Date(Number(log.year), Number(log.monthNumber) - 1, Number(log.dayNumber));
      if (!projectMap[key]) {
        projectMap[key] = {
          title: projectName,
          projectType: log.projectType || 'General',
          projectTypeColor: log.projectTypeColor,
          startDate: logDate,
          imageUrl: log.imageUrl,
        };
      } else {
        if (logDate < projectMap[key].startDate) {
          projectMap[key].startDate = logDate;
        }
      }
    });

    const projects = Object.values(projectMap);
    projects.sort((a, b) => {
      if (a.projectType !== b.projectType) return a.projectType.localeCompare(b.projectType);
      return a.startDate - b.startDate;
    });
    return projects;
  };

  const groupedProjects = (() => {
    const projects = getYearProjects(year);
    const grouped = {};
    projects.forEach(proj => {
      const type = proj.projectType || 'General';
      if (!grouped[type]) grouped[type] = [];
      grouped[type].push(proj);
    });
    return grouped;
  })();

  const toggleTypeAccordion = (type) => setCollapsedTypes(prev => ({ ...prev, [type]: !prev[type] }));
  const handleExpandAllCategories = () => { const s = {}; Object.keys(groupedProjects).forEach(t => { s[t] = false; }); setCollapsedTypes(s); };
  const handleCollapseAllCategories = () => { const s = {}; Object.keys(groupedProjects).forEach(t => { s[t] = true; }); setCollapsedTypes(s); };
  const handleShowAllFilters = () => setSelectedProjectFilters([]);
  const toggleProjectFilter = (title) => setSelectedProjectFilters((prev) => prev.includes(title) ? prev.filter(t => t !== title) : [...prev, title]);

  const handleWeekClick = (mIdx, weekIndex) => {
    const firstDayOfMonthObj = new Date(year, mIdx, 1);
    const startOffsetColumn = firstDayOfMonthObj.getDay();
    const daysInMonth = new Date(year, mIdx + 1, 0).getDate();

    let targetDay = null;
    for (let i = 0; i < 7; i++) {
      const colIndex = weekIndex * 7 + i;
      const dayNum = colIndex - startOffsetColumn + 1;
      if (dayNum > 0 && dayNum <= daysInMonth) {
        targetDay = dayNum;
        break;
      }
    }

    if (targetDay !== null) {
      setCurrentDate(new Date(year, mIdx, targetDay));
      setViewMode('week');
    }
  };

  let slots = [];
  let startOfWeek = null;
  let endOfWeek = null;

  if (viewMode === 'month') {
    const firstDayOfMonth = new Date(year, month, 1);
    const startDayOffset = firstDayOfMonth.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const totalSlots = Math.ceil((daysInMonth + startDayOffset) / 7) * 7;

    for (let i = 0; i < totalSlots; i++) {
      const dayNum = i - startDayOffset + 1;
      const isValidDay = dayNum > 0 && dayNum <= daysInMonth;
      slots.push({
        dateObj: isValidDay ? new Date(year, month, dayNum) : null,
        isValid: isValidDay,
        dayNum: isValidDay ? dayNum : null,
      });
    }
  } else if (viewMode === 'week') {
    startOfWeek = new Date(currentDate);
    startOfWeek.setDate(currentDate.getDate() - currentDate.getDay());
    endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);

    for (let i = 0; i < 7; i++) {
      const slotDate = new Date(startOfWeek);
      slotDate.setDate(startOfWeek.getDate() + i);
      slots.push({
        dateObj: slotDate,
        isValid: true,
        dayNum: slotDate.getDate(),
      });
    }
  }

  const rows = [];
  if (viewMode === 'month') {
    for (let i = 0; i < slots.length; i += 7) {
      rows.push(slots.slice(i, i + 7));
    }
  }

  const handlePrev = () => {
    if (viewMode === 'month') setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
    else if (viewMode === 'week') { const d = new Date(currentDate); d.setDate(currentDate.getDate() - 7); setCurrentDate(d); }
    else setCurrentDate(new Date(currentDate.getFullYear() - 1, currentDate.getMonth(), 1));
  };

  const handleNext = () => {
    if (viewMode === 'month') setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
    else if (viewMode === 'week') { const d = new Date(currentDate); d.setDate(currentDate.getDate() + 7); setCurrentDate(d); }
    else setCurrentDate(new Date(currentDate.getFullYear() + 1, currentDate.getMonth(), 1));
  };

  // -------------------------------------------------------------
  // DYNAMIC THEME & VIEW SCALE INJECTION
  // -------------------------------------------------------------
  const themeVars = {
    '--theme-bg': currentThemeColors.bg,
    '--theme-card': currentThemeColors.card,
    '--theme-border': currentThemeColors.border,
    '--theme-text': currentThemeColors.text,
    '--theme-primary': currentThemeColors.primary,
    '--theme-secondary': currentThemeColors.secondary,
  };

  return (
    <div 
      ref={appRef} 
      style={{ ...themeVars, backgroundColor: 'var(--theme-bg)', color: 'var(--theme-text)' }}
      className="w-full h-screen flex flex-col p-4 sm:p-6 overflow-hidden select-none transition-colors duration-300"
    >
      
      {/* HEADER */}
      <header className="shrink-0 mb-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          {viewMode === 'month' ? (
            <h1 className="text-2xl font-bold tracking-tight inline-flex items-center gap-2">
              <span>{currentDate.toLocaleDateString('en-US', { month: 'long' })}</span>
              <button onClick={() => setViewMode('year')} className="cursor-pointer hover:underline" style={{ color: 'var(--theme-primary)' }}>{currentDate.getFullYear()}</button>
            </h1>
          ) : viewMode === 'week' ? (
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-1.5">
              <span className="cursor-pointer hover:opacity-80" onClick={() => setViewMode('month')}>
                {startOfWeek?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
              <span>–</span>
              <span>{endOfWeek?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })},</span>
              <span className="cursor-pointer" style={{ color: 'var(--theme-primary)' }} onClick={() => setViewMode('year')}>{endOfWeek?.getFullYear()}</span>
            </h1>
          ) : (
            <h1 className="text-2xl font-bold tracking-tight">
              <span style={{ color: 'var(--theme-primary)' }}>{year}</span> Projects Overview
            </h1>
          )}
          <p className="text-sm mt-1 opacity-60">Driven by Figma Tokens & Notion Data.</p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => { if (notionToken && databaseId) fetchLogsFromNotion(notionToken, databaseId, specialDaysDatabaseId); }}
            disabled={isLoading || !notionToken || !databaseId}
            title="Sync Notion Data"
            style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}
            className="px-3 py-1.5 text-xs font-semibold border rounded-md cursor-pointer flex items-center gap-1.5 shadow-sm transition-colors disabled:opacity-50"
          >
            <span className={isLoading ? "animate-spin" : ""}><IconSync /></span>
            <span>Sync</span>
          </button>

          <button
            onClick={() => setShowSettings(true)}
            title="Widget Settings & Customization"
            style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}
            className="px-3 py-1.5 text-xs font-semibold border rounded-md cursor-pointer flex items-center gap-1.5 shadow-sm transition-colors"
          >
            <IconSettings />
            <span>Settings</span>
          </button>

          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}
            className="px-3 py-1.5 text-xs font-semibold border rounded-md cursor-pointer flex items-center gap-1.5"
          >
            <IconFolder />
            <span>{isSidebarOpen ? 'Hide Projects' : 'Projects'}</span>
          </button>

          <button
            onClick={() => setCurrentDate(today)}
            style={{ 
              backgroundColor: 'var(--theme-card)', 
              borderColor: 'var(--theme-primary)',
              color: 'var(--theme-primary)'
            }}
            className="px-3 py-1.5 text-xs font-semibold rounded-md flex items-center gap-1.5 border cursor-pointer"
          >
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: 'var(--theme-primary)' }} />Today
          </button>

          <div className="flex items-center p-0.5 rounded-lg border" style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}>
            <button onClick={() => setViewMode('year')} className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${viewMode === 'year' ? 'bg-black/20 font-bold' : 'opacity-60'}`}>Year</button>
            <button onClick={() => setViewMode('month')} className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${viewMode === 'month' ? 'bg-black/20 font-bold' : 'opacity-60'}`}>Month</button>
            <button onClick={() => setViewMode('week')} className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${viewMode === 'week' ? 'bg-black/20 font-bold' : 'opacity-60'}`}>Week</button>
          </div>

          <div className="flex items-center gap-1.5">
            <button onClick={handlePrev} style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }} className="px-3 py-1.5 text-xs font-semibold border rounded-md cursor-pointer transition-colors">← Prev</button>
            <button onClick={handleNext} style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }} className="px-3 py-1.5 text-xs font-semibold border rounded-md cursor-pointer transition-colors">Next →</button>
          </div>
        </div>
      </header>

      {/* GLOBAL LOADING / ERROR ALERTS */}
      {isLoading && (
        <div style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }} className="absolute top-20 left-1/2 -translate-x-1/2 z-40 backdrop-blur border px-6 py-3 rounded-full shadow-lg flex items-center gap-3 text-sm font-semibold">
          <span className="w-4 h-4 border-2 border-[var(--theme-primary)] border-t-transparent rounded-full animate-spin" />
          Syncing Notion Data...
        </div>
      )}
      {fetchError && !isLoading && (
        <div className="mb-4 p-3 shrink-0 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex justify-between items-center">
          <span>⚠️ {fetchError}</span>
          <button onClick={() => fetchLogsFromNotion(notionToken, databaseId, specialDaysDatabaseId)} className="underline font-bold">Retry</button>
        </div>
      )}

      {/* MAIN WORKSPACE SPLIT */}
      <div className="flex-1 flex min-h-0 min-w-0 gap-6">
        
        {/* SIDEBAR WITH DRAG RESIZE */}
        {isSidebarOpen && (
          <aside 
            style={{ width: `${sidebarWidth}px`, borderRadius: `${cardRadius}px`, backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}
            className="shrink-0 h-full flex flex-col p-4 rounded-xl border shadow-sm relative"
          >
            {/* SIDEBAR RESIZE HANDLE */}
            <div 
              onMouseDown={handleMouseDownSidebarResize}
              className="absolute top-0 right-0 w-2.5 h-full cursor-col-resize z-30 group flex items-center justify-center"
              title="Click & Drag to resize sidebar width"
            >
              <div className="w-0.5 h-8 rounded-full bg-[var(--theme-border)] group-hover:bg-[var(--theme-primary)] transition-colors" />
            </div>

            <div className="mb-3 shrink-0">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-bold">Categories</h2>
                
                <button
                  onClick={() => { setSettingsTab('palette'); setShowSettings(true); }}
                  title="Customize Project & Category Colors"
                  className="p-1 rounded cursor-pointer transition-transform hover:scale-110 opacity-80 hover:opacity-100"
                  style={{ color: 'var(--theme-primary)' }}
                >
                  <IconPalette />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 pb-2 border-b" style={{ borderColor: 'var(--theme-border)' }}>
                <button onClick={handleExpandAllCategories} style={{ backgroundColor: 'var(--theme-bg)' }} className="text-[10px] font-bold px-2 py-1 rounded cursor-pointer transition-colors opacity-70 hover:opacity-100">Expand All</button>
                <button onClick={handleCollapseAllCategories} style={{ backgroundColor: 'var(--theme-bg)' }} className="text-[10px] font-bold px-2 py-1 rounded cursor-pointer transition-colors opacity-70 hover:opacity-100">Collapse All</button>
                <button onClick={handleShowAllFilters} style={{ color: 'var(--theme-primary)', backgroundColor: 'var(--theme-bg)' }} className="text-[10px] font-bold px-2 py-1 rounded cursor-pointer ml-auto transition-colors">Show All</button>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto pr-1 space-y-3 min-h-0">
              {Object.entries(groupedProjects).map(([type, projs]) => {
                const isHidden = collapsedTypes[type] === true;
                const baseTypeHex = customCategoryColors[type] || (
                  projs[0]?.projectTypeColor && NOTION_COLOR_MAP[projs[0].projectTypeColor] 
                    ? NOTION_COLOR_MAP[projs[0].projectTypeColor] 
                    : (themeTokens?.colour?.dot?.[type]?.$value?.hex || currentThemeColors.primary)
                );
                const categoryBorderColor = adjustHexColor(baseTypeHex, 40);

                return (
                  <div key={type} className="border rounded-md overflow-hidden shrink-0 shadow-sm" style={{ borderColor: categoryBorderColor, backgroundColor: 'var(--theme-card)' }}>
                    <div onClick={() => toggleTypeAccordion(type)} className="text-[10px] font-bold uppercase tracking-wider p-2.5 flex items-center justify-between cursor-pointer transition-colors hover:opacity-80">
                      <span className="tracking-wide font-black" style={{ fontSize: `${Math.round(10 * scaleFactor)}px` }}>{type}</span>
                      <span className="text-[9px] font-mono opacity-60">{isHidden ? '▼' : '▲'}</span>
                    </div>
                    {!isHidden && (
                      <div className="p-2 pt-0 space-y-1.5 border-t" style={{ borderColor: categoryBorderColor, backgroundColor: 'var(--theme-card)' }}>
                        {projs.map((p, i) => {
                          const isSelected = selectedProjectFilters.includes(p.title);
                          const dynamicFilterActive = selectedProjectFilters.length > 0;
                          const isHovered = hoveredProjectTitle === p.title;
                          const projectDotHex = projectColorMap[p.title] || baseTypeHex;

                          return (
                            <div 
                              key={i} 
                              onClick={() => toggleProjectFilter(p.title)} 
                              onMouseEnter={() => setHoveredProjectTitle(p.title)} 
                              onMouseLeave={() => setHoveredProjectTitle(null)} 
                              style={{ 
                                backgroundColor: 'var(--theme-bg)',
                                borderColor: isHovered || isSelected ? 'var(--theme-secondary)' : 'var(--theme-border)',
                                opacity: dynamicFilterActive && !isSelected && !isHovered ? 0.35 : 1,
                                fontSize: `${Math.round(12 * scaleFactor)}px`
                              }}
                              className={`p-2.5 rounded border transition-all cursor-pointer flex items-center gap-2 ${
                                isHovered ? 'ring-1 ring-[var(--theme-secondary)] scale-[1.02] font-bold z-10 relative' : ''
                              }`}
                            >
                              <span className="w-2.5 h-2.5 rounded-full shrink-0 border border-white/20 shadow-sm" style={{ backgroundColor: projectDotHex }} />
                              <span className="truncate">{p.title}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </aside>
        )}

        {/* CALENDAR CANVAS */}
        <main 
          ref={calendarRef} 
          style={{ borderRadius: `${cardRadius}px`, backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}
          className="flex-1 h-full min-h-0 min-w-0 border rounded-xl shadow-sm p-4 overflow-hidden flex flex-col relative transition-colors"
        >
          
          {/* A. MONTH VIEW */}
          {viewMode === 'month' && (
            <div className="flex flex-col h-full w-full min-h-0">
              <div className="flex items-center gap-2 mb-2 shrink-0">
                <div className="w-5 shrink-0" />
                <div className="grid w-full flex-1 text-center font-semibold uppercase tracking-wider" style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: `${gap}px`, fontSize: `${Math.round(12 * scaleFactor)}px` }}>
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => (
                    <div key={day} className={idx === 0 || idx === 6 ? 'font-bold' : 'opacity-60'} style={{ color: idx === 0 || idx === 6 ? 'var(--theme-primary)' : undefined }}>{day}</div>
                  ))}
                </div>
              </div>

              <div className="flex flex-col flex-1 min-h-0" style={{ gap: `${gap}px` }}>
                {rows.map((rowSlots, rowIndex) => (
                  <div key={rowIndex} className="flex-1 flex items-stretch gap-2 min-h-0">
                    <button
                      onClick={() => { const targetSlot = rowSlots.find(s => s.isValid && s.dateObj) || rowSlots[0]; if (targetSlot && targetSlot.dateObj) { setCurrentDate(targetSlot.dateObj); setViewMode('week'); } }}
                      title="Open Weekly View"
                      style={{ backgroundColor: 'var(--theme-bg)', borderColor: 'var(--theme-border)' }}
                      className="w-5 shrink-0 rounded-md transition-all flex items-center justify-center cursor-pointer group border shadow-sm hover:border-[var(--theme-primary)]"
                    >
                      <span className="text-[10px] font-bold group-hover:scale-125 transition-transform">›</span>
                    </button>
                    <div className="grid w-full flex-1 min-w-0 h-full" style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: `${gap}px` }}>
                      {rowSlots.map((slot, slotIndex) => {
                        if (!slot.isValid) return <div key={slotIndex} className="h-full w-full opacity-5 rounded-md" style={{ backgroundColor: 'var(--theme-bg)' }} />;
                        const logs = getLogsForDate(slot.dateObj);
                        const hasLog = logs.length > 0;
                        const uniqueProjects = new Set(logs.map(l => l.Projects || 'Untitled Project'));
                        const hasMultipleProjects = uniqueProjects.size > 1;
                        const { primaryLog, isHalftoned } = getThumbnailLogForDate(slot.dateObj, logs);
                        const displayDotHex = getDisplayDotColor(logs, slot.dateObj);
                        const specialDay = getSpecialDayForDate(slot.dateObj, specialDays);
                        const dotStyle = getDayDotStyling(slot.dateObj, hasLog, displayDotHex, specialDay);
                        
                        const isHoveredProject = hasLog && logs.some(l => (l.Projects || 'Untitled Project') === hoveredProjectTitle);
                        const isUnrelatedHover = hoveredProjectTitle && !isHoveredProject;

                        return (
                          <div 
                            key={slotIndex} 
                            onClick={() => slot.dateObj && setSelectedLogModal({ dateObj: slot.dateObj, logs })}
                            onMouseEnter={() => { if (hasLog && primaryLog) setHoveredProjectTitle(primaryLog.Projects || 'Untitled Project'); }}
                            onMouseLeave={() => setHoveredProjectTitle(null)}
                            style={{ 
                              borderRadius: `${cardRadius}px`,
                              backgroundColor: 'var(--theme-bg)',
                              borderColor: isHoveredProject ? 'var(--theme-secondary)' : 'var(--theme-border)'
                            }}
                            className={`h-full w-full relative overflow-hidden p-2 border cursor-pointer flex flex-col justify-end transition-all shadow-sm ${
                              isHoveredProject ? 'ring-2 ring-[var(--theme-secondary)] shadow-md scale-[1.02] z-20' : isToday(slot.dateObj) ? 'ring-2 ring-[var(--theme-primary)] ring-offset-1 z-10' : ''
                            }`}
                          >
                            {hasLog && primaryLog?.imageUrl && (
                              <img 
                                src={primaryLog.imageUrl} 
                                className={`absolute inset-0 w-full h-full object-cover z-0 transition-opacity duration-200 ${isHalftoned ? 'opacity-40 grayscale-[20%]' : ''}`} 
                                alt="" 
                              />
                            )}

                            <div className="absolute top-2 left-2 right-2 flex items-center gap-1.5 z-10 pointer-events-none">
                              <div 
                                className={`rounded-full flex items-center justify-center font-bold shadow-sm border transition-opacity duration-200 pointer-events-auto relative shrink-0 ${
                                  isToday(slot.dateObj) ? 'ring-2 ring-[var(--theme-primary)] text-white' : ''
                                } ${isUnrelatedHover ? 'opacity-40 grayscale-[50%]' : ''}`} 
                                style={{ 
                                  width: `${monthDotPx}px`,
                                  height: `${monthDotPx}px`,
                                  fontSize: `${monthDotFontPx}px`,
                                  backgroundColor: isToday(slot.dateObj) ? 'var(--theme-primary)' : dotStyle.bg,
                                  color: isToday(slot.dateObj) ? '#FFFFFF' : dotStyle.text,
                                  borderColor: dotStyle.border
                                }}
                              >
                                {slot.dayNum}
                                {hasMultipleProjects && (
                                  <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full text-white text-[7px] font-black flex items-center justify-center leading-none p-0 border border-white shadow-sm select-none" style={{ backgroundColor: 'var(--theme-secondary)' }}>
                                    +
                                  </span>
                                )}
                              </div>
                              {hasLog && primaryLog && (
                                <span 
                                  className={`inline-flex items-center font-bold text-white px-2.5 py-0.5 rounded-full backdrop-blur-sm truncate max-w-[calc(100%-2rem)] leading-none shadow-xs transition-opacity duration-200 pointer-events-auto ${isUnrelatedHover ? 'opacity-40 grayscale-[50%]' : ''}`}
                                  style={{ backgroundColor: displayDotHex, fontSize: `${projectTagFontPx}px` }}
                                >
                                  {primaryLog.Projects}
                                </span>
                              )}
                            </div>

                            {hasLog && primaryLog && (
                              <div 
                                className={`relative z-10 font-bold text-white bg-black/40 p-1.5 rounded-sm backdrop-blur-sm line-clamp-2 leading-tight transition-opacity duration-200 ${isUnrelatedHover ? 'opacity-40 grayscale-[50%]' : ''}`}
                                style={{ fontSize: `${cardTitleFontPx}px` }}
                              >
                                {primaryLog.title}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* B. WEEK VIEW */}
          {viewMode === 'week' && (
            <div className="flex flex-col h-full w-full min-h-0 relative">
              <div className="grid text-center text-xs font-semibold uppercase tracking-wider mb-2 shrink-0" style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: `${gap}px` }}>
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => (
                  <div key={day} className={idx === 0 || idx === 6 ? 'font-bold' : 'opacity-60'} style={{ color: idx === 0 || idx === 6 ? 'var(--theme-primary)' : undefined }}>{day}</div>
                ))}
              </div>
              
              <div className="grid flex-1 min-h-0 relative" style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: `${gap}px` }}>
                <div 
                  onMouseDown={handleMouseDownResize}
                  className={`group/handle absolute left-0 right-0 z-30 h-6 -translate-y-1/2 flex items-center justify-between cursor-ns-resize pointer-events-auto transition-opacity duration-150 ${
                    isResizingCardHeight ? 'opacity-100' : 'opacity-0 hover:opacity-100'
                  }`}
                  style={{ top: `${weekCardHeight + 55}px` }}
                  title="Click & Drag down/up to scale entry card aspect ratio"
                >
                  <div className="pl-0.5 flex items-center pointer-events-none">
                    <svg className="w-2.5 h-3 drop-shadow-xs" style={{ fill: 'var(--theme-primary)' }} viewBox="0 0 8 10">
                      <polygon points="0,0 8,5 0,10" />
                    </svg>
                  </div>

                  <div className={`flex-1 h-[2px] mx-1 transition-all flex items-center justify-center ${
                    isResizingCardHeight ? 'shadow-md' : ''
                  }`} style={{ backgroundColor: 'var(--theme-primary)' }}>
                    <div className="text-white text-[9px] font-black px-3 py-0.5 rounded-full shadow-lg flex items-center gap-1.5 transition-transform" style={{ backgroundColor: 'var(--theme-primary)' }}>
                      <span>↕ PULL TO RESIZE</span>
                      <span className="font-mono">({Math.round(weekCardHeight)}px)</span>
                    </div>
                  </div>

                  <div className="pr-0.5 flex items-center pointer-events-none">
                    <svg className="w-2.5 h-3 drop-shadow-xs" style={{ fill: 'var(--theme-primary)' }} viewBox="0 0 8 10">
                      <polygon points="8,0 0,5 8,10" />
                    </svg>
                  </div>
                </div>

                {slots.map((slot, index) => {
                  const logs = getLogsForDate(slot.dateObj);
                  const displayDotHex = getDisplayDotColor(logs, slot.dateObj);
                  const specialDay = getSpecialDayForDate(slot.dateObj, specialDays);

                  return (
                    <WeekDayColumn 
                      key={index}
                      slot={slot}
                      logs={logs}
                      isTodayDate={isToday(slot.dateObj)}
                      displayDotHex={displayDotHex}
                      weekCardHeight={weekCardHeight}
                      cardRadius={cardRadius}
                      hoveredProjectTitle={hoveredProjectTitle}
                      setHoveredProjectTitle={setHoveredProjectTitle}
                      setSelectedLogModal={setSelectedLogModal}
                      getDotColor={getDotColor}
                      scaleFactor={scaleFactor}
                      specialDay={specialDay}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* C. YEAR VIEW */}
          {viewMode === 'year' && (
            <div className="flex flex-col h-full w-full min-w-0 min-h-0 relative">
              <div className="absolute top-0 right-0 z-50 flex items-center border shadow-sm rounded-md p-1 text-[10px] font-bold" style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}>
                <button 
                  onClick={() => setYearOrientationMode('auto')}
                  className={`px-2 py-1 rounded-sm transition-colors ${yearOrientationMode === 'auto' ? 'bg-black/20 font-bold' : 'opacity-60'}`}
                  title="Auto Switch based on container width vs height"
                >
                  AUTO
                </button>
                <div className="w-px h-3 mx-1" style={{ backgroundColor: 'var(--theme-border)' }}></div>
                <button 
                  onClick={() => setYearOrientationMode('landscape')}
                  className={`px-2 py-1 rounded-sm transition-colors ${yearOrientationMode === 'landscape' ? 'bg-black/20 font-bold' : 'opacity-60'}`}
                  title="Force Landscape (Months on Y-Axis)"
                >
                  ↔
                </button>
                <button 
                  onClick={() => setYearOrientationMode('portrait')}
                  className={`px-2 py-1 rounded-sm transition-colors ${yearOrientationMode === 'portrait' ? 'bg-black/20 font-bold' : 'opacity-60'}`}
                  title="Force Portrait (Months on X-Axis)"
                >
                  ↕
                </button>
              </div>

              {activeYearOrientation === 'portrait' ? (
                /* --- PORTRAIT LAYOUT --- */
                <div className="flex flex-col h-full w-full min-w-0 min-h-0 mt-8 relative">
                  <div className="grid grid-cols-[30px_repeat(12,minmax(0,1fr))] sm:grid-cols-[40px_repeat(12,minmax(0,1fr))] items-center mb-2 border-b pb-2 shrink-0" style={{ borderColor: 'var(--theme-border)' }}>
                    <div className="text-[9px] font-bold uppercase tracking-wider opacity-50 text-center">Day</div>
                    {MONTH_NAMES.map((monthLabel, mIdx) => (
                      <div
                        key={monthLabel}
                        onClick={() => { setCurrentDate(new Date(year, mIdx, 1)); setViewMode('month'); }}
                        onMouseEnter={() => setHoveredMonthButtonIndex(mIdx)}
                        onMouseLeave={() => setHoveredMonthButtonIndex(null)}
                        style={{ backgroundColor: hoveredMonthButtonIndex === mIdx ? 'var(--theme-primary-10, rgba(244, 63, 94, 0.15))' : 'var(--theme-bg)', borderColor: hoveredMonthButtonIndex === mIdx ? 'var(--theme-primary)' : 'var(--theme-border)' }}
                        className="text-[10px] sm:text-[11px] font-bold text-center tracking-wide py-1 mx-1 rounded border transition-all cursor-pointer"
                      >
                        {monthLabel}
                      </div>
                    ))}
                  </div>
                  
                  <div className="flex-1 flex flex-col justify-between min-h-0 min-w-0 relative">
                    <div className="absolute inset-0 grid grid-cols-[30px_repeat(12,minmax(0,1fr))] sm:grid-cols-[40px_repeat(12,minmax(0,1fr))] pointer-events-none z-0">
                      <div />
                      {MONTH_NAMES.map((_, mIdx) => (
                        <div key={mIdx} className={`relative h-full flex justify-center transition-colors ${hoveredMonthButtonIndex === mIdx ? 'bg-[var(--theme-primary)]/10 rounded-lg' : ''}`}>
                          <div className="absolute top-0 bottom-0 w-[1.5px]" style={{ backgroundColor: 'var(--theme-border)' }} />
                        </div>
                      ))}
                    </div>

                    {Array.from({ length: 37 }).map((_, rowIndex) => {
                      const weekdayStr = TIMELINE_WEEKDAYS[rowIndex % 7];
                      const isWeekendRow = weekdayStr === 'SUN' || weekdayStr === 'SAT';
                      const weekIndex = Math.floor(rowIndex / 7);
                      const isStartOfWeek = rowIndex % 7 === 0;
                      const isEndOfWeek = rowIndex % 7 === 6 || rowIndex === 36;
                      
                      return (
                        <div key={rowIndex} className="flex-1 grid grid-cols-[30px_repeat(12,minmax(0,1fr))] sm:grid-cols-[40px_repeat(12,minmax(0,1fr))] items-center min-h-0 border-b border-dashed last:border-0 relative z-10" style={{ borderColor: 'var(--theme-border)' }}>
                          <div className="h-full flex items-center justify-center">
                             <div className={`w-full text-[8px] sm:text-[9px] font-black tracking-tight py-0.5 text-center rounded ${isWeekendRow ? 'font-bold' : 'opacity-40'}`} style={{ color: isWeekendRow ? 'var(--theme-primary)' : undefined }}>
                               {weekdayStr.slice(0, 2)}
                             </div>
                          </div>

                          {MONTH_NAMES.map((_, mIdx) => {
                            const firstDayOfMonthObj = new Date(year, mIdx, 1);
                            const startOffsetColumn = firstDayOfMonthObj.getDay();
                            const daysInMonth = new Date(year, mIdx + 1, 0).getDate();
                            const targetDayNum = rowIndex - startOffsetColumn + 1;
                            const isValidCalendarDay = targetDayNum > 0 && targetDayNum <= daysInMonth;

                            const isHoveredWeekCell = hoveredWeek?.mIdx === mIdx && hoveredWeek?.weekIndex === weekIndex;

                            let weekHighlightStyle = '';
                            if (isHoveredWeekCell) {
                              const bgStyle = 'bg-amber-500/20 border-amber-500 z-20';
                              weekHighlightStyle = isStartOfWeek
                                ? `${bgStyle} border-x border-t rounded-t-full`
                                : isEndOfWeek
                                ? `${bgStyle} border-x border-b rounded-b-full`
                                : `${bgStyle} border-x border-y-0`;
                            }

                            if (!isValidCalendarDay) {
                              return <div key={mIdx} onClick={() => handleWeekClick(mIdx, weekIndex)} onMouseEnter={() => setHoveredWeek({ mIdx, weekIndex })} onMouseLeave={() => setHoveredWeek(null)} className={`h-full w-full flex items-center justify-center transition-colors cursor-pointer py-1 px-0.5 ${weekHighlightStyle}`} />;
                            }

                            const targetDate = new Date(year, mIdx, targetDayNum);
                            const logs = getLogsForDate(targetDate);
                            const hasLog = logs.length > 0;
                            const uniqueProjects = new Set(logs.map(l => l.Projects || 'Untitled Project'));
                            const hasMultipleProjects = uniqueProjects.size > 1;
                            const primaryLog = hasLog ? logs[0] : null;
                            const displayDotHex = getDisplayDotColor(logs, targetDate);
                            const specialDay = getSpecialDayForDate(targetDate, specialDays);
                            const dotStyle = getDayDotStyling(targetDate, hasLog, displayDotHex, specialDay);
                            const isSpecialDay = !!(getOntarioStatHolidayName(targetDate) || targetDate.getDay() === 0 || targetDate.getDay() === 6 || specialDay);
                            
                            const isHoveredProject = hasLog && logs.some(l => (l.Projects || 'Untitled Project') === hoveredProjectTitle);
                            const isUnrelatedHover = hoveredProjectTitle && !isHoveredProject;

                            return (
                              <div key={mIdx} onClick={() => handleWeekClick(mIdx, weekIndex)} onMouseEnter={() => { setHoveredWeek({ mIdx, weekIndex }); if (hasLog && primaryLog) setHoveredProjectTitle(primaryLog.Projects || 'Untitled Project'); }} onMouseLeave={() => { setHoveredWeek(null); setHoveredProjectTitle(null); }} className={`h-full w-full flex items-center justify-center relative cursor-pointer group/node transition-colors py-1 px-0.5 ${weekHighlightStyle}`}>
                                <div 
                                  onClick={(e) => { e.stopPropagation(); setSelectedLogModal({ dateObj: targetDate, logs }); }} 
                                  style={{ 
                                    width: `${yearDotPx}px`,
                                    height: `${yearDotPx}px`,
                                    fontSize: `${yearDotFontPx}px`,
                                    backgroundColor: dotStyle.bg,
                                    color: dotStyle.text,
                                    borderColor: dotStyle.border 
                                  }}
                                  className={`rounded-full flex items-center justify-center transition-all duration-200 relative z-20 border bg-[var(--theme-card)] ${
                                    hasLog || isSpecialDay ? 'font-bold shadow-xs' : ''
                                  } ${hasLog ? 'scale-110' : ''} ${isHoveredProject ? 'ring-2 ring-[var(--theme-secondary)] ring-offset-1 font-bold z-30 scale-125' : isToday(targetDate) ? 'ring-2 ring-[var(--theme-primary)] ring-offset-1 font-bold' : ''} ${isUnrelatedHover ? 'opacity-40 grayscale-[50%]' : ''}`}
                                >
                                  {targetDayNum}
                                  {hasMultipleProjects && (
                                    <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full text-white text-[6px] font-black flex items-center justify-center leading-none p-0 border border-white/80 shadow-xs select-none" style={{ backgroundColor: 'var(--theme-secondary)' }}>
                                      +
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                /* --- LANDSCAPE LAYOUT --- */
                <div className="flex flex-col h-full w-full min-w-0 min-h-0 mt-8">
                  <div className="grid grid-cols-[50px_1fr] sm:grid-cols-[65px_1fr] items-center mb-2 border-b pb-2 shrink-0" style={{ borderColor: 'var(--theme-border)' }}>
                    <div className="text-[9px] font-bold uppercase tracking-wider opacity-50 text-center">Month</div>
                    <div className="grid gap-0 text-center min-w-0" style={{ gridTemplateColumns: 'repeat(37, minmax(0, 1fr))' }}>
                      {Array.from({ length: 37 }).map((_, colIndex) => {
                        const weekdayStr = TIMELINE_WEEKDAYS[colIndex % 7];
                        const isWeekend = weekdayStr === 'SUN' || weekdayStr === 'SAT';
                        return <div key={colIndex} className={`text-[8px] sm:text-[9px] font-black tracking-tight py-1 ${isWeekend ? 'font-bold' : 'opacity-40'}`} style={{ color: isWeekend ? 'var(--theme-primary)' : undefined }}>{weekdayStr.slice(0, 2)}</div>;
                      })}
                    </div>
                  </div>
                  
                  <div className="flex-1 flex flex-col justify-between min-h-0 min-w-0">
                    {MONTH_NAMES.map((monthLabel, mIdx) => {
                      const firstDayOfMonthObj = new Date(year, mIdx, 1);
                      const startOffsetColumn = firstDayOfMonthObj.getDay(); 
                      const daysInMonth = new Date(year, mIdx + 1, 0).getDate();
                      const isMonthHovered = hoveredMonthButtonIndex === mIdx;

                      return (
                        <div 
                          key={monthLabel} 
                          style={{ 
                            backgroundColor: isMonthHovered ? 'var(--theme-primary-10, rgba(244, 63, 94, 0.12))' : undefined,
                            borderColor: isMonthHovered ? 'var(--theme-primary)' : 'var(--theme-border)'
                          }}
                          className={`grid grid-cols-[50px_1fr] sm:grid-cols-[65px_1fr] items-center h-full min-h-0 min-w-0 relative rounded-lg transition-all border ${
                            isMonthHovered ? 'ring-1 ring-[var(--theme-primary)] shadow-xs' : 'border-dashed border-x-0 border-t-0'
                          }`}
                        >
                          {/* MONTH BUTTON ON LEFT TRIGGER */}
                          <div 
                            onClick={() => { setCurrentDate(new Date(year, mIdx, 1)); setViewMode('month'); }} 
                            onMouseEnter={() => setHoveredMonthButtonIndex(mIdx)}
                            onMouseLeave={() => setHoveredMonthButtonIndex(null)}
                            style={{ backgroundColor: 'var(--theme-bg)', borderColor: 'var(--theme-border)' }} 
                            className="text-[10px] sm:text-[11px] font-bold text-center tracking-wide py-1 mx-1 rounded border transition-all cursor-pointer hover:border-[var(--theme-primary)] z-30"
                          >
                            {monthLabel}
                          </div>
                          
                          <div className="grid items-center relative h-full min-w-0" style={{ gridTemplateColumns: 'repeat(37, minmax(0, 1fr))' }}>
                            <div className="absolute left-2 right-2 top-1/2 -translate-y-1/2 h-[1.5px] z-0 pointer-events-none" style={{ backgroundColor: 'var(--theme-border)' }} />

                            {Array.from({ length: 37 }).map((_, colIndex) => {
                              const weekIndex = Math.floor(colIndex / 7);
                              const isHoveredWeekCell = hoveredWeek?.mIdx === mIdx && hoveredWeek?.weekIndex === weekIndex;
                              const targetDayNum = colIndex - startOffsetColumn + 1;
                              const isValidCalendarDay = targetDayNum > 0 && targetDayNum <= daysInMonth;

                              const isStartOfWeek = colIndex % 7 === 0;
                              const isEndOfWeek = colIndex % 7 === 6 || colIndex === 36;

                              let weekHighlightStyle = '';
                              if (isHoveredWeekCell) {
                                const bgStyle = 'bg-amber-500/20 border-amber-500 z-20';
                                weekHighlightStyle = isStartOfWeek
                                  ? `${bgStyle} border-y border-l rounded-l-full`
                                  : isEndOfWeek
                                  ? `${bgStyle} border-y border-r rounded-r-full`
                                  : `${bgStyle} border-y border-x-0`;
                              }

                              if (!isValidCalendarDay) {
                                return <div key={colIndex} onClick={() => handleWeekClick(mIdx, weekIndex)} onMouseEnter={() => setHoveredWeek({ mIdx, weekIndex })} onMouseLeave={() => setHoveredWeek(null)} className={`h-full flex items-center justify-center transition-colors cursor-pointer py-1 px-0.5 ${weekHighlightStyle}`} />;
                              }
                              
                              const targetDate = new Date(year, mIdx, targetDayNum);
                              const logs = getLogsForDate(targetDate);
                              const hasLog = logs.length > 0;
                              const uniqueProjects = new Set(logs.map(l => l.Projects || 'Untitled Project'));
                              const hasMultipleProjects = uniqueProjects.size > 1;
                              const primaryLog = hasLog ? logs[0] : null;
                              const displayDotHex = getDisplayDotColor(logs, targetDate);
                              const specialDay = getSpecialDayForDate(targetDate, specialDays);
                              const dotStyle = getDayDotStyling(targetDate, hasLog, displayDotHex, specialDay);
                              const isSpecialDay = !!(getOntarioStatHolidayName(targetDate) || targetDate.getDay() === 0 || targetDate.getDay() === 6 || specialDay);
                              
                              const isHoveredProject = hasLog && logs.some(l => (l.Projects || 'Untitled Project') === hoveredProjectTitle);
                              const isUnrelatedHover = hoveredProjectTitle && !isHoveredProject;
                              
                              return (
                                <div key={colIndex} onClick={() => handleWeekClick(mIdx, weekIndex)} onMouseEnter={() => { setHoveredWeek({ mIdx, weekIndex }); if (hasLog && primaryLog) setHoveredProjectTitle(primaryLog.Projects || 'Untitled Project'); }} onMouseLeave={() => { setHoveredWeek(null); setHoveredProjectTitle(null); }} className={`h-full flex items-center justify-center relative cursor-pointer group/node transition-colors py-1 px-0.5 ${weekHighlightStyle}`}>
                                  <div 
                                    onClick={(e) => { e.stopPropagation(); setSelectedLogModal({ dateObj: targetDate, logs }); }} 
                                    style={{ 
                                      width: `${yearDotPx}px`,
                                      height: `${yearDotPx}px`,
                                      fontSize: `${yearDotFontPx}px`,
                                      backgroundColor: dotStyle.bg,
                                      color: dotStyle.text,
                                      borderColor: dotStyle.border 
                                    }}
                                    className={`rounded-full flex items-center justify-center transition-all duration-200 relative z-20 border bg-[var(--theme-card)] ${
                                      hasLog || isSpecialDay ? 'font-bold shadow-xs' : ''
                                    } ${hasLog ? 'scale-110' : ''} ${isHoveredProject ? 'ring-2 ring-[var(--theme-secondary)] ring-offset-1 font-bold z-30 scale-125' : isToday(targetDate) ? 'ring-2 ring-[var(--theme-primary)] ring-offset-1 font-bold' : ''} ${isUnrelatedHover ? 'opacity-40 grayscale-[50%]' : ''}`}
                                  >
                                    {targetDayNum}
                                    {hasMultipleProjects && (
                                      <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full text-white text-[6px] font-black flex items-center justify-center leading-none p-0 border border-white/80 shadow-xs select-none" style={{ backgroundColor: 'var(--theme-secondary)' }}>
                                        +
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* SETTINGS MODAL */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm">
          <div 
            style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)', color: 'var(--theme-text)' }}
            className="w-full max-w-lg rounded-xl shadow-2xl border p-6 flex flex-col gap-4 max-h-[90vh] overflow-hidden"
          >
            {/* Tab Header - Vector Icons */}
            <div className="flex items-center justify-between border-b pb-3 shrink-0" style={{ borderColor: 'var(--theme-border)' }}>
              <div className="flex items-center gap-1.5 flex-wrap">
                <button 
                  onClick={() => setSettingsTab('notion')} 
                  className={`text-xs font-bold px-3 py-1.5 rounded-md cursor-pointer transition-all flex items-center gap-1.5 ${
                    settingsTab === 'notion' ? 'bg-black/20 font-bold' : 'opacity-60 hover:opacity-100'
                  }`}
                >
                  <IconLink />
                  <span>Notion Sync</span>
                </button>

                <button 
                  onClick={() => setSettingsTab('theme')} 
                  className={`text-xs font-bold px-3 py-1.5 rounded-md cursor-pointer transition-all flex items-center gap-1.5 ${
                    settingsTab === 'theme' ? 'bg-black/20 font-bold' : 'opacity-60 hover:opacity-100'
                  }`}
                >
                  <IconTheme />
                  <span>Themes</span>
                </button>

                <button 
                  onClick={() => setSettingsTab('scale')} 
                  className={`text-xs font-bold px-3 py-1.5 rounded-md cursor-pointer transition-all flex items-center gap-1.5 ${
                    settingsTab === 'scale' ? 'bg-black/20 font-bold' : 'opacity-60 hover:opacity-100'
                  }`}
                >
                  <IconScale />
                  <span>View Scale</span>
                </button>

                <button 
                  onClick={() => setSettingsTab('palette')} 
                  className={`text-xs font-bold px-3 py-1.5 rounded-md cursor-pointer transition-all flex items-center gap-1.5 ${
                    settingsTab === 'palette' ? 'bg-black/20 font-bold' : 'opacity-60 hover:opacity-100'
                  }`}
                >
                  <IconPalette />
                  <span>Project Palette</span>
                </button>
              </div>
              <button onClick={() => setShowSettings(false)} className="opacity-60 hover:opacity-100 p-1 cursor-pointer">
                <IconClose />
              </button>
            </div>

            {/* TAB 1: NOTION SYNC */}
            {settingsTab === 'notion' && (
              <div className="flex-1 overflow-y-auto pr-1 space-y-4 min-h-0">
                <div>
                  <label className="block text-xs font-bold mb-1">Notion Integration Token</label>
                  <input 
                    type="password" 
                    value={notionToken} 
                    onChange={(e) => setNotionToken(e.target.value)} 
                    style={{ backgroundColor: 'var(--theme-bg)', borderColor: 'var(--theme-border)', color: 'var(--theme-text)' }}
                    className="w-full border rounded px-3 py-2 text-sm outline-none"
                    placeholder="secret_..."
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">Activity Log Database ID</label>
                  <input 
                    type="text" 
                    value={databaseId} 
                    onChange={(e) => setDatabaseId(e.target.value)} 
                    style={{ backgroundColor: 'var(--theme-bg)', borderColor: 'var(--theme-border)', color: 'var(--theme-text)' }}
                    className="w-full border rounded px-3 py-2 text-sm outline-none"
                    placeholder="3728d5a5..."
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">Special Days Database ID (Optional)</label>
                  <input 
                    type="text" 
                    value={specialDaysDatabaseId} 
                    onChange={(e) => setSpecialDaysDatabaseId(e.target.value)} 
                    style={{ backgroundColor: 'var(--theme-bg)', borderColor: 'var(--theme-border)', color: 'var(--theme-text)' }}
                    className="w-full border rounded px-3 py-2 text-sm outline-none"
                    placeholder="Optional ID for Birthdays/Vacations/Events..."
                  />
                </div>
              </div>
            )}

            {/* TAB 2: THEMES */}
            {settingsTab === 'theme' && (
              <div className="flex-1 overflow-y-auto pr-1 space-y-5 min-h-0">
                <div>
                  <label className="block text-xs font-bold mb-1.5">Active Preset / Theme</label>
                  <div className="flex items-center gap-2">
                    <select 
                      value={activeThemeId}
                      onChange={(e) => setActiveThemeId(e.target.value)}
                      style={{ backgroundColor: 'var(--theme-bg)', borderColor: 'var(--theme-border)', color: 'var(--theme-text)' }}
                      className="flex-1 border rounded px-3 py-2 text-xs font-bold outline-none cursor-pointer"
                    >
                      <optgroup label="Built-in Presets">
                        {DEFAULT_THEME_PRESETS.map(preset => (
                          <option key={preset.id} value={preset.id}>{preset.name}</option>
                        ))}
                      </optgroup>
                      {customThemes.length > 0 && (
                        <optgroup label="Custom User Themes">
                          {customThemes.map(ct => (
                            <option key={ct.id} value={ct.id}>{ct.name}</option>
                          ))}
                        </optgroup>
                      )}
                    </select>

                    <button 
                      onClick={() => handleDuplicateTheme(activeTheme)}
                      style={{ backgroundColor: 'var(--theme-primary)' }}
                      className="px-3 py-2 text-xs font-bold text-white rounded cursor-pointer shadow-xs hover:opacity-90 shrink-0 flex items-center gap-1"
                    >
                      <IconPlus />
                      <span>Duplicate</span>
                    </button>
                  </div>
                </div>

                {activeTheme.isCustom ? (
                  <div className="p-4 border rounded-lg space-y-4" style={{ borderColor: 'var(--theme-border)', backgroundColor: 'var(--theme-bg)' }}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1">
                        <label className="block text-[10px] font-bold uppercase opacity-60 mb-1">Theme Name</label>
                        <input 
                          type="text" 
                          value={activeTheme.name} 
                          onChange={(e) => handleUpdateCustomThemeName(e.target.value)}
                          style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)', color: 'var(--theme-text)' }}
                          className="w-full border rounded px-2.5 py-1.5 text-xs font-bold outline-none"
                        />
                      </div>
                      <button 
                        onClick={() => handleDeleteCustomTheme(activeTheme.id)}
                        className="text-xs font-bold text-rose-500 hover:underline px-2 py-1 mt-4 cursor-pointer"
                      >
                        Delete
                      </button>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <label className="block text-xs font-bold">Customize Color Palette</label>
                        <div className="flex items-center p-0.5 rounded border" style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}>
                          <button 
                            onClick={() => setThemeEditMode('dark')} 
                            className={`px-2.5 py-1 text-[10px] font-bold rounded flex items-center gap-1 ${themeEditMode === 'dark' ? 'bg-black/30' : 'opacity-50'}`}
                          >
                            <IconMoon />
                            <span>Dark</span>
                          </button>
                          <button 
                            onClick={() => setThemeEditMode('light')} 
                            className={`px-2.5 py-1 text-[10px] font-bold rounded flex items-center gap-1 ${themeEditMode === 'light' ? 'bg-black/30' : 'opacity-50'}`}
                          >
                            <IconSun />
                            <span>Light</span>
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        {[
                          { key: 'bg', label: 'Canvas Background' },
                          { key: 'card', label: 'Card Surface' },
                          { key: 'border', label: 'Border Color' },
                          { key: 'text', label: 'Text Color' },
                          { key: 'primary', label: 'Primary Accent' },
                          { key: 'secondary', label: 'Secondary Accent' },
                        ].map((token) => (
                          <div key={token.key} className="flex items-center justify-between p-2 border rounded" style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}>
                            <span className="text-[11px] font-medium truncate">{token.label}</span>
                            <input 
                              type="color" 
                              value={activeTheme[themeEditMode][token.key]} 
                              onChange={(e) => handleUpdateCustomThemeColor(themeEditMode, token.key, e.target.value)}
                              className="w-6 h-6 rounded border-0 cursor-pointer p-0 bg-transparent"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 border rounded text-xs opacity-70 italic text-center" style={{ borderColor: 'var(--theme-border)', backgroundColor: 'var(--theme-bg)' }}>
                    "{activeTheme.name}" is a read-only built-in preset. Click <strong>Duplicate</strong> above to create an editable copy.
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: VIEW SCALE & TEXT SIZE */}
            {settingsTab === 'scale' && (
              <div className="flex-1 overflow-y-auto pr-1 space-y-5 min-h-0">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-bold">Text Size & Baseline Component Scale</h3>
                    <p className="text-[11px] opacity-60">Controls default dimensions of day dots, tags, and text across all views.</p>
                  </div>
                  <button 
                    onClick={() => setViewScale(100)} 
                    className="text-[11px] font-bold px-2.5 py-1 rounded border hover:opacity-100 opacity-70 transition-opacity shrink-0 cursor-pointer flex items-center gap-1"
                    style={{ borderColor: 'var(--theme-border)', backgroundColor: 'var(--theme-bg)' }}
                  >
                    <IconReset />
                    <span>Reset to 100%</span>
                  </button>
                </div>

                <div className="p-4 border rounded-xl space-y-3 shadow-xs" style={{ borderColor: 'var(--theme-border)', backgroundColor: 'var(--theme-bg)' }}>
                  <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: 'var(--theme-border)' }}>
                    <span className="text-[10px] font-bold uppercase tracking-wider opacity-60">Live Baseline Preview ({viewScale}%)</span>
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded text-white" style={{ backgroundColor: 'var(--theme-primary)' }}>
                      Dot: {monthDotPx}px | Font: {cardTitleFontPx}px
                    </span>
                  </div>

                  <div className="flex items-center justify-around py-3 gap-4">
                    <div className="flex flex-col items-center gap-2">
                      <div className="flex items-center gap-2 p-2 rounded-lg border shadow-xs" style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}>
                        <div 
                          className="rounded-full flex items-center justify-center font-bold text-white shadow-sm border border-white/80 transition-all shrink-0" 
                          style={{ 
                            width: `${monthDotPx}px`, 
                            height: `${monthDotPx}px`, 
                            fontSize: `${monthDotFontPx}px`,
                            backgroundColor: 'var(--theme-primary)' 
                          }}
                        >
                          23
                        </div>
                        <span 
                          className="font-bold text-white px-2.5 py-0.5 rounded-full leading-none shadow-xs truncate max-w-[120px]" 
                          style={{ backgroundColor: 'var(--theme-primary)', fontSize: `${projectTagFontPx}px` }}
                        >
                          Creator's App
                        </span>
                      </div>
                      <span className="text-[9px] font-bold opacity-50 uppercase">Month / Week View</span>
                    </div>

                    <div className="w-px h-12" style={{ backgroundColor: 'var(--theme-border)' }} />

                    <div className="flex flex-col items-center gap-2">
                      <div className="p-3 rounded-lg border flex items-center justify-center shadow-xs" style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}>
                        <div 
                          className="rounded-full flex items-center justify-center font-bold text-white shadow-sm border border-white/80 transition-all" 
                          style={{ 
                            width: `${yearDotPx}px`, 
                            height: `${yearDotPx}px`, 
                            fontSize: `${yearDotFontPx}px`,
                            backgroundColor: 'var(--theme-secondary)' 
                          }}
                        >
                          23
                        </div>
                      </div>
                      <span className="text-[9px] font-bold opacity-50 uppercase">Year View Dot</span>
                    </div>
                  </div>
                </div>

                <div className="p-4 border rounded-lg space-y-3" style={{ borderColor: 'var(--theme-border)', backgroundColor: 'var(--theme-bg)' }}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold">Scale Factor</span>
                    <span className="text-xs font-mono font-bold px-2 py-0.5 rounded" style={{ backgroundColor: 'var(--theme-card)', color: 'var(--theme-primary)' }}>
                      {viewScale}%
                    </span>
                  </div>

                  <input 
                    type="range" 
                    min="75" 
                    max="135" 
                    step="5"
                    value={viewScale} 
                    onChange={(e) => setViewScale(Number(e.target.value))}
                    className="w-full cursor-pointer accent-[var(--theme-primary)]"
                  />

                  <div className="flex justify-between text-[10px] opacity-50 font-mono">
                    <span>75% (Compact)</span>
                    <span>100% (Default)</span>
                    <span>135% (Large)</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-bold opacity-80">Quick Scale Presets</label>
                  <div className="grid grid-cols-5 gap-2">
                    {[
                      { label: '85%', val: 85, name: 'Compact' },
                      { label: '100%', val: 100, name: 'Default' },
                      { label: '110%', val: 110, name: 'Medium' },
                      { label: '120%', val: 120, name: 'Large' },
                      { label: '130%', val: 130, name: 'X-Large' },
                    ].map((preset) => (
                      <button
                        key={preset.val}
                        onClick={() => setViewScale(preset.val)}
                        style={{ 
                          backgroundColor: viewScale === preset.val ? 'var(--theme-primary)' : 'var(--theme-bg)',
                          borderColor: viewScale === preset.val ? 'var(--theme-primary)' : 'var(--theme-border)',
                          color: viewScale === preset.val ? '#FFFFFF' : 'var(--theme-text)'
                        }}
                        className="py-2 rounded border text-center transition-all cursor-pointer hover:border-[var(--theme-primary)]"
                      >
                        <div className="text-xs font-bold">{preset.label}</div>
                        <div className="text-[9px] opacity-80">{preset.name}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 4: PROJECT PALETTE */}
            {settingsTab === 'palette' && (
              <div className="flex-1 overflow-y-auto pr-1 space-y-4 min-h-0">
                <div className="flex items-center justify-between">
                  <p className="text-xs opacity-70">Control colors by <strong>Category Hue</strong> or tweak individual <strong>Project</strong> dot values.</p>
                  <button 
                    onClick={handleResetDotColors} 
                    className="text-[11px] font-bold px-2.5 py-1 rounded border hover:opacity-100 opacity-70 transition-opacity shrink-0 cursor-pointer flex items-center gap-1"
                    style={{ borderColor: 'var(--theme-border)', backgroundColor: 'var(--theme-bg)' }}
                  >
                    <IconReset />
                    <span>Return to Default</span>
                  </button>
                </div>

                <div className="space-y-4">
                  {Object.entries(groupedProjects).map(([type, projs]) => {
                    const categoryCustomHex = customCategoryColors[type];
                    const defaultCategoryHex = projs[0]?.projectTypeColor && NOTION_COLOR_MAP[projs[0].projectTypeColor] 
                      ? NOTION_COLOR_MAP[projs[0].projectTypeColor] 
                      : (themeTokens?.colour?.dot?.[type]?.$value?.hex || currentThemeColors.primary);
                    const effectiveCategoryHex = categoryCustomHex || defaultCategoryHex;

                    return (
                      <div key={type} className="border rounded-lg p-3 space-y-2" style={{ borderColor: 'var(--theme-border)', backgroundColor: 'var(--theme-bg)' }}>
                        <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: 'var(--theme-border)' }}>
                          <div className="flex items-center gap-2">
                            <span className="w-3 h-3 rounded-full border border-white/20" style={{ backgroundColor: effectiveCategoryHex }} />
                            <span className="text-xs font-black uppercase tracking-wider">{type}</span>
                            {categoryCustomHex && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-500 border border-amber-500/30">Modified</span>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            {categoryCustomHex && (
                              <button onClick={() => handleResetCategoryColor(type)} className="text-[10px] text-rose-500 font-bold hover:underline cursor-pointer">Reset Category</button>
                            )}
                            <input 
                              type="color" 
                              value={effectiveCategoryHex} 
                              onChange={(e) => handleUpdateCategoryColor(type, e.target.value)}
                              className="w-6 h-6 rounded border-0 cursor-pointer p-0 bg-transparent"
                              title="Change Category Base Color (Updates child project shades)"
                            />
                          </div>
                        </div>

                        <div className="pl-2 space-y-1.5 pt-1">
                          {projs.map((p) => {
                            const projectCustomHex = customProjectColors[p.title];
                            const currentEffectiveHex = projectColorMap[p.title] || effectiveCategoryHex;

                            return (
                              <div key={p.title} className="flex items-center justify-between p-1.5 rounded border" style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}>
                                <div className="flex items-center gap-2 truncate pr-2">
                                  <span className="w-2.5 h-2.5 rounded-full shrink-0 border border-white/20" style={{ backgroundColor: currentEffectiveHex }} />
                                  <span className="text-xs font-medium truncate">{p.title}</span>
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                  {projectCustomHex && (
                                    <button onClick={() => handleResetProjectColor(p.title)} className="text-[9px] text-rose-500 font-bold hover:underline cursor-pointer">Reset</button>
                                  )}
                                  <input 
                                    type="color" 
                                    value={currentEffectiveHex} 
                                    onChange={(e) => handleUpdateProjectColor(p.title, e.target.value)}
                                    className="w-5 h-5 rounded border-0 cursor-pointer p-0 bg-transparent"
                                    title={`Tweak specific color value for ${p.title}`}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mt-2 flex items-center justify-end gap-3 border-t pt-3 shrink-0" style={{ borderColor: 'var(--theme-border)' }}>
              <button 
                onClick={() => setShowSettings(false)} 
                className="px-4 py-2 text-xs font-semibold cursor-pointer opacity-70 hover:opacity-100"
              >
                Close
              </button>
              {settingsTab === 'notion' && (
                <button 
                  onClick={handleSaveSettings} 
                  disabled={!notionToken || !databaseId}
                  style={{ backgroundColor: 'var(--theme-primary)' }}
                  className="px-4 py-2 text-xs font-bold text-white rounded hover:opacity-90 disabled:opacity-50 cursor-pointer shadow-sm"
                >
                  Save & Sync
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* DETAIL LOG MODAL */}
      {selectedLogModal && (() => {
        const dateKey = selectedLogModal.dateObj.toISOString().split('T')[0];
        const currentThumbId = thumbnailOverrides[dateKey] || (selectedLogModal.logs[0]?.id);
        const logs = selectedLogModal.logs;
        const specDay = getSpecialDayForDate(selectedLogModal.dateObj, specialDays);

        const scrollCarousel = (direction) => {
          if (!modalCarouselRef.current) return;
          const firstChild = modalCarouselRef.current.firstElementChild;
          const scrollAmount = firstChild ? firstChild.clientWidth + 24 : 450;
          modalCarouselRef.current.scrollBy({ left: direction === 'left' ? -scrollAmount : scrollAmount, behavior: 'smooth' });
        };

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 sm:p-8 bg-black/70 backdrop-blur-sm" onClick={() => setSelectedLogModal(null)}>
            <div 
              style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)', color: 'var(--theme-text)' }}
              className="w-[90%] max-w-[1300px] h-[85%] max-h-[850px] rounded-2xl flex flex-col overflow-hidden shadow-2xl border" 
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-6 py-4 border-b flex items-center justify-between shrink-0" style={{ borderColor: 'var(--theme-border)', backgroundColor: 'var(--theme-bg)' }}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold tracking-wider" style={{ color: 'var(--theme-primary)' }}>
                    {selectedLogModal.dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                  {getOntarioStatHolidayName(selectedLogModal.dateObj) && (
                    <span className="text-xs font-bold px-2 py-0.5 rounded-md flex items-center gap-1 shadow-xs border" style={{ color: 'var(--theme-secondary)', borderColor: 'var(--theme-secondary)', backgroundColor: 'var(--theme-card)' }}>
                      <span>—</span>
                      <span>{getOntarioStatHolidayName(selectedLogModal.dateObj)}</span>
                    </span>
                  )}
                  {specDay && (
                    <span className="text-xs font-bold px-2 py-0.5 rounded-md flex items-center gap-1 shadow-xs border" style={{ color: 'var(--theme-secondary)', borderColor: 'var(--theme-secondary)', backgroundColor: 'var(--theme-card)' }}>
                      <span>🎉</span>
                      <span>{specDay.name} ({specDay.occurrence})</span>
                    </span>
                  )}
                </div>
                <button onClick={() => setSelectedLogModal(null)} className="p-1 cursor-pointer opacity-60 hover:opacity-100">
                  <IconClose />
                </button>
              </div>
              
              <div className="relative flex-1 flex items-center overflow-hidden p-6 sm:p-8">
                {logs.length > 1 && (
                  <button 
                    onClick={() => scrollCarousel('left')}
                    style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}
                    className="absolute left-3 z-30 w-10 h-10 rounded-full flex items-center justify-center border shadow-md transition-all cursor-pointer hover:border-[var(--theme-primary)]"
                    title="Scroll Left"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                )}

                <div 
                  ref={modalCarouselRef} 
                  className="w-full h-full flex gap-6 overflow-x-auto scroll-smooth snap-x snap-mandatory items-stretch select-none"
                  style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                >
                  {logs.length > 0 ? (
                    logs.map((log) => {
                      const isThumbnail = log.id === currentThumbId;

                      const httpsUrl = log.url || `https://www.notion.so/${log.id.replace(/-/g, '')}`;
                      const desktopUrl = httpsUrl.replace('https://', 'notion://');
                      const notionPageUrl = desktopUrl.includes('?') ? `${desktopUrl}&pvs=4` : `${desktopUrl}?pvs=4`;

                      return (
                        <div 
                          key={log.id} 
                          onClick={() => setThumbnailOverrides(prev => ({ ...prev, [dateKey]: log.id }))}
                          style={{ 
                            backgroundColor: 'var(--theme-bg)',
                            borderColor: isThumbnail ? 'var(--theme-secondary)' : 'var(--theme-border)'
                          }}
                          className={`shrink-0 w-full sm:w-[calc((100%-24px)/2)] lg:w-[calc((100%-48px)/3)] snap-start h-full my-auto flex flex-col p-5 sm:p-6 border rounded-xl gap-4 shadow-sm cursor-pointer transition-all ${
                            isThumbnail ? 'ring-2 ring-[var(--theme-secondary)]' : ''
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 border rounded inline-block" style={{ color: getDotColor(log), borderColor: getDotColor(log) }}>{log.projectType}</span>
                            <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${isThumbnail ? 'bg-[var(--theme-secondary)] text-white' : 'opacity-60'}`}>
                              {isThumbnail ? '★ Current Thumbnail' : 'Click to set as thumbnail'}
                            </span>
                          </div>

                          {log.imageUrl && (
                            <img 
                              src={log.imageUrl} 
                              className="h-[210px] w-full rounded-md object-cover border" 
                              style={{ borderColor: 'var(--theme-border)', backgroundColor: 'var(--theme-card)' }}
                              alt="" 
                            />
                          )}

                          <div className="flex items-center justify-between gap-2">
                            <h3 className="text-base font-bold truncate">{log.title}</h3>
                            <a 
                              href={notionPageUrl} 
                              target="_blank" 
                              rel="noopener noreferrer" 
                              onClick={(e) => e.stopPropagation()}
                              style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)', color: 'var(--theme-primary)' }}
                              className="text-xs font-semibold px-2.5 py-1 rounded border shrink-0 flex items-center gap-1 transition-colors hover:border-[var(--theme-primary)]"
                              title="Open in Notion Center Peek"
                            >
                              <span>Open in Notion</span>
                              <span className="text-[10px]">↗</span>
                            </a>
                          </div>

                          {log.pageContent && (
                            <div className="text-xs p-3 rounded border leading-normal whitespace-pre-wrap flex-1 overflow-hidden" style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}>
                              <div className="line-clamp-[12] lg:line-clamp-[16] 2xl:line-clamp-[22] text-ellipsis">
                                {log.pageContent}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="flex items-center justify-center text-center py-12 w-full italic text-sm opacity-50">
                      No logged actions for this target date.
                    </div>
                  )}
                </div>

                {logs.length > 1 && (
                  <button 
                    onClick={() => scrollCarousel('right')}
                    style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}
                    className="absolute right-3 z-30 w-10 h-10 rounded-full flex items-center justify-center border shadow-md transition-all cursor-pointer hover:border-[var(--theme-primary)]"
                    title="Scroll Right"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

export default App;