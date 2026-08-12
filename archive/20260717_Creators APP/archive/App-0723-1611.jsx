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
// HELPER: HEX COLOR SHADE ADJUSTMENT (WITH CONTRAST SAFEGUARD)
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
// ONTARIO STATUTORY HOLIDAY CALCULATOR & NAME RETRIEVAL
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
// SUB-COMPONENT: WEEK DAY COLUMN (WITH OVERFLOW SCROLL ARROWS)
// -------------------------------------------------------------
function WeekDayColumn({ 
  slot, 
  logs, 
  isTodayDate, 
  displayDotHex, 
  weekCardHeight, 
  isDarkMode, 
  cardRadius, 
  hoveredProjectTitle, 
  setHoveredProjectTitle, 
  setSelectedLogModal, 
  getDotColor 
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

  return (
    <div 
      className={`flex flex-col h-full border shadow-sm overflow-hidden transition-all relative ${
        isDarkMode ? 'bg-zinc-900/60 border-zinc-800 text-zinc-100' : 'bg-slate-50/50 border-slate-200 text-slate-900'
      } ${isTodayDate ? 'ring-2 ring-rose-500 ring-offset-1 z-10' : ''}`} 
      style={{ borderRadius: `${cardRadius}px` }}
    >
      {/* Day Frame Header */}
      <div className={`p-2 shrink-0 border-b flex items-center justify-between z-10 relative ${
        isDarkMode ? 'border-zinc-800 bg-zinc-800/40' : 'border-slate-200 bg-white'
      }`}>
        <div 
          className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white shadow-sm border transition-all ${
            hasLog ? 'border-white/80' : (isDarkMode ? 'border-zinc-700 text-zinc-400 bg-zinc-800' : 'border-slate-300 text-slate-500 bg-white')
          } ${isTodayDate && !hasLog ? 'bg-rose-500 ring-2 ring-rose-500 text-white' : ''}`} 
          style={{ backgroundColor: hasLog ? displayDotHex : undefined }}
        >
          {slot.dayNum}
        </div>

        {logs.length > 1 && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-500 border border-amber-500/30">
            {logs.length}
          </span>
        )}
      </div>

      {/* TOP OVERFLOW SCROLL ARROW (WIDE OBLIQUE ANGLE) */}
      {canScrollUp && (
        <button 
          onClick={() => scrollRef.current?.scrollBy({ top: -(weekCardHeight + 10), behavior: 'smooth' })}
          className={`absolute top-[41px] left-0 right-0 z-20 flex items-center justify-center py-1.5 cursor-pointer bg-gradient-to-b ${
            isDarkMode ? 'from-zinc-900 via-zinc-900/90 to-transparent' : 'from-slate-100 via-slate-100/90 to-transparent'
          } hover:opacity-100 opacity-80 transition-all`}
          title="Scroll up"
        >
          <svg className="w-6 h-2.5 stroke-rose-500 fill-none" viewBox="0 0 24 10" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="2 8 12 2 22 8" />
          </svg>
        </button>
      )}

      {/* Vertically Stacked Cards Container (Native Scrollbar Hidden) */}
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
                style={{ height: `${weekCardHeight}px` }}
                className={`relative overflow-hidden rounded-lg border shadow-xs p-2 shrink-0 flex flex-col justify-between transition-all cursor-pointer ${
                  isDarkMode ? 'bg-zinc-800 border-zinc-700 hover:border-zinc-500' : 'bg-white border-slate-200 hover:border-slate-400'
                } ${isHoveredProject ? 'ring-2 ring-amber-500 shadow-md scale-[1.01] z-10' : ''} ${
                  isUnrelatedHover ? 'opacity-40 grayscale-[50%]' : ''
                }`}
              >
                {log.imageUrl && (
                  <img 
                    src={log.imageUrl} 
                    className="absolute inset-0 w-full h-full object-cover z-0 transition-opacity duration-200" 
                    alt="" 
                  />
                )}

                {/* Pill Project Tag */}
                <div className="relative z-10 flex items-center gap-1.5 pointer-events-none">
                  <span 
                    className="inline-flex items-center text-[9px] sm:text-[10px] font-bold text-white px-2 py-0.5 rounded-full backdrop-blur-sm truncate max-w-full leading-none shadow-xs"
                    style={{ backgroundColor: logDotHex }}
                  >
                    {log.Projects}
                  </span>
                </div>

                {/* Translucent Title Overlay */}
                <div className="relative z-10 mt-auto">
                  <div className="text-[10px] sm:text-[11px] font-bold text-white bg-black/30 p-1.5 rounded-sm backdrop-blur-sm line-clamp-2 leading-tight">
                    {log.title}
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className={`h-full flex items-center justify-center text-[10px] italic ${isDarkMode ? 'text-zinc-600' : 'text-slate-300'}`}>
            No entries
          </div>
        )}
      </div>

      {/* BOTTOM OVERFLOW SCROLL ARROW (WIDE OBLIQUE ANGLE) */}
      {canScrollDown && (
        <button 
          onClick={() => scrollRef.current?.scrollBy({ top: weekCardHeight + 10, behavior: 'smooth' })}
          className={`absolute bottom-0 left-0 right-0 z-20 flex items-center justify-center py-1.5 cursor-pointer bg-gradient-to-t ${
            isDarkMode ? 'from-zinc-900 via-zinc-900/90 to-transparent' : 'from-slate-100 via-slate-100/90 to-transparent'
          } hover:opacity-100 opacity-80 transition-all`}
          title="Scroll down"
        >
          <svg className="w-6 h-2.5 stroke-rose-500 fill-none" viewBox="0 0 24 10" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
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
  const [collapsedTypes, setCollapsedTypes] = useState({});

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
  const [isLoading, setIsLoading] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [notionToken, setNotionToken] = useState('');
  const [databaseId, setDatabaseId] = useState('');

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

  // -------------------------------------------------------------
  // 2. API FETCHING & GRADIENT COLOR MAPPING LOGIC
  // -------------------------------------------------------------
  useEffect(() => {
    const savedToken = localStorage.getItem('notionToken');
    const savedDbId = localStorage.getItem('databaseId');
    if (savedToken && savedDbId) {
      setNotionToken(savedToken);
      setDatabaseId(savedDbId);
      fetchLogsFromNotion(savedToken, savedDbId);
    } else {
      setShowSettings(true);
    }
  }, []);

  const fetchLogsFromNotion = async (token, dbId) => {
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
          timeZone: userTimeZone
        }),
      });
      
      const result = await response.json();
      if (result.success) {
        setTimelineLogs(result.data);
        generateProjectColorMap(result.data);
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
      
      let baseHex = '#3F3F46';
      const sampleLog = logs.find(l => (l.projectType || 'General') === type);
      if (sampleLog?.projectTypeColor && NOTION_COLOR_MAP[sampleLog.projectTypeColor]) {
        baseHex = NOTION_COLOR_MAP[sampleLog.projectTypeColor];
      } else if (themeTokens?.colour?.dot?.[type]?.$value?.hex) {
        baseHex = themeTokens.colour.dot[type].$value.hex;
      }

      projs.forEach((proj, idx) => {
        const percent = total <= 1 ? 0 : -15 + (idx / (total - 1)) * 25;
        newColorMap[proj] = adjustHexColor(baseHex, percent);
      });
    });

    setProjectColorMap(newColorMap);
  };

  const handleSaveSettings = () => {
    localStorage.setItem('notionToken', notionToken);
    localStorage.setItem('databaseId', databaseId);
    setShowSettings(false);
    fetchLogsFromNotion(notionToken, databaseId);
  };

  // -------------------------------------------------------------
  // 3. STYLING CONTEXTS (FIGMA DESIGN TOKENS)
  // -------------------------------------------------------------
  const gap = themeTokens?.layout?.gridGap?.$value ?? 12;
  const cardRadius = themeTokens?.card?.radius?.$value ?? 6;

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const getDotColor = (log) => {
    if (!log) return isDarkMode ? '#3F3F46' : '#CBD5E1';
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
    return '#3F3F46';
  };

  const getDisplayDotColor = (logs, dateObj) => {
    if (!logs || logs.length === 0) return isDarkMode ? '#3F3F46' : '#CBD5E1';
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

  // -------------------------------------------------------------
  // 4. CALENDAR & DATA QUERY FILTERS
  // -------------------------------------------------------------
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

  // -------------------------------------------------------------
  // 5. TIMELINE SLOTS SETUP
  // -------------------------------------------------------------
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
  // 6. RENDER (FIXED VIEWPORT / FLUID CONTENT)
  // -------------------------------------------------------------
  return (
    <div ref={appRef} className={`w-full h-screen flex flex-col p-4 sm:p-6 overflow-hidden select-none transition-colors duration-300 ${
      isDarkMode ? 'bg-[#191919] text-zinc-100' : 'bg-slate-50 text-slate-900'
    }`}>
      
      {/* HEADER */}
      <header className="shrink-0 mb-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          {viewMode === 'month' ? (
            <h1 className="text-2xl font-bold tracking-tight inline-flex items-center gap-2">
              <span>{currentDate.toLocaleDateString('en-US', { month: 'long' })}</span>
              <button onClick={() => setViewMode('year')} className="text-rose-500 cursor-pointer hover:underline">{currentDate.getFullYear()}</button>
            </h1>
          ) : viewMode === 'week' ? (
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-1.5">
              <span className="cursor-pointer hover:text-rose-500" onClick={() => setViewMode('month')}>
                {startOfWeek?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
              <span>–</span>
              <span>{endOfWeek?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })},</span>
              <span className="text-rose-500 cursor-pointer" onClick={() => setViewMode('year')}>{endOfWeek?.getFullYear()}</span>
            </h1>
          ) : (
            <h1 className="text-2xl font-bold tracking-tight">
              <span className="text-rose-500">{year}</span> Projects Overview
            </h1>
          )}
          <p className={`text-sm mt-1 ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>Driven by Figma Tokens & Notion Data.</p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => { if (notionToken && databaseId) fetchLogsFromNotion(notionToken, databaseId); }}
            disabled={isLoading || !notionToken || !databaseId}
            title="Sync Notion Data"
            className={`px-3 py-1 text-xs font-semibold border rounded-md cursor-pointer flex items-center gap-1.5 shadow-sm transition-colors ${
              isDarkMode 
                ? 'bg-zinc-800 text-zinc-200 border-zinc-700 hover:bg-zinc-700 disabled:opacity-50' 
                : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50 disabled:opacity-50'
            }`}
          >
            <span className={isLoading ? "animate-spin inline-block" : "inline-block"}>↻</span>
            <span>Sync</span>
          </button>

          <button
            onClick={() => setShowSettings(true)}
            title="Notion Integration Settings"
            className={`px-3 py-1 text-xs font-semibold border rounded-md cursor-pointer flex items-center gap-1.5 shadow-sm transition-colors ${
              isDarkMode 
                ? 'bg-zinc-800 text-zinc-200 border-zinc-700 hover:bg-zinc-700' 
                : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
            }`}
          >
            <span>⚙️</span><span>Settings</span>
          </button>

          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className={`px-3 py-1 text-xs font-semibold border rounded-md cursor-pointer flex items-center gap-1.5 ${
              isSidebarOpen 
                ? (isDarkMode ? 'bg-zinc-700 text-zinc-100 border-zinc-600' : 'bg-zinc-800 text-white border-zinc-700') 
                : (isDarkMode ? 'bg-zinc-800 text-zinc-200 border-zinc-700 hover:bg-zinc-700' : 'bg-white text-slate-600 border-slate-300 shadow-sm hover:bg-slate-50')
            }`}
          >
            <span>📁</span><span>{isSidebarOpen ? 'Hide Projects' : 'Projects'}</span>
          </button>

          <button
            onClick={() => setCurrentDate(today)}
            className={`px-3 py-1 text-xs font-semibold rounded-md flex items-center gap-1.5 border cursor-pointer ${
              isDarkMode 
                ? 'bg-rose-950/40 text-rose-400 border-rose-800/60 hover:bg-rose-900/50' 
                : 'bg-rose-50 text-rose-600 border-rose-200 hover:bg-rose-100'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />Today
          </button>

          <div className={`flex items-center p-0.5 rounded-lg border ${isDarkMode ? 'bg-zinc-800 border-zinc-700' : 'bg-slate-200 border-slate-300'}`}>
            <button onClick={() => setViewMode('year')} className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${viewMode === 'year' ? (isDarkMode ? 'bg-zinc-900 text-zinc-100 shadow-sm font-bold' : 'bg-white text-slate-900 shadow-sm font-bold') : (isDarkMode ? 'text-zinc-400 hover:text-zinc-200' : 'text-zinc-500')}`}>Year</button>
            <button onClick={() => setViewMode('month')} className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${viewMode === 'month' ? (isDarkMode ? 'bg-zinc-900 text-zinc-100 shadow-sm font-bold' : 'bg-white text-slate-900 shadow-sm font-bold') : (isDarkMode ? 'text-zinc-400 hover:text-zinc-200' : 'text-zinc-500')}`}>Month</button>
            <button onClick={() => setViewMode('week')} className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${viewMode === 'week' ? (isDarkMode ? 'bg-zinc-900 text-zinc-100 shadow-sm font-bold' : 'bg-white text-slate-900 shadow-sm font-bold') : (isDarkMode ? 'text-zinc-400 hover:text-zinc-200' : 'text-zinc-500')}`}>Week</button>
          </div>

          <div className="flex items-center gap-1.5">
            <button onClick={handlePrev} className={`px-3 py-1.5 text-xs font-semibold border rounded-md cursor-pointer transition-colors ${isDarkMode ? 'bg-zinc-800 text-zinc-200 border-zinc-700 hover:bg-zinc-700' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'}`}>← Prev</button>
            <button onClick={handleNext} className={`px-3 py-1.5 text-xs font-semibold border rounded-md cursor-pointer transition-colors ${isDarkMode ? 'bg-zinc-800 text-zinc-200 border-zinc-700 hover:bg-zinc-700' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'}`}>Next →</button>
          </div>
        </div>
      </header>

      {/* GLOBAL LOADING / ERROR ALERTS */}
      {isLoading && (
        <div className={`absolute top-20 left-1/2 -translate-x-1/2 z-40 backdrop-blur border px-6 py-3 rounded-full shadow-lg flex items-center gap-3 text-sm font-semibold ${isDarkMode ? 'bg-zinc-900/90 border-zinc-700 text-zinc-200' : 'bg-white/90 border-slate-200 text-slate-700'}`}>
          <span className="w-4 h-4 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
          Syncing Notion Data...
        </div>
      )}
      {fetchError && !isLoading && (
        <div className="mb-4 p-3 shrink-0 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex justify-between items-center">
          <span>⚠️ {fetchError}</span>
          <button onClick={() => fetchLogsFromNotion(notionToken, databaseId)} className="underline font-bold">Retry</button>
        </div>
      )}

      {/* MAIN WORKSPACE SPLIT */}
      <div className="flex-1 flex min-h-0 min-w-0 gap-6">
        
        {/* SIDEBAR */}
        {isSidebarOpen && (
          <aside className={`w-[260px] shrink-0 h-full flex flex-col p-4 rounded-xl border shadow-sm ${isDarkMode ? 'bg-[#191919] border-zinc-800 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'}`} style={{ borderRadius: `${cardRadius}px` }}>
            <div className="mb-3 shrink-0">
              <h2 className={`text-sm font-bold mb-2 ${isDarkMode ? 'text-zinc-200' : 'text-slate-800'}`}>Categories</h2>
              <div className={`flex flex-wrap items-center gap-1.5 pb-2 border-b ${isDarkMode ? 'border-zinc-800' : 'border-slate-100'}`}>
                <button onClick={handleExpandAllCategories} className={`text-[10px] font-bold px-2 py-1 rounded cursor-pointer transition-colors ${isDarkMode ? 'text-zinc-400 hover:text-rose-400 bg-zinc-800 hover:bg-rose-950/40' : 'text-slate-500 hover:text-rose-500 bg-slate-100 hover:bg-rose-50'}`}>Expand All</button>
                <button onClick={handleCollapseAllCategories} className={`text-[10px] font-bold px-2 py-1 rounded cursor-pointer transition-colors ${isDarkMode ? 'text-zinc-400 hover:text-rose-400 bg-zinc-800 hover:bg-rose-950/40' : 'text-slate-500 hover:text-rose-500 bg-slate-100 hover:bg-rose-50'}`}>Collapse All</button>
                <button onClick={handleShowAllFilters} className={`text-[10px] font-bold px-2 py-1 rounded cursor-pointer ml-auto transition-colors ${isDarkMode ? 'text-rose-400 hover:bg-rose-950/50 bg-rose-950/30' : 'text-rose-600 hover:bg-rose-100 bg-rose-50'}`}>Show All</button>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto pr-1 space-y-3 min-h-0">
              {Object.entries(groupedProjects).map(([type, projs]) => {
                const isHidden = collapsedTypes[type] === true;
                const baseTypeHex = projs[0]?.projectTypeColor && NOTION_COLOR_MAP[projs[0].projectTypeColor] 
                  ? NOTION_COLOR_MAP[projs[0].projectTypeColor] 
                  : (themeTokens?.colour?.dot?.[type]?.$value?.hex || '#7c7c7c');
                const categoryBorderColor = adjustHexColor(baseTypeHex, 40);

                return (
                  <div key={type} className={`border rounded-md overflow-hidden shrink-0 shadow-sm ${isDarkMode ? 'bg-[#191919]' : 'bg-white'}`} style={{ borderColor: categoryBorderColor }}>
                    <div onClick={() => toggleTypeAccordion(type)} className={`text-[10px] font-bold uppercase tracking-wider p-2.5 flex items-center justify-between cursor-pointer transition-colors ${isDarkMode ? 'text-zinc-200 hover:bg-zinc-800/60' : 'text-slate-800 hover:bg-slate-50'}`}>
                      <span className="tracking-wide font-black">{type}</span>
                      <span className="text-[9px] font-mono opacity-60">{isHidden ? '▼' : '▲'}</span>
                    </div>
                    {!isHidden && (
                      <div className={`p-2 pt-0 space-y-1.5 border-t ${isDarkMode ? 'bg-[#191919]' : 'bg-white'}`} style={{ borderColor: categoryBorderColor }}>
                        {projs.map((p, i) => {
                          const isSelected = selectedProjectFilters.includes(p.title);
                          const dynamicFilterActive = selectedProjectFilters.length > 0;
                          const isHovered = hoveredProjectTitle === p.title;
                          const projectDotHex = projectColorMap[p.title] || baseTypeHex;

                          let cardStyles = isDarkMode 
                            ? 'border-zinc-700 bg-zinc-800/80 font-medium text-zinc-200 shadow-sm hover:border-amber-400' 
                            : 'border-slate-300 bg-white font-medium text-slate-800 shadow-sm hover:border-amber-400';
                          
                          if (isHovered) {
                            cardStyles = isDarkMode 
                              ? 'border-amber-500 bg-amber-950/40 font-bold text-amber-200 shadow-sm ring-1 ring-amber-500/50 scale-[1.02] z-10 relative transition-all duration-200' 
                              : 'border-amber-500 bg-amber-50 font-bold text-amber-800 shadow-sm ring-1 ring-amber-500/50 scale-[1.02] z-10 relative transition-all duration-200';
                          } else if (dynamicFilterActive) {
                            cardStyles = isSelected 
                              ? (isDarkMode ? 'border-amber-400 bg-zinc-800 font-bold text-zinc-100 shadow-sm ring-1 ring-amber-400/20' : 'border-amber-400 font-bold text-slate-900 shadow-sm ring-1 ring-amber-400/20 bg-white')
                              : (isDarkMode ? 'border-zinc-800 bg-zinc-900 opacity-30 font-normal text-zinc-500 hover:opacity-60' : 'border-slate-200 opacity-30 font-normal text-slate-400 hover:opacity-60 bg-white');
                          }
                          return (
                            <div 
                              key={i} 
                              onClick={() => toggleProjectFilter(p.title)} 
                              onMouseEnter={() => setHoveredProjectTitle(p.title)} 
                              onMouseLeave={() => setHoveredProjectTitle(null)} 
                              className={`text-xs p-2.5 rounded border transition-all cursor-pointer flex items-center gap-2 ${cardStyles}`}
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
        <main ref={calendarRef} className={`flex-1 h-full min-h-0 min-w-0 border rounded-xl shadow-sm p-4 overflow-hidden flex flex-col relative transition-colors ${isDarkMode ? 'bg-[#191919] border-zinc-800 text-zinc-100' : 'bg-white border-gray-200 text-slate-900'}`} style={{ borderRadius: `${cardRadius}px` }}>
          
          {/* A. MONTH VIEW */}
          {viewMode === 'month' && (
            <div className="flex flex-col h-full w-full min-h-0">
              <div className="flex items-center gap-2 mb-2 shrink-0">
                <div className="w-5 shrink-0" />
                <div className="grid w-full flex-1 text-center text-xs font-semibold uppercase tracking-wider" style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: `${gap}px` }}>
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => (
                    <div key={day} className={idx === 0 || idx === 6 ? 'text-rose-500 font-bold' : (isDarkMode ? 'text-zinc-400' : 'text-slate-500')}>{day}</div>
                  ))}
                </div>
              </div>

              <div className="flex flex-col flex-1 min-h-0" style={{ gap: `${gap}px` }}>
                {rows.map((rowSlots, rowIndex) => (
                  <div key={rowIndex} className="flex-1 flex items-stretch gap-2 min-h-0">
                    <button
                      onClick={() => { const targetSlot = rowSlots.find(s => s.isValid && s.dateObj) || rowSlots[0]; if (targetSlot && targetSlot.dateObj) { setCurrentDate(targetSlot.dateObj); setViewMode('week'); } }}
                      title="Open Weekly View"
                      className={`w-5 shrink-0 rounded-md transition-all flex items-center justify-center cursor-pointer group border shadow-sm ${isDarkMode ? 'bg-zinc-800 hover:bg-rose-600 text-zinc-400 hover:text-white border-zinc-700 hover:border-rose-600' : 'bg-slate-100 hover:bg-rose-50 text-slate-400 hover:text-white border-slate-200 hover:border-rose-500'}`}
                    >
                      <span className="text-[10px] font-bold group-hover:scale-125 transition-transform">›</span>
                    </button>
                    <div className="grid w-full flex-1 min-w-0 h-full" style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: `${gap}px` }}>
                      {rowSlots.map((slot, slotIndex) => {
                        if (!slot.isValid) return <div key={slotIndex} className={`h-full w-full opacity-5 ${isDarkMode ? 'bg-zinc-800' : 'bg-slate-200'}`} style={{ borderRadius: `${cardRadius}px` }} />;
                        const logs = getLogsForDate(slot.dateObj);
                        const hasLog = logs.length > 0;
                        const uniqueProjects = new Set(logs.map(l => l.Projects || 'Untitled Project'));
                        const hasMultipleProjects = uniqueProjects.size > 1;
                        const { primaryLog, isHalftoned } = getThumbnailLogForDate(slot.dateObj, logs);
                        const displayDotHex = getDisplayDotColor(logs, slot.dateObj);
                        
                        const isHoveredProject = hasLog && logs.some(l => (l.Projects || 'Untitled Project') === hoveredProjectTitle);
                        const isUnrelatedHover = hoveredProjectTitle && !isHoveredProject;

                        return (
                          <div 
                            key={slotIndex} 
                            onClick={() => slot.dateObj && setSelectedLogModal({ dateObj: slot.dateObj, logs })}
                            onMouseEnter={() => { if (hasLog && primaryLog) setHoveredProjectTitle(primaryLog.Projects || 'Untitled Project'); }}
                            onMouseLeave={() => setHoveredProjectTitle(null)}
                            className={`h-full w-full relative overflow-hidden p-2 border cursor-pointer flex flex-col justify-end transition-all shadow-sm ${isDarkMode ? 'bg-zinc-900 border-zinc-800 hover:border-zinc-700' : 'bg-white border-slate-200 hover:shadow-md'} ${isHoveredProject ? 'ring-2 ring-amber-500 shadow-md scale-[1.02] z-20 bg-amber-500/10' : isToday(slot.dateObj) ? (isUnrelatedHover ? 'ring-2 ring-zinc-500/40 z-10' : 'ring-2 ring-rose-500 ring-offset-1 z-10') : ''}`}
                            style={{ borderRadius: `${cardRadius}px` }}
                          >
                            {hasLog && primaryLog?.imageUrl && (
                              <img 
                                src={primaryLog.imageUrl} 
                                className={`absolute inset-0 w-full h-full object-cover z-0 transition-opacity duration-200 ${isHalftoned ? 'opacity-40 grayscale-[20%]' : ''}`} 
                                alt="" 
                              />
                            )}

                            {/* Top row container: Day Dot + Pill-Shaped Project Tag matching Dot Color */}
                            <div className="absolute top-2 left-2 right-2 flex items-center gap-1.5 z-10 pointer-events-none">
                              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white shadow-sm border transition-opacity duration-200 pointer-events-auto relative shrink-0 ${hasLog ? 'border-white/80' : (isDarkMode ? 'border-zinc-700 text-zinc-400 bg-zinc-800' : 'border-slate-300 text-slate-500 bg-white')} ${isHoveredProject ? 'ring-2 ring-amber-500' : isToday(slot.dateObj) && !hasLog ? 'bg-rose-500 ring-2 ring-rose-500 text-white' : ''} ${isUnrelatedHover ? 'opacity-40 grayscale-[50%]' : ''}`} style={{ backgroundColor: hasLog ? displayDotHex : undefined }}>
                                {slot.dayNum}
                                {hasMultipleProjects && (
                                  <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-amber-500 text-white text-[7px] font-black flex items-center justify-center leading-none p-0 border border-white shadow-sm select-none">
                                    +
                                  </span>
                                )}
                              </div>
                              {hasLog && primaryLog && (
                                <span 
                                  className={`inline-flex items-center text-[9px] sm:text-[10px] font-bold text-white px-2.5 py-0.5 rounded-full backdrop-blur-sm truncate max-w-[calc(100%-2rem)] leading-none shadow-xs transition-opacity duration-200 pointer-events-auto ${isUnrelatedHover ? 'opacity-40 grayscale-[50%]' : ''}`}
                                  style={{ backgroundColor: displayDotHex }}
                                >
                                  {primaryLog.Projects}
                                </span>
                              )}
                            </div>

                            {/* Translucent Entry Page Title Overlay */}
                            {hasLog && primaryLog && (
                              <div className={`relative z-10 text-[10px] sm:text-[11px] font-bold text-white bg-black/30 p-1.5 rounded-sm backdrop-blur-sm line-clamp-2 leading-tight transition-opacity duration-200 ${isUnrelatedHover ? 'opacity-40 grayscale-[50%]' : ''}`}>
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

          {/* B. WEEK VIEW (STRICT PROXIMITY HOVER RESIZE GUIDE & END TRIANGLES) */}
          {viewMode === 'week' && (
            <div className="flex flex-col h-full w-full min-h-0 relative">
              {/* Day Header Row */}
              <div className="grid text-center text-xs font-semibold uppercase tracking-wider mb-2 shrink-0" style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: `${gap}px` }}>
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => (
                  <div key={day} className={idx === 0 || idx === 6 ? 'text-rose-500 font-bold' : (isDarkMode ? 'text-zinc-400' : 'text-slate-500')}>{day}</div>
                ))}
              </div>
              
              {/* Columns Grid Container */}
              <div className="grid flex-1 min-h-0 relative" style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: `${gap}px` }}>
                
                {/* PROXIMITY-ONLY DRAG GUIDE BAR WITH END TRIANGLES */}
                <div 
                  onMouseDown={handleMouseDownResize}
                  className={`group/handle absolute left-0 right-0 z-30 h-6 -translate-y-1/2 flex items-center justify-between cursor-ns-resize pointer-events-auto transition-opacity duration-150 ${
                    isResizingCardHeight ? 'opacity-100' : 'opacity-0 hover:opacity-100'
                  }`}
                  style={{ top: `${weekCardHeight + 55}px` }}
                  title="Click & Drag down/up to scale entry card aspect ratio"
                >
                  {/* Left Triangle End-Cap Indicator */}
                  <div className="pl-0.5 flex items-center pointer-events-none">
                    <svg className="w-2.5 h-3 fill-rose-500 text-rose-500 drop-shadow-xs" viewBox="0 0 8 10">
                      <polygon points="0,0 8,5 0,10" />
                    </svg>
                  </div>

                  {/* Guideline Bar & Center Pill Badge */}
                  <div className={`flex-1 h-[2px] mx-1 transition-all flex items-center justify-center ${
                    isResizingCardHeight 
                      ? 'bg-rose-500 shadow-md' 
                      : (isDarkMode ? 'bg-rose-500/70 group-hover/handle:bg-rose-500' : 'bg-rose-400/80 group-hover/handle:bg-rose-500')
                  }`}>
                    <div className={`text-white text-[9px] font-black px-3 py-0.5 rounded-full shadow-lg flex items-center gap-1.5 transition-transform ${
                      isResizingCardHeight ? 'bg-rose-600 scale-110 ring-2 ring-rose-400' : 'bg-rose-500/90 group-hover/handle:scale-105'
                    }`}>
                      <span>↕ PULL TO RESIZE</span>
                      <span className="font-mono">({Math.round(weekCardHeight)}px)</span>
                    </div>
                  </div>

                  {/* Right Triangle End-Cap Indicator */}
                  <div className="pr-0.5 flex items-center pointer-events-none">
                    <svg className="w-2.5 h-3 fill-rose-500 text-rose-500 drop-shadow-xs" viewBox="0 0 8 10">
                      <polygon points="8,0 0,5 8,10" />
                    </svg>
                  </div>
                </div>

                {/* Day Frame Columns */}
                {slots.map((slot, index) => {
                  const logs = getLogsForDate(slot.dateObj);
                  const displayDotHex = getDisplayDotColor(logs, slot.dateObj);

                  return (
                    <WeekDayColumn 
                      key={index}
                      slot={slot}
                      logs={logs}
                      isTodayDate={isToday(slot.dateObj)}
                      displayDotHex={displayDotHex}
                      weekCardHeight={weekCardHeight}
                      isDarkMode={isDarkMode}
                      cardRadius={cardRadius}
                      hoveredProjectTitle={hoveredProjectTitle}
                      setHoveredProjectTitle={setHoveredProjectTitle}
                      setSelectedLogModal={setSelectedLogModal}
                      getDotColor={getDotColor}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* C. YEAR VIEW (Dynamic Axis Layout) */}
          {viewMode === 'year' && (
            <div className="flex flex-col h-full w-full min-w-0 min-h-0 relative">
              
              {/* Manual Override UI Toggle */}
              <div className={`absolute top-0 right-0 z-50 flex items-center border shadow-sm rounded-md p-1 text-[10px] font-bold ${isDarkMode ? 'bg-zinc-800 border-zinc-700 text-zinc-300' : 'bg-white border-slate-200 text-slate-500'}`}>
                <button 
                  onClick={() => setYearOrientationMode('auto')}
                  className={`px-2 py-1 rounded-sm transition-colors ${yearOrientationMode === 'auto' ? (isDarkMode ? 'bg-rose-950/60 text-rose-400' : 'bg-rose-50 text-rose-600') : (isDarkMode ? 'hover:bg-zinc-700' : 'hover:bg-slate-50')}`}
                  title="Auto Switch based on container width vs height"
                >
                  AUTO
                </button>
                <div className={`w-px h-3 mx-1 ${isDarkMode ? 'bg-zinc-700' : 'bg-slate-200'}`}></div>
                <button 
                  onClick={() => setYearOrientationMode('landscape')}
                  className={`px-2 py-1 rounded-sm transition-colors ${yearOrientationMode === 'landscape' ? (isDarkMode ? 'bg-zinc-700 text-zinc-100' : 'bg-slate-100 text-slate-800') : (isDarkMode ? 'hover:bg-zinc-700' : 'hover:bg-slate-50')}`}
                  title="Force Landscape (Months on Y-Axis)"
                >
                  ↔
                </button>
                <button 
                  onClick={() => setYearOrientationMode('portrait')}
                  className={`px-2 py-1 rounded-sm transition-colors ${yearOrientationMode === 'portrait' ? (isDarkMode ? 'bg-zinc-700 text-zinc-100' : 'bg-slate-100 text-slate-800') : (isDarkMode ? 'hover:bg-zinc-700' : 'hover:bg-slate-50')}`}
                  title="Force Portrait (Months on X-Axis)"
                >
                  ↕
                </button>
              </div>

              {activeYearOrientation === 'portrait' ? (
                /* --- PORTRAIT LAYOUT --- */
                <div className="flex flex-col h-full w-full min-w-0 min-h-0 mt-8 relative">
                  <div className={`grid grid-cols-[30px_repeat(12,minmax(0,1fr))] sm:grid-cols-[40px_repeat(12,minmax(0,1fr))] items-center mb-2 border-b pb-2 shrink-0 ${isDarkMode ? 'border-zinc-800' : 'border-slate-100'}`}>
                    <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-400 text-center">Day</div>
                    {MONTH_NAMES.map((monthLabel, mIdx) => (
                      <div
                        key={monthLabel}
                        onClick={() => { setCurrentDate(new Date(year, mIdx, 1)); setViewMode('month'); }}
                        className={`text-[10px] sm:text-[11px] font-bold text-center tracking-wide py-1 mx-1 rounded border transition-all cursor-pointer ${
                          isDarkMode 
                            ? 'bg-zinc-800/80 border-zinc-700 text-zinc-300 hover:border-rose-500 hover:text-rose-400' 
                            : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-rose-400 hover:text-rose-600'
                        }`}
                      >
                        {monthLabel}
                      </div>
                    ))}
                  </div>
                  
                  <div className="flex-1 flex flex-col justify-between min-h-0 min-w-0 relative">
                    <div className="absolute inset-0 grid grid-cols-[30px_repeat(12,minmax(0,1fr))] sm:grid-cols-[40px_repeat(12,minmax(0,1fr))] pointer-events-none z-0">
                      <div />
                      {MONTH_NAMES.map((_, mIdx) => (
                        <div key={mIdx} className="relative h-full flex justify-center">
                          <div className={`absolute top-0 bottom-0 w-[1.5px] ${isDarkMode ? 'bg-zinc-800' : 'bg-slate-200'}`} />
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
                        <div key={rowIndex} className={`flex-1 grid grid-cols-[30px_repeat(12,minmax(0,1fr))] sm:grid-cols-[40px_repeat(12,minmax(0,1fr))] items-center min-h-0 border-b border-dashed last:border-0 relative z-10 ${isDarkMode ? 'border-zinc-800/50' : 'border-slate-100/50'}`}>
                          <div className="h-full flex items-center justify-center">
                             <div className={`w-full text-[8px] sm:text-[9px] font-black tracking-tight py-0.5 text-center rounded ${isWeekendRow ? 'text-rose-500 font-bold' : (isDarkMode ? 'text-zinc-500' : 'text-slate-400')}`}>
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
                              if (isDarkMode) {
                                const bgBorder = 'bg-amber-950/70 border-amber-500/50 z-20';
                                weekHighlightStyle = isStartOfWeek
                                  ? `${bgBorder} border-x border-t rounded-t-full -mb-1`
                                  : isEndOfWeek
                                  ? `${bgBorder} border-x border-b rounded-b-full -mt-1`
                                  : `${bgBorder} border-x -my-1`;
                              } else {
                                const bgBorder = 'bg-amber-100 border-amber-300/90 z-20';
                                weekHighlightStyle = isStartOfWeek
                                  ? `${bgBorder} border-x border-t rounded-t-full -mb-1`
                                  : isEndOfWeek
                                  ? `${bgBorder} border-x border-b rounded-b-full -mt-1`
                                  : `${bgBorder} border-x -my-1`;
                              }
                            }

                            if (!isValidCalendarDay) {
                              return <div key={mIdx} onClick={() => handleWeekClick(mIdx, weekIndex)} onMouseEnter={() => setHoveredWeek({ mIdx, weekIndex })} onMouseLeave={() => setHoveredWeek(null)} className={`h-full w-full flex items-center justify-center transition-colors cursor-pointer ${weekHighlightStyle}`} />;
                            }

                            const targetDate = new Date(year, mIdx, targetDayNum);
                            const isWeekend = targetDate.getDay() === 0 || targetDate.getDay() === 6;
                            const isStatHoliday = getOntarioStatHolidayName(targetDate) !== null;
                            const logs = getLogsForDate(targetDate);
                            const hasLog = logs.length > 0;
                            const uniqueProjects = new Set(logs.map(l => l.Projects || 'Untitled Project'));
                            const hasMultipleProjects = uniqueProjects.size > 1;
                            const primaryLog = hasLog ? logs[0] : null;
                            const displayDotHex = getDisplayDotColor(logs, targetDate);
                            
                            const isHoveredProject = hasLog && logs.some(l => (l.Projects || 'Untitled Project') === hoveredProjectTitle);
                            const isUnrelatedHover = hoveredProjectTitle && !isHoveredProject;

                            let dotStyles = isDarkMode ? 'border bg-zinc-900 text-zinc-400 font-normal hover:border-zinc-600 hover:text-zinc-200' : 'border bg-white text-slate-500 font-normal hover:border-slate-400 hover:text-slate-700';
                            if (hasLog) {
                              let ringClass = isStatHoliday ? 'ring-2 ring-amber-400/60' : isWeekend ? 'ring-2 ring-rose-400/50' : '';
                              if (isHoveredProject) ringClass = 'ring-2 ring-amber-500 scale-125 z-30';
                              dotStyles = `text-white font-bold border border-white/80 shadow-xs scale-110 ${ringClass}`;
                            } else if (isStatHoliday) {
                              dotStyles = isDarkMode ? 'border border-amber-600/70 bg-zinc-900 text-amber-400 font-medium hover:border-amber-500' : 'border border-amber-300 bg-white text-amber-600 font-medium hover:border-amber-400 hover:text-amber-700';
                            } else if (isWeekend) {
                              dotStyles = isDarkMode ? 'border border-rose-800/70 bg-zinc-900 text-rose-400 font-medium hover:border-rose-700' : 'border border-rose-300 bg-white text-rose-500 font-medium hover:border-rose-400 hover:text-rose-600';
                            } else {
                              dotStyles = isDarkMode ? 'border border-zinc-700 bg-zinc-900 text-zinc-400 font-normal hover:border-zinc-500' : 'border border-slate-300 bg-white text-slate-500 font-normal';
                            }

                            return (
                              <div key={mIdx} onClick={() => handleWeekClick(mIdx, weekIndex)} onMouseEnter={() => { setHoveredWeek({ mIdx, weekIndex }); if (hasLog && primaryLog) setHoveredProjectTitle(primaryLog.Projects || 'Untitled Project'); }} onMouseLeave={() => { setHoveredWeek(null); setHoveredProjectTitle(null); }} className={`h-full w-full flex items-center justify-center relative cursor-pointer group/node transition-colors ${weekHighlightStyle}`}>
                                <div onClick={(e) => { e.stopPropagation(); setSelectedLogModal({ dateObj: targetDate, logs }); }} className={`w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full flex items-center justify-center text-[7px] sm:text-[8px] transition-all duration-200 relative z-10 ${dotStyles} ${hasLog ? 'border-white/80' : ''} ${isHoveredProject ? 'ring-2 ring-amber-500 ring-offset-1 font-bold z-30 scale-125' : isToday(targetDate) ? 'ring-2 ring-rose-500 ring-offset-1 font-bold' : ''} ${isUnrelatedHover ? 'opacity-40 grayscale-[50%]' : ''}`} style={{ backgroundColor: hasLog ? displayDotHex : undefined }}>
                                  {targetDayNum}
                                  {hasMultipleProjects && (
                                    <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-500 text-white text-[6px] font-black flex items-center justify-center leading-none p-0 border border-white/80 shadow-xs select-none">
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
                  <div className={`grid grid-cols-[50px_1fr] sm:grid-cols-[65px_1fr] items-center mb-2 border-b pb-2 shrink-0 ${isDarkMode ? 'border-zinc-800' : 'border-slate-100'}`}>
                    <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-400 text-center">Month</div>
                    <div className="grid gap-0.5 sm:gap-1 text-center min-w-0" style={{ gridTemplateColumns: 'repeat(37, minmax(0, 1fr))' }}>
                      {Array.from({ length: 37 }).map((_, colIndex) => {
                        const weekdayStr = TIMELINE_WEEKDAYS[colIndex % 7];
                        const isWeekend = weekdayStr === 'SUN' || weekdayStr === 'SAT';
                        return <div key={colIndex} className={`text-[8px] sm:text-[9px] font-black tracking-tight py-1 rounded ${isWeekend ? 'text-rose-500 font-bold' : (isDarkMode ? 'text-zinc-500' : 'text-slate-400')}`}>{weekdayStr.slice(0, 2)}</div>;
                      })}
                    </div>
                  </div>
                  
                  <div className="flex-1 flex flex-col justify-between min-h-0 min-w-0">
                    {MONTH_NAMES.map((monthLabel, mIdx) => {
                      const firstDayOfMonthObj = new Date(year, mIdx, 1);
                      const startOffsetColumn = firstDayOfMonthObj.getDay(); 
                      const daysInMonth = new Date(year, mIdx + 1, 0).getDate();
                      return (
                        <div key={monthLabel} className={`grid grid-cols-[50px_1fr] sm:grid-cols-[65px_1fr] items-center h-full min-h-0 min-w-0 relative group border-b border-dashed last:border-0 ${isDarkMode ? 'border-zinc-800/50' : 'border-slate-100/50'}`}>
                          <div onClick={() => { setCurrentDate(new Date(year, mIdx, 1)); setViewMode('month'); }} className={`text-[10px] sm:text-[11px] font-bold text-center tracking-wide py-1 mx-1 rounded border transition-all cursor-pointer ${isDarkMode ? 'bg-zinc-800/80 border-zinc-700 text-zinc-300 hover:border-rose-500 hover:text-rose-400' : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-rose-400 hover:text-rose-600'}`}>
                            {monthLabel}
                          </div>
                          <div className="grid gap-0.5 sm:gap-1 items-center relative h-full min-w-0" style={{ gridTemplateColumns: 'repeat(37, minmax(0, 1fr))' }}>
                            <div className={`absolute left-2 right-2 top-1/2 -translate-y-1/2 h-[1.5px] z-0 pointer-events-none ${isDarkMode ? 'bg-zinc-800' : 'bg-slate-200'}`} />

                            {Array.from({ length: 37 }).map((_, colIndex) => {
                              const weekIndex = Math.floor(colIndex / 7);
                              const isHoveredWeekCell = hoveredWeek?.mIdx === mIdx && hoveredWeek?.weekIndex === weekIndex;
                              const targetDayNum = colIndex - startOffsetColumn + 1;
                              const isValidCalendarDay = targetDayNum > 0 && targetDayNum <= daysInMonth;

                              const isStartOfWeek = colIndex % 7 === 0;
                              const isEndOfWeek = colIndex % 7 === 6 || colIndex === 36;

                              let weekHighlightStyle = '';
                              if (isHoveredWeekCell) {
                                if (isDarkMode) {
                                  const bgBorder = 'bg-amber-950/70 border-amber-500/50 z-20';
                                  weekHighlightStyle = isStartOfWeek
                                    ? `${bgBorder} border-y border-l rounded-l-full -mr-1 sm:-mr-1.5`
                                    : isEndOfWeek
                                    ? `${bgBorder} border-y border-r rounded-r-full -ml-1 sm:-ml-1.5`
                                    : `${bgBorder} border-y -mx-1 sm:-mx-1.5`;
                                } else {
                                  const bgBorder = 'bg-amber-100 border-amber-300/90 z-20';
                                  weekHighlightStyle = isStartOfWeek
                                    ? `${bgBorder} border-y border-l rounded-l-full -mr-1 sm:-mr-1.5`
                                    : isEndOfWeek
                                    ? `${bgBorder} border-y border-r rounded-r-full -ml-1 sm:-ml-1.5`
                                    : `${bgBorder} border-y -mx-1 sm:-mx-1.5`;
                                }
                              }

                              if (!isValidCalendarDay) {
                                return <div key={colIndex} onClick={() => handleWeekClick(mIdx, weekIndex)} onMouseEnter={() => setHoveredWeek({ mIdx, weekIndex })} onMouseLeave={() => setHoveredWeek(null)} className={`h-full flex items-center justify-center transition-colors cursor-pointer ${weekHighlightStyle}`} />;
                              }
                              
                              const targetDate = new Date(year, mIdx, targetDayNum);
                              const isWeekend = targetDate.getDay() === 0 || targetDate.getDay() === 6;
                              const isStatHoliday = getOntarioStatHolidayName(targetDate) !== null;
                              const logs = getLogsForDate(targetDate);
                              const hasLog = logs.length > 0;
                              const uniqueProjects = new Set(logs.map(l => l.Projects || 'Untitled Project'));
                              const hasMultipleProjects = uniqueProjects.size > 1;
                              const primaryLog = hasLog ? logs[0] : null;
                              const displayDotHex = getDisplayDotColor(logs, targetDate);
                              
                              const isHoveredProject = hasLog && logs.some(l => (l.Projects || 'Untitled Project') === hoveredProjectTitle);
                              const isUnrelatedHover = hoveredProjectTitle && !isHoveredProject;
                              
                              let dotStyles = isDarkMode ? 'border bg-zinc-900 text-zinc-400 font-normal hover:border-zinc-600 hover:text-zinc-200' : 'border bg-white text-slate-500 font-normal hover:border-slate-400 hover:text-slate-700';
                              if (hasLog) {
                                let ringClass = isStatHoliday ? 'ring-2 ring-amber-400/60' : isWeekend ? 'ring-2 ring-rose-400/50' : '';
                                if (isHoveredProject) ringClass = 'ring-2 ring-amber-500 scale-125 z-30';
                                dotStyles = `text-white font-bold border border-white/80 shadow-xs scale-110 ${ringClass}`;
                              } else if (isStatHoliday) {
                                dotStyles = isDarkMode ? 'border border-amber-600/70 bg-zinc-900 text-amber-400 font-medium hover:border-amber-500' : 'border border-amber-300 bg-white text-amber-600 font-medium hover:border-amber-400 hover:text-amber-700';
                              } else if (isWeekend) {
                                dotStyles = isDarkMode ? 'border border-rose-800/70 bg-zinc-900 text-rose-400 font-medium hover:border-rose-700' : 'border border-rose-300 bg-white text-rose-500 font-medium hover:border-rose-400 hover:text-rose-600';
                              } else {
                                dotStyles = isDarkMode ? 'border border-zinc-700 bg-zinc-900 text-zinc-400 font-normal hover:border-zinc-500' : 'border border-slate-300 bg-white text-slate-500 font-normal';
                              }

                              return (
                                <div key={colIndex} onClick={() => handleWeekClick(mIdx, weekIndex)} onMouseEnter={() => { setHoveredWeek({ mIdx, weekIndex }); if (hasLog && primaryLog) setHoveredProjectTitle(primaryLog.Projects || 'Untitled Project'); }} onMouseLeave={() => { setHoveredWeek(null); setHoveredProjectTitle(null); }} className={`h-full flex items-center justify-center relative cursor-pointer group/node transition-colors ${weekHighlightStyle}`}>
                                  <div onClick={(e) => { e.stopPropagation(); setSelectedLogModal({ dateObj: targetDate, logs }); }} className={`w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full flex items-center justify-center text-[7px] sm:text-[8px] transition-all duration-200 relative z-10 ${dotStyles} ${hasLog ? 'border-white/80' : ''} ${isHoveredProject ? 'ring-2 ring-amber-500 ring-offset-1 font-bold z-30 scale-125' : isToday(targetDate) ? 'ring-2 ring-rose-500 ring-offset-1 font-bold' : ''} ${isUnrelatedHover ? 'opacity-40 grayscale-[50%]' : ''}`} style={{ backgroundColor: hasLog ? displayDotHex : undefined }}>
                                    {targetDayNum}
                                    {hasMultipleProjects && (
                                      <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-500 text-white text-[6px] font-black flex items-center justify-center leading-none p-0 border border-white/80 shadow-xs select-none">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm text-slate-800">
          <div className={`w-full max-w-md rounded-xl shadow-xl border p-6 ${isDarkMode ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-white border-slate-200 text-slate-800'}`}>
            <h2 className="text-lg font-bold mb-4">Widget Setup</h2>
            <p className={`text-xs mb-6 ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>Enter your Notion Integration Token and Database ID to fetch your personal logs.</p>
            
            <div className="space-y-4">
              <div>
                <label className={`block text-xs font-bold mb-1 ${isDarkMode ? 'text-zinc-300' : 'text-slate-700'}`}>Notion Integration Token</label>
                <input 
                  type="password" 
                  value={notionToken} 
                  onChange={(e) => setNotionToken(e.target.value)} 
                  className={`w-full border rounded px-3 py-2 text-sm outline-none ${isDarkMode ? 'bg-zinc-800 border-zinc-700 text-zinc-100 focus:border-rose-500' : 'border-slate-300 focus:border-rose-500 focus:ring-1 focus:ring-rose-500'}`}
                  placeholder="secret_..."
                />
              </div>
              <div>
                <label className={`block text-xs font-bold mb-1 ${isDarkMode ? 'text-zinc-300' : 'text-slate-700'}`}>Notion Database ID</label>
                <input 
                  type="text" 
                  value={databaseId} 
                  onChange={(e) => setDatabaseId(e.target.value)} 
                  className={`w-full border rounded px-3 py-2 text-sm outline-none ${isDarkMode ? 'bg-zinc-800 border-zinc-700 text-zinc-100 focus:border-rose-500' : 'border-slate-300 focus:border-rose-500 focus:ring-1 focus:ring-rose-500'}`}
                  placeholder="3728d5a5..."
                />
              </div>
            </div>

            <div className="mt-8 flex items-center justify-end gap-3">
              <button 
                onClick={() => setShowSettings(false)} 
                className={`px-4 py-2 text-sm font-semibold cursor-pointer ${isDarkMode ? 'text-zinc-400 hover:text-zinc-200' : 'text-slate-600 hover:text-slate-800'}`}
              >
                Cancel
              </button>
              <button 
                onClick={handleSaveSettings} 
                disabled={!notionToken || !databaseId}
                className="px-4 py-2 text-sm font-bold text-white bg-rose-500 rounded hover:bg-rose-600 disabled:opacity-50 cursor-pointer shadow-sm"
              >
                Save & Sync
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DETAIL LOG MODAL */}
      {selectedLogModal && (() => {
        const dateKey = selectedLogModal.dateObj.toISOString().split('T')[0];
        const currentThumbId = thumbnailOverrides[dateKey] || (selectedLogModal.logs[0]?.id);
        const logs = selectedLogModal.logs;

        const scrollCarousel = (direction) => {
          if (!modalCarouselRef.current) return;
          const firstChild = modalCarouselRef.current.firstElementChild;
          const scrollAmount = firstChild ? firstChild.clientWidth + 24 : 450;
          modalCarouselRef.current.scrollBy({ left: direction === 'left' ? -scrollAmount : scrollAmount, behavior: 'smooth' });
        };

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 sm:p-8 bg-black/70 backdrop-blur-sm" onClick={() => setSelectedLogModal(null)}>
            <div className={`w-[90%] max-w-[1300px] h-[85%] max-h-[850px] rounded-2xl flex flex-col overflow-hidden shadow-2xl border ${isDarkMode ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'}`} onClick={(e) => e.stopPropagation()}>
              
              {/* Modal Header */}
              <div className={`px-6 py-4 border-b flex items-center justify-between shrink-0 ${isDarkMode ? 'bg-zinc-800/80 border-zinc-700' : 'bg-slate-50 border-slate-100'}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold text-rose-500 tracking-wider">
                    {selectedLogModal.dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                  {getOntarioStatHolidayName(selectedLogModal.dateObj) && (
                    <span className="text-xs font-bold text-amber-500 bg-amber-950/40 border border-amber-800/60 px-2 py-0.5 rounded-md flex items-center gap-1 shadow-xs">
                      <span>—</span>
                      <span>{getOntarioStatHolidayName(selectedLogModal.dateObj)}</span>
                    </span>
                  )}
                </div>
                <button onClick={() => setSelectedLogModal(null)} className={`font-bold cursor-pointer text-base ${isDarkMode ? 'text-zinc-400 hover:text-zinc-200' : 'text-slate-400 hover:text-slate-600'}`}>✕</button>
              </div>
              
              {/* Modal Body Carousel Container */}
              <div className="relative flex-1 flex items-center overflow-hidden p-6 sm:p-8">
                
                {/* Left Chevron Button */}
                {logs.length > 1 && (
                  <button 
                    onClick={() => scrollCarousel('left')}
                    className={`absolute left-3 z-30 w-10 h-10 rounded-full flex items-center justify-center border shadow-md transition-all cursor-pointer ${
                      isDarkMode 
                        ? 'bg-zinc-800/90 border-zinc-700 text-zinc-200 hover:bg-rose-600 hover:border-rose-600 hover:text-white' 
                        : 'bg-white/90 border-slate-300 text-slate-700 hover:bg-rose-500 hover:border-rose-500 hover:text-white'
                    }`}
                    title="Scroll Left"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                )}

                {/* Horizontal Scroll Area */}
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
                          className={`shrink-0 w-full sm:w-[calc((100%-24px)/2)] lg:w-[calc((100%-48px)/3)] snap-start h-full my-auto flex flex-col p-5 sm:p-6 border rounded-xl gap-4 shadow-sm cursor-pointer transition-all ${
                            isThumbnail 
                              ? (isDarkMode ? 'border-2 border-amber-500 bg-amber-950/20 ring-2 ring-amber-500/20' : 'border-2 border-amber-500 bg-amber-50/20 ring-2 ring-amber-500/20')
                              : (isDarkMode ? 'border-zinc-700 bg-zinc-800/80 hover:border-zinc-500' : 'border-slate-200 bg-slate-50 hover:border-slate-400')
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 border rounded inline-block" style={{ color: getDotColor(log), borderColor: getDotColor(log) }}>{log.projectType}</span>
                            <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${isThumbnail ? 'bg-amber-500 text-white' : (isDarkMode ? 'bg-zinc-700 text-zinc-300' : 'bg-slate-200 text-slate-600')}`}>
                              {isThumbnail ? '★ Current Thumbnail' : 'Click to set as thumbnail'}
                            </span>
                          </div>

                          {log.imageUrl && (
                            <img 
                              src={log.imageUrl} 
                              className={`h-[210px] w-full rounded-md object-cover border ${isDarkMode ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-slate-100'}`} 
                              alt="" 
                            />
                          )}

                          <div className="flex items-center justify-between gap-2">
                            <h3 className={`text-base font-bold truncate ${isDarkMode ? 'text-zinc-100' : 'text-slate-800'}`}>{log.title}</h3>
                            <a 
                              href={notionPageUrl} 
                              target="_blank" 
                              rel="noopener noreferrer" 
                              onClick={(e) => e.stopPropagation()}
                              className={`text-xs font-semibold px-2.5 py-1 rounded border shrink-0 flex items-center gap-1 transition-colors ${
                                isDarkMode 
                                  ? 'bg-zinc-800 border-zinc-700 text-rose-400 hover:bg-rose-950/40 hover:border-rose-700' 
                                  : 'bg-white border-slate-300 text-rose-600 hover:bg-rose-50 hover:border-rose-300'
                              }`}
                              title="Open in Notion Center Peek"
                            >
                              <span>Open in Notion</span>
                              <span className="text-[10px]">↗</span>
                            </a>
                          </div>

                          {log.pageContent && (
                            <div className={`text-xs p-3 rounded border leading-normal whitespace-pre-wrap flex-1 overflow-hidden ${isDarkMode ? 'bg-zinc-900 border-zinc-700 text-zinc-300' : 'bg-white border-slate-200 text-slate-600'}`}>
                              <div className="line-clamp-[12] lg:line-clamp-[16] 2xl:line-clamp-[22] text-ellipsis">
                                {log.pageContent}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className={`flex items-center justify-center text-center py-12 w-full italic text-sm ${isDarkMode ? 'text-zinc-500' : 'text-slate-400'}`}>
                      No logged actions for this target date.
                    </div>
                  )}
                </div>

                {/* Right Chevron Button */}
                {logs.length > 1 && (
                  <button 
                    onClick={() => scrollCarousel('right')}
                    className={`absolute right-3 z-30 w-10 h-10 rounded-full flex items-center justify-center border shadow-md transition-all cursor-pointer ${
                      isDarkMode 
                        ? 'bg-zinc-800/90 border-zinc-700 text-zinc-200 hover:bg-rose-600 hover:border-rose-600 hover:text-white' 
                        : 'bg-white/90 border-slate-300 text-slate-700 hover:bg-rose-500 hover:border-rose-500 hover:text-white'
                    }`}
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