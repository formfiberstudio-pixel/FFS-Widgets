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

function App() {
  // -------------------------------------------------------------
  // 1. STATE & INITIALIZATION
  // -------------------------------------------------------------
  const today = new Date();
  const [currentDate, setCurrentDate] = useState(today);
  const [viewMode, setViewMode] = useState('year'); 
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [selectedProjectFilters, setSelectedProjectFilters] = useState([]); 
  const [selectedLogModal, setSelectedLogModal] = useState(null); 
  
  const [hoveredProjectTitle, setHoveredProjectTitle] = useState(null);
  const [hoveredWeek, setHoveredWeek] = useState(null);
  const [collapsedTypes, setCollapsedTypes] = useState({});

  // --- NEW API STATE VARS ---
  const [timelineLogs, setTimelineLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [notionToken, setNotionToken] = useState('');
  const [databaseId, setDatabaseId] = useState('');

  const carouselRef = useRef(null);

  const [isDarkMode, setIsDarkMode] = useState(() => 
    window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e) => setIsDarkMode(e.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  // -------------------------------------------------------------
  // NEW API FETCHING LOGIC
  // -------------------------------------------------------------
  
  // Load saved credentials on initial mount
  useEffect(() => {
    const savedToken = localStorage.getItem('notionToken');
    const savedDbId = localStorage.getItem('databaseId');
    if (savedToken && savedDbId) {
      setNotionToken(savedToken);
      setDatabaseId(savedDbId);
      fetchLogsFromNotion(savedToken, savedDbId);
    } else {
      setShowSettings(true); // Open settings modal if no credentials exist
    }
  }, []);

  const fetchLogsFromNotion = async (token, dbId) => {
    setIsLoading(true);
    setFetchError(null);
    try {
      const response = await fetch('/api/get-notion-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notionToken: token, databaseId: dbId }),
      });
      
      const result = await response.json();
      if (result.success) {
        setTimelineLogs(result.data);
      } else {
        setFetchError(result.error || 'Failed to sync with Notion.');
      }
    } catch (err) {
      setFetchError('Network error occurred while fetching logs.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveSettings = () => {
    localStorage.setItem('notionToken', notionToken);
    localStorage.setItem('databaseId', databaseId);
    setShowSettings(false);
    fetchLogsFromNotion(notionToken, databaseId);
  };

  // -------------------------------------------------------------
  // 2. STYLING CONTEXTS (FIGMA DESIGN TOKENS)
  // -------------------------------------------------------------
  const columns = themeTokens?.layout?.gridColumns?.$value ?? 7;
  const gap = themeTokens?.layout?.gridGap?.$value ?? 16;
  const cardRadius = themeTokens?.card?.radius?.$value ?? 6;

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const getDotColor = (log) => {
    if (!log) return isDarkMode ? '#27272A' : '#E4E4E7';
    if (log.projectTypeColor && NOTION_COLOR_MAP[log.projectTypeColor]) {
      return NOTION_COLOR_MAP[log.projectTypeColor];
    }
    if (log.projectType) {
      const tokenHex = themeTokens?.colour?.dot?.[log.projectType]?.$value?.hex;
      if (tokenHex) return tokenHex;
    }
    return '#3F3F46';
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
  // 3. CALENDAR & DATA QUERY FILTERS
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

  const getGroupedProjects = (targetYear) => {
    const projects = getYearProjects(targetYear);
    const grouped = {};
    projects.forEach(proj => {
      const type = proj.projectType || 'General';
      if (!grouped[type]) grouped[type] = [];
      grouped[type].push(proj);
    });
    return grouped;
  };

  const groupedProjects = getGroupedProjects(year);

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
    const totalSlots = Math.ceil((daysInMonth + startDayOffset) / columns) * columns;

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

  return (
    <div className={`min-h-screen transition-colors duration-300 p-8 ${
      isDarkMode ? 'bg-[#0B0B0C] text-white' : 'bg-slate-50 text-slate-900'
    }`}>
      <div className="max-w-[1600px] mx-auto relative">
        
        {/* Main Header Control Bar */}
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
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
            <p className={`text-sm mt-1 ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>Driven by Figma Tokens & Notion Data.</p>
          </div>

          <div className="flex items-center gap-3">
            
            {/* Added Settings Gear Button */}
            <button
              onClick={() => setShowSettings(true)}
              title="Notion Integration Settings"
              className={`px-3 py-1 text-xs font-semibold border rounded-md cursor-pointer flex items-center gap-1.5 bg-white text-slate-600 border-slate-300 shadow-xs hover:bg-slate-50`}
            >
              <span>⚙️</span>
              <span>Settings</span>
            </button>

            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className={`px-3 py-1 text-xs font-semibold border rounded-md cursor-pointer flex items-center gap-1.5 ${
                isSidebarOpen ? 'bg-zinc-800 text-white border-zinc-700' : 'bg-white text-slate-600 border-slate-300 shadow-xs'
              }`}
            >
              <span>📁</span>
              <span>{isSidebarOpen ? 'Hide Projects' : 'Projects'}</span>
            </button>

            <button
              onClick={() => setCurrentDate(today)}
              className="px-3 py-1 text-xs font-semibold rounded-md flex items-center gap-1.5 bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100 cursor-pointer"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
              Today
            </button>

            {/* View Switching Selector Matrix */}
            <div className={`flex items-center p-0.5 rounded-lg border ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-200 border-slate-300'}`}>
              <button onClick={() => setViewMode('year')} className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${viewMode === 'year' ? 'bg-white text-slate-900 shadow-xs font-bold' : 'text-zinc-400'}`}>Year</button>
              <button onClick={() => setViewMode('month')} className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${viewMode === 'month' ? 'bg-white text-slate-900 shadow-xs font-bold' : 'text-zinc-400'}`}>Month</button>
              <button onClick={() => setViewMode('week')} className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${viewMode === 'week' ? 'bg-white text-slate-900 shadow-xs font-bold' : 'text-zinc-400'}`}>Week</button>
            </div>

            <div className="flex items-center gap-1.5">
              <button onClick={handlePrev} className="px-3 py-1.5 text-xs font-semibold border rounded-md bg-white text-slate-700 border-slate-300 hover:bg-slate-100 cursor-pointer">← Prev</button>
              <button onClick={handleNext} className="px-3 py-1.5 text-xs font-semibold border rounded-md bg-white text-slate-700 border-slate-300 hover:bg-slate-100 cursor-pointer">Next →</button>
            </div>
          </div>
        </header>

        {/* Global Loading / Error State Banner */}
        {isLoading && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 z-40 bg-white/90 backdrop-blur border border-slate-200 px-6 py-3 rounded-full shadow-lg flex items-center gap-3 text-sm font-semibold text-slate-700">
            <span className="w-4 h-4 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
            Syncing Notion Data...
          </div>
        )}
        {fetchError && !isLoading && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex justify-between items-center">
            <span>⚠️ {fetchError}</span>
            <button onClick={() => fetchLogsFromNotion(notionToken, databaseId)} className="underline font-bold">Retry</button>
          </div>
        )}

        {/* Layout Workspace split */}
        <div className={`grid grid-cols-1 ${isSidebarOpen ? 'lg:grid-cols-12' : ''} gap-8 items-start`}>
          
          {/* Categories Sidebar */}
          {isSidebarOpen && (
            <div className="lg:col-span-3 p-5 rounded-xl border flex flex-col bg-white border-slate-200 shadow-xs" style={{ borderRadius: `${cardRadius}px` }}>
              <div className="mb-4">
                <h2 className="text-sm font-bold text-slate-800 mb-2">Categories</h2>
                <div className="flex flex-wrap items-center gap-1.5 mb-2 pb-2 border-b border-slate-100">
                  <button onClick={handleExpandAllCategories} className="text-[10px] font-bold text-slate-500 hover:text-rose-500 bg-slate-100 hover:bg-rose-50 px-2 py-1 rounded cursor-pointer">Expand All</button>
                  <button onClick={handleCollapseAllCategories} className="text-[10px] font-bold text-slate-500 hover:text-rose-500 bg-slate-100 hover:bg-rose-50 px-2 py-1 rounded cursor-pointer">Collapse All</button>
                  <button onClick={handleShowAllFilters} className="text-[10px] font-bold text-rose-600 hover:bg-rose-100 bg-rose-50 px-2 py-1 rounded cursor-pointer ml-auto">Show All</button>
                </div>
              </div>
              
              <div className="space-y-3 max-h-[68vh] overflow-y-auto pr-1">
                {Object.entries(groupedProjects).map(([type, projs]) => {
                  const isHidden = collapsedTypes[type] === true;
                  return (
                    <div key={type} className="border border-slate-200 rounded-md bg-slate-50/50 overflow-hidden">
                      <div onClick={() => toggleTypeAccordion(type)} className="text-[10px] font-bold uppercase tracking-wider p-2 text-slate-500 flex items-center justify-between cursor-pointer hover:bg-slate-100 transition-colors">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: projs[0]?.projectTypeColor && NOTION_COLOR_MAP[projs[0].projectTypeColor] ? NOTION_COLOR_MAP[projs[0].projectTypeColor] : '#7c7c7c' }} />
                          {type}
                        </div>
                        <span className="text-[9px] font-mono opacity-60">{isHidden ? '▼' : '▲'}</span>
                      </div>
                      {!isHidden && (
                        <div className="p-2 pt-0 space-y-1.5 border-t border-slate-150">
                          {projs.map((p, i) => {
                            const isSelected = selectedProjectFilters.includes(p.title);
                            const dynamicFilterActive = selectedProjectFilters.length > 0;
                            const isHovered = hoveredProjectTitle === p.title;
                            let cardStyles = 'border-slate-300 font-medium text-slate-800 shadow-2xs hover:border-rose-400';
                            
                            if (isHovered) {
                              cardStyles = 'border-rose-500 bg-rose-50 font-bold text-rose-700 shadow-sm ring-1 ring-rose-500/50 scale-[1.02] z-10 relative transition-all duration-200';
                            } else if (dynamicFilterActive) {
                              cardStyles = isSelected 
                                ? 'border-rose-400 font-bold text-slate-900 shadow-xs ring-1 ring-rose-400/20' 
                                : 'border-slate-200 opacity-30 font-normal text-slate-400 hover:opacity-60';
                            }
                            return (
                              <div key={i} onClick={() => toggleProjectFilter(p.title)} onMouseEnter={() => setHoveredProjectTitle(p.title)} onMouseLeave={() => setHoveredProjectTitle(null)} className={`text-xs p-2.5 rounded border transition-all cursor-pointer bg-white ${cardStyles}`}>
                                {p.title}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Right Main Time Series Display Matrix */}
          <div className={isSidebarOpen ? 'lg:col-span-9' : 'w-full'}>
            
            {viewMode !== 'year' && (
              <div className="flex items-center gap-2 mb-3">
                {viewMode === 'month' && <div className="w-5 shrink-0" />}
                <div className="grid w-full flex-1 text-center text-xs font-semibold uppercase tracking-wider" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: `${gap}px` }}>
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => (
                    <div key={day} className={idx === 0 || idx === 6 ? 'text-rose-500 font-bold' : 'text-slate-500'}>{day}</div>
                  ))}
                </div>
              </div>
            )}

            {viewMode === 'month' ? (
              <div className="flex flex-col" style={{ gap: `${gap}px` }}>
                {rows.map((rowSlots, rowIndex) => (
                  <div key={rowIndex} className="flex items-stretch gap-2">
                    <button
                      onClick={() => { const targetSlot = rowSlots.find(s => s.isValid && s.dateObj) || rowSlots[0]; if (targetSlot && targetSlot.dateObj) { setCurrentDate(targetSlot.dateObj); setViewMode('week'); } }}
                      title="Open Weekly View"
                      className="w-5 shrink-0 rounded-md bg-slate-100 hover:bg-rose-500 text-slate-400 hover:text-white transition-all flex items-center justify-center cursor-pointer group border border-slate-200 hover:border-rose-500 shadow-2xs"
                    >
                      <span className="text-[10px] font-bold group-hover:scale-125 transition-transform">›</span>
                    </button>
                    <div className="grid w-full flex-1" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: `${gap}px` }}>
                      {rowSlots.map((slot, slotIndex) => {
                        if (!slot.isValid) return <div key={slotIndex} className="aspect-[3/4] opacity-5 bg-slate-200" style={{ borderRadius: `${cardRadius}px` }} />;
                        const logs = getLogsForDate(slot.dateObj);
                        const hasLog = logs.length > 0;
                        const pLog = logs[0];
                        return (
                          <div 
                            key={slotIndex} 
                            onClick={() => slot.dateObj && setSelectedLogModal({ dateObj: slot.dateObj, logs })}
                            onMouseEnter={() => { if (hasLog && pLog) setHoveredProjectTitle(pLog.Projects || 'Untitled Project'); }}
                            onMouseLeave={() => setHoveredProjectTitle(null)}
                            className={`relative aspect-[3/4] overflow-hidden p-3 border cursor-pointer flex flex-col justify-end transition-all bg-white border-slate-200 hover:shadow-md ${isToday(slot.dateObj) ? 'ring-2 ring-rose-500 ring-offset-1 z-10' : ''}`}
                            style={{ borderRadius: `${cardRadius}px` }}
                          >
                            {hasLog && pLog.imageUrl && <img src={pLog.imageUrl} className="absolute inset-0 w-full h-full object-cover z-0" alt="" />}
                            <div className={`absolute top-2 left-2 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold z-10 text-white shadow-2xs ${isToday(slot.dateObj) && !hasLog ? 'bg-rose-500' : ''}`} style={{ backgroundColor: hasLog ? getDotColor(pLog) : undefined }}>{slot.dayNum}</div>
                            {hasLog && <div className="relative z-10 text-[11px] font-bold text-white bg-black/60 p-1 rounded-xs backdrop-blur-xs line-clamp-2 leading-tight">{pLog.title}</div>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : viewMode === 'week' ? (
              <div className="grid items-start" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: `${gap}px` }}>
                {slots.map((slot, index) => {
                  const logs = getLogsForDate(slot.dateObj);
                  const hasLog = logs.length > 0;
                  const pLog = logs[0];
                  return (
                    <div 
                      key={index} 
                      className={`flex flex-col bg-white border border-slate-200 shadow-2xs overflow-hidden transition-all ${isToday(slot.dateObj) ? 'ring-2 ring-rose-500 ring-offset-1 z-10' : ''}`} 
                      style={{ borderRadius: `${cardRadius}px` }}
                    >
                      <div 
                        onClick={() => slot.dateObj && setSelectedLogModal({ dateObj: slot.dateObj, logs })}
                        onMouseEnter={() => { if (hasLog && pLog) setHoveredProjectTitle(pLog.Projects || 'Untitled Project'); }}
                        onMouseLeave={() => setHoveredProjectTitle(null)}
                        className="relative aspect-[3/4] overflow-hidden p-3 border-b border-slate-100 cursor-pointer flex flex-col justify-end"
                      >
                        {hasLog && pLog.imageUrl && <img src={pLog.imageUrl} className="absolute inset-0 w-full h-full object-cover z-0" alt="" />}
                        <div className={`absolute top-2 left-2 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold z-10 text-white shadow-2xs ${isToday(slot.dateObj) && !hasLog ? 'bg-rose-500' : ''}`} style={{ backgroundColor: hasLog ? getDotColor(pLog) : undefined }}>{slot.dayNum}</div>
                        {hasLog && <div className="relative z-10 text-[11px] font-bold text-white bg-black/60 p-1 rounded-xs backdrop-blur-xs line-clamp-2 leading-tight">{pLog.title}</div>}
                      </div>
                      <div className="p-3 aspect-[1/2] flex flex-col overflow-hidden">
                        {hasLog && pLog.pageContent && <p className="text-[11px] text-slate-500 leading-normal whitespace-pre-wrap line-clamp-[14]">{pLog.pageContent}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-6 border overflow-x-auto bg-white border-slate-200 shadow-2xs" style={{ borderRadius: `${cardRadius}px` }}>
                <div className="min-w-[1020px] select-none">
                  <div className="grid grid-cols-[65px_1fr] items-center mb-4 border-b border-slate-100 pb-2">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 text-center">Month</div>
                    <div className="grid grid-cols-37 gap-1 text-center">
                      {Array.from({ length: 37 }).map((_, colIndex) => {
                        const weekdayStr = TIMELINE_WEEKDAYS[colIndex % 7];
                        const isWeekend = weekdayStr === 'SUN' || weekdayStr === 'SAT';
                        return <div key={colIndex} className={`text-[9px] font-black tracking-tight py-1 rounded ${isWeekend ? 'bg-rose-50 text-rose-600 font-bold border border-rose-100' : 'text-slate-400'}`}>{weekdayStr.slice(0, 2)}</div>;
                      })}
                    </div>
                  </div>
                  <div className="space-y-3.5 relative">
                    {MONTH_NAMES.map((monthLabel, mIdx) => {
                      const firstDayOfMonthObj = new Date(year, mIdx, 1);
                      const startOffsetColumn = firstDayOfMonthObj.getDay(); 
                      const daysInMonth = new Date(year, mIdx + 1, 0).getDate();
                      return (
                        <div key={monthLabel} className="grid grid-cols-[65px_1fr] items-center relative group">
                          <div onClick={() => { setCurrentDate(new Date(year, mIdx, 1)); setViewMode('month'); }} className="text-[11px] font-bold text-center tracking-wide py-1.5 w-12 rounded border bg-slate-50 border-slate-200 text-slate-600 hover:border-rose-400 hover:text-rose-600 transition-all cursor-pointer">{monthLabel}</div>
                          <div className="grid grid-cols-37 gap-1 items-center relative py-1">
                            <div className="absolute left-0 right-0 h-[1px] border-b border-dashed border-slate-200 top-1/2 -translate-y-1/2 z-0" />
                            {Array.from({ length: 37 }).map((_, colIndex) => {
                              const weekIndex = Math.floor(colIndex / 7);
                              const isHoveredWeekCell = hoveredWeek?.mIdx === mIdx && hoveredWeek?.weekIndex === weekIndex;
                              const weekdayStr = TIMELINE_WEEKDAYS[colIndex % 7];
                              const isWeekendColumn = weekdayStr === 'SUN' || weekdayStr === 'SAT';
                              const targetDayNum = colIndex - startOffsetColumn + 1;
                              const isValidCalendarDay = targetDayNum > 0 && targetDayNum <= daysInMonth;
                              const weekRoundClass = colIndex % 7 === 0 ? 'rounded-l-md -ml-1 -mr-0.5' : colIndex % 7 === 6 || colIndex === 36 ? 'rounded-r-md -ml-0.5 -mr-1' : '-mx-0.5 rounded-none';
                              const weekHighlightStyle = isHoveredWeekCell ? `bg-amber-100 border-y border-amber-300/80 z-20 ${colIndex % 7 === 0 ? 'border-l' : ''} ${colIndex % 7 === 6 || colIndex === 36 ? 'border-r' : ''}` : '';

                              if (!isValidCalendarDay) {
                                return <div key={colIndex} onClick={() => handleWeekClick(mIdx, weekIndex)} onMouseEnter={() => setHoveredWeek({ mIdx, weekIndex })} onMouseLeave={() => setHoveredWeek(null)} className={`h-6 flex items-center justify-center transition-colors cursor-pointer ${weekRoundClass} ${isHoveredWeekCell ? weekHighlightStyle : isWeekendColumn ? 'bg-rose-50/30 z-10' : 'z-10'}`} />;
                              }
                              const targetDate = new Date(year, mIdx, targetDayNum);
                              const isWeekend = targetDate.getDay() === 0 || targetDate.getDay() === 6;
                              const isStatHoliday = getOntarioStatHolidayName(targetDate) !== null;
                              const logs = getLogsForDate(targetDate);
                              const hasLog = logs.length > 0;
                              const primaryLog = hasLog ? logs[0] : null;
                              const currentDotHex = hasLog ? getDotColor(primaryLog) : 'transparent';
                              const isHoveredProject = hasLog && primaryLog && (primaryLog.Projects || 'Untitled Project') === hoveredProjectTitle;
                              
                              const slotBackground = isHoveredWeekCell ? weekHighlightStyle : isStatHoliday ? 'bg-amber-50/40' : isWeekend ? 'bg-rose-50/40' : '';
                              let dotStyles = 'border border-slate-200 bg-white text-slate-400 font-normal hover:border-slate-400 hover:text-slate-600';
                              if (hasLog) {
                                let ringClass = isStatHoliday ? 'ring-2 ring-amber-400/60' : isWeekend ? 'ring-2 ring-rose-400/50' : '';
                                if (isHoveredProject) ringClass = 'ring-2 ring-rose-500/50 scale-125 z-30';
                                dotStyles = `text-white font-bold border border-transparent shadow-xs scale-110 ${ringClass}`;
                              } else if (isStatHoliday) dotStyles = 'border border-amber-200 bg-amber-50 text-amber-500 font-medium hover:border-amber-300 hover:text-amber-700';
                              else if (isWeekend) dotStyles = 'border border-rose-200 bg-rose-50 text-rose-400 font-medium hover:border-rose-300 hover:text-rose-600';

                              return (
                                <div key={colIndex} onClick={() => handleWeekClick(mIdx, weekIndex)} onMouseEnter={() => { setHoveredWeek({ mIdx, weekIndex }); if (hasLog && primaryLog) setHoveredProjectTitle(primaryLog.Projects || 'Untitled Project'); }} onMouseLeave={() => { setHoveredWeek(null); setHoveredProjectTitle(null); }} className={`h-6 flex items-center justify-center relative cursor-pointer group/node transition-colors ${weekRoundClass} ${slotBackground}`}>
                                  <div onClick={(e) => { e.stopPropagation(); setSelectedLogModal({ dateObj: targetDate, logs }); }} className={`w-4 h-4 rounded-full flex items-center justify-center text-[8px] transition-all relative z-10 ${dotStyles} ${isToday(targetDate) ? 'ring-2 ring-rose-500 ring-offset-1 font-bold' : ''}`} style={{ backgroundColor: hasLog ? currentDotHex : undefined }}>{targetDayNum}</div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Settings Modal Setup */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs text-slate-800">
          <div className="w-full max-w-md bg-white rounded-xl shadow-xl border border-slate-200 p-6">
            <h2 className="text-lg font-bold mb-4">Widget Setup</h2>
            <p className="text-xs text-slate-500 mb-6">Enter your Notion Integration Token and Database ID to fetch your personal logs.</p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Notion Integration Token</label>
                <input 
                  type="password" 
                  value={notionToken} 
                  onChange={(e) => setNotionToken(e.target.value)} 
                  className="w-full border border-slate-300 rounded px-3 py-2 text-sm focus:border-rose-500 focus:ring-1 focus:ring-rose-500 outline-none"
                  placeholder="secret_..."
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Notion Database ID</label>
                <input 
                  type="text" 
                  value={databaseId} 
                  onChange={(e) => setDatabaseId(e.target.value)} 
                  className="w-full border border-slate-300 rounded px-3 py-2 text-sm focus:border-rose-500 focus:ring-1 focus:ring-rose-500 outline-none"
                  placeholder="3728d5a5..."
                />
              </div>
            </div>

            <div className="mt-8 flex items-center justify-end gap-3">
              <button 
                onClick={() => setShowSettings(false)} 
                className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button 
                onClick={handleSaveSettings} 
                disabled={!notionToken || !databaseId}
                className="px-4 py-2 text-sm font-bold text-white bg-rose-500 rounded hover:bg-rose-600 disabled:opacity-50 cursor-pointer shadow-xs"
              >
                Save & Sync
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Slide Modal Component */}
      {selectedLogModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs" onClick={() => setSelectedLogModal(null)}>
          <div className="w-full max-w-2xl max-h-[80vh] bg-white rounded-xl flex flex-col overflow-hidden shadow-xl border border-slate-200" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold text-rose-500 tracking-wider">
                  {selectedLogModal.dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
                {getOntarioStatHolidayName(selectedLogModal.dateObj) && (
                  <span className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200/80 px-2 py-0.5 rounded-md flex items-center gap-1 shadow-2xs">
                    <span>—</span>
                    <span>{getOntarioStatHolidayName(selectedLogModal.dateObj)}</span>
                  </span>
                )}
              </div>
              <button onClick={() => setSelectedLogModal(null)} className="text-slate-400 hover:text-slate-600 font-bold cursor-pointer">✕</button>
            </div>
            
            <div className="p-5 overflow-x-auto flex gap-4" ref={carouselRef}>
              {selectedLogModal.logs.length > 0 ? (
                selectedLogModal.logs.map((log, idx) => (
                  <div key={idx} className="shrink-0 w-[320px] p-4 border border-slate-200 rounded-xl bg-slate-50 flex flex-col gap-3 shadow-2xs">
                    {log.imageUrl && <img src={log.imageUrl} className="max-h-[180px] rounded object-contain" alt="" />}
                    <div>
                      <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 border rounded inline-block mb-1" style={{ color: getDotColor(log), borderColor: getDotColor(log) }}>{log.projectType}</span>
                      <h3 className="text-sm font-bold text-slate-800">{log.title}</h3>
                    </div>
                    {log.pageContent && <div className="text-xs text-slate-600 p-2 bg-white rounded border border-slate-150 whitespace-pre-wrap leading-normal">{log.pageContent}</div>}
                  </div>
                ))
              ) : (
                <div className="text-center py-6 w-full text-slate-400 italic text-xs">No logged actions for this target date.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;