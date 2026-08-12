import { useState, useEffect, useRef } from 'react';

// Relative imports matching your folder structure:
import timelineLogs from './data/logs.json';
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
// Weekday symbols repeating across the 37 columns to match your timeline grid layout
const TIMELINE_WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function App() {
  // -------------------------------------------------------------
  // 1. STATE: Selected Date, View Mode, Sidebar, Filtering & Modal
  // -------------------------------------------------------------
  const today = new Date(2026, 6, 20); // July 20, 2026
  const [currentDate, setCurrentDate] = useState(today);
  const [viewMode, setViewMode] = useState('year'); // Defaulting to 'year' to show your layout immediately
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [selectedProjectFilters, setSelectedProjectFilters] = useState([]); 
  const [collapsedTypes, setCollapsedTypes] = useState({}); 
  const [selectedLogModal, setSelectedLogModal] = useState(null); 
  
  const carouselRef = useRef(null);

  // Theme state dynamically driven by OS / browser preferences
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
  // 2. FIGMA TOKENS & STYLING
  // -------------------------------------------------------------
  const columns = themeTokens?.layout?.gridColumns?.$value ?? 7;
  const gap = themeTokens?.layout?.gridGap?.$value ?? 16;
  const cardRadius = themeTokens?.card?.radius?.$value ?? 6;

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
  // 3. NAVIGATION LOGIC
  // -------------------------------------------------------------
  const handlePrev = () => {
    if (viewMode === 'month') {
      setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
    } else if (viewMode === 'week') {
      const nextDate = new Date(currentDate);
      nextDate.setDate(currentDate.getDate() - 7);
      setCurrentDate(nextDate);
    } else {
      setCurrentDate(new Date(currentDate.getFullYear() - 1, currentDate.getMonth(), 1));
    }
  };

  const handleNext = () => {
    if (viewMode === 'month') {
      setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
    } else if (viewMode === 'week') {
      const nextDate = new Date(currentDate);
      nextDate.setDate(currentDate.getDate() + 7);
      setCurrentDate(nextDate);
    } else {
      setCurrentDate(new Date(currentDate.getFullYear() + 1, currentDate.getMonth(), 1));
    }
  };

  const handleJumpToToday = () => setCurrentDate(today);
  const handleSelectWeekRow = (rowStartDate) => {
    setCurrentDate(rowStartDate);
    setViewMode('week');
  };

  const handleHeaderMonthClick = (targetDate) => {
    setCurrentDate(new Date(targetDate.getFullYear(), targetDate.getMonth(), 1));
    setViewMode('month');
  };

  const handleCardClick = (dateObj) => {
    if (!dateObj) return;
    const logs = getLogsForDate(dateObj);
    setSelectedLogModal({ dateObj, logs });
  };

  const handleModalWheel = (e) => {
    if (carouselRef.current && e.deltaY !== 0) {
      e.preventDefault();
      carouselRef.current.scrollLeft += e.deltaY;
    }
  };

  // -------------------------------------------------------------
  // 4. CALENDAR DATE & PROJECT CALCULATIONS
  // -------------------------------------------------------------
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

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
        columnIndex: i % 7,
        rowIndex: Math.floor(i / 7),
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
        columnIndex: i,
        rowIndex: 0,
      });
    }
  }

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
      if (a.projectType !== b.projectType) {
        return a.projectType.localeCompare(b.projectType);
      }
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

  const rows = [];
  if (viewMode === 'month') {
    for (let i = 0; i < slots.length; i += 7) {
      rows.push(slots.slice(i, i + 7));
    }
  }

  const groupedProjects = getGroupedProjects(year);
  const toggleProjectFilter = (title) => {
    setSelectedProjectFilters((prev) => 
      prev.includes(title) ? prev.filter(t => t !== title) : [...prev, title]
    );
  };

  return (
    <div className={`min-h-screen transition-colors duration-300 p-8 ${
      isDarkMode ? 'bg-[#0B0B0C] text-white' : 'bg-slate-50 text-slate-900'
    }`}>
      <div className="max-w-[1600px] mx-auto">
        
        {/* Header & Controls */}
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            {viewMode === 'month' ? (
              <h1 className={`text-2xl font-bold tracking-tight inline-flex items-center gap-2 ${
                isDarkMode ? 'text-zinc-100' : 'text-slate-800'
              }`}>
                <span>{currentDate.toLocaleDateString('en-US', { month: 'long' })}</span>
                <button onClick={() => setViewMode('year')} className="hover:text-rose-500 transition-colors cursor-pointer underline decoration-dotted underline-offset-4">
                  {currentDate.getFullYear()}
                </button>
              </h1>
            ) : viewMode === 'week' ? (
              <h1 className={`text-2xl font-bold tracking-tight flex items-center gap-1.5 ${
                isDarkMode ? 'text-zinc-100' : 'text-slate-800'
              }`}>
                <button onClick={() => handleHeaderMonthClick(startOfWeek)} className="hover:underline hover:text-rose-500 transition-colors cursor-pointer">
                  {startOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </button>
                <span>–</span>
                <span>{endOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })},</span>
                <button onClick={() => setViewMode('year')} className="hover:underline hover:text-rose-500 transition-colors cursor-pointer text-rose-500">
                  {endOfWeek.getFullYear()}
                </button>
              </h1>
            ) : (
              <h1 className={`text-2xl font-bold tracking-tight ${isDarkMode ? 'text-zinc-100' : 'text-slate-800'}`}>
                <span className="text-rose-500">{year}</span> Projects Overview
              </h1>
            )}
            <p className={`text-sm mt-1 ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>
              Driven by Figma Tokens & Notion Data.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className={`px-3 py-1 text-xs font-semibold border rounded-md transition-colors cursor-pointer flex items-center gap-1.5 ${
                isSidebarOpen 
                  ? isDarkMode ? 'bg-zinc-800 border-zinc-700 text-white' : 'bg-slate-200 border-slate-300 text-slate-800'
                  : isDarkMode ? 'bg-zinc-900 border-zinc-800 text-zinc-400' : 'bg-white border-slate-300 text-slate-600'
              }`}
            >
              <span>📁</span>
              <span>{isSidebarOpen ? 'Hide Projects' : 'Projects'}</span>
            </button>

            <button
              onClick={handleJumpToToday}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer flex items-center gap-1.5 ${
                isDarkMode 
                  ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30 hover:bg-rose-500/20' 
                  : 'bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
              Today
            </button>

            <div className={`flex items-center p-0.5 rounded-lg border ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-200 border-slate-300'}`}>
              <button onClick={() => setViewMode('month')} className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${viewMode === 'month' ? (isDarkMode ? 'bg-zinc-800 text-white shadow' : 'bg-white text-slate-900 shadow-sm') : (isDarkMode ? 'text-zinc-400 hover:text-white' : 'text-slate-600 hover:text-slate-900')}`}>Month</button>
              <button onClick={() => setViewMode('week')} className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${viewMode === 'week' ? (isDarkMode ? 'bg-zinc-800 text-white shadow' : 'bg-white text-slate-900 shadow-sm') : (isDarkMode ? 'text-zinc-400 hover:text-white' : 'text-slate-600 hover:text-slate-900')}`}>Week</button>
              <button onClick={() => setViewMode('year')} className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${viewMode === 'year' ? (isDarkMode ? 'bg-zinc-800 text-white shadow' : 'bg-white text-slate-900 shadow-sm') : (isDarkMode ? 'text-zinc-400 hover:text-white' : 'text-slate-600 hover:text-slate-900')}`}>Year</button>
            </div>

            <div className="flex items-center gap-1.5">
              <button onClick={handlePrev} className={`px-3 py-1.5 text-xs font-semibold border rounded-md transition-colors cursor-pointer ${isDarkMode ? 'bg-zinc-900 border-zinc-800 hover:bg-zinc-800 text-white' : 'bg-white border-slate-300 hover:bg-slate-100 text-slate-700'}`}>← Prev</button>
              <button onClick={handleNext} className={`px-3 py-1.5 text-xs font-semibold border rounded-md transition-colors cursor-pointer ${isDarkMode ? 'bg-zinc-900 border-zinc-800 hover:bg-zinc-800 text-white' : 'bg-white border-slate-300 hover:bg-slate-100 text-slate-700'}`}>Next →</button>
            </div>
          </div>
        </header>

        {/* Layout Split */}
        <div className={`grid grid-cols-1 ${isSidebarOpen ? 'lg:grid-cols-12' : ''} gap-8 items-start`}>
          
          {/* Sidebar */}
          {isSidebarOpen && (
            <div className={`lg:col-span-3 p-6 rounded-xl border flex flex-col ${isDarkMode ? 'bg-zinc-900/80 border-zinc-800' : 'bg-white border-slate-200 shadow-sm'}`} style={{ borderRadius: `${cardRadius}px` }}>
              <div className="flex items-center justify-between mb-4">
                <h2 className={`text-sm font-bold flex items-center gap-2 ${isDarkMode ? 'text-zinc-100' : 'text-slate-800'}`}>
                  <span>Categories</span>
                </h2>
                {selectedProjectFilters.length > 0 && (
                  <button onClick={() => setSelectedProjectFilters([])} className="px-2 py-0.5 text-[10px] bg-rose-500 text-white rounded">Clear ✕</button>
                )}
              </div>
              
              <div className="space-y-2 max-h-[70vh] overflow-y-auto">
                {Object.entries(groupedProjects).map(([type, projs]) => (
                  <div key={type} className="border rounded-md p-2 dark:border-zinc-800">
                    <div className="text-[11px] font-bold uppercase tracking-wider mb-1.5 text-zinc-400 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: projs[0]?.projectTypeColor && NOTION_COLOR_MAP[projs[0].projectTypeColor] ? NOTION_COLOR_MAP[projs[0].projectTypeColor] : '#555' }} />
                      {type}
                    </div>
                    <div className="space-y-1">
                      {projs.map((p, i) => {
                        const active = selectedProjectFilters.includes(p.title);
                        return (
                          <div 
                            key={i} 
                            onClick={() => toggleProjectFilter(p.title)}
                            className={`text-xs p-2 rounded cursor-pointer border transition-all ${active ? 'bg-rose-500/20 border-rose-500 text-white' : 'bg-zinc-500/5 border-transparent hover:border-zinc-700'}`}
                          >
                            {p.title}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Main Grid content panel */}
          <div className={isSidebarOpen ? 'lg:col-span-9' : 'w-full'}>
            
            {/* Weekday Row Header (for Standard Month/Week Layouts) */}
            {viewMode !== 'year' && (
              <div className={`grid mb-3 text-center text-xs font-semibold uppercase tracking-wider ${viewMode === 'month' ? 'pl-8' : ''}`} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: `${gap}px` }}>
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => (
                  <div key={day} className={idx === 0 || idx === 6 ? 'text-rose-500 font-bold' : 'text-zinc-500'}>{day}</div>
                ))}
              </div>
            )}

            {viewMode === 'month' ? (
              <div className="flex flex-col" style={{ gap: `${gap}px` }}>
                {rows.map((rowSlots, rowIndex) => {
                  const firstValid = rowSlots.find((s) => s.isValid && s.dateObj);
                  return (
                    <div key={rowIndex} className="relative flex items-start group/row">
                      <button onClick={() => handleSelectWeekRow(firstValid ? firstValid.dateObj : currentDate)} className={`absolute -left-7 top-0 w-5 h-16 rounded-l-md flex items-center justify-center text-[10px] font-bold ${isDarkMode ? 'bg-zinc-800 text-zinc-400' : 'bg-slate-200 text-slate-600'}`}>›</button>
                      <div className="grid w-full" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: `${gap}px` }}>
                        {rowSlots.map((slot, slotIndex) => {
                          if (!slot.isValid) return <div key={slotIndex} className="aspect-[3/4] opacity-10 bg-zinc-900/20" />;
                          const logs = getLogsForDate(slot.dateObj);
                          const hasLog = logs.length > 0;
                          const pLog = logs[0];
                          return (
                            <div key={slotIndex} onClick={() => handleCardClick(slot.dateObj)} className={`relative aspect-[3/4] overflow-hidden p-3 border cursor-pointer flex flex-col justify-end ${isToday(slot.dateObj) ? 'ring-2 ring-rose-500' : ''} ${hasLog ? 'bg-zinc-900 border-zinc-700' : 'bg-zinc-950/20 border-zinc-900/40 opacity-40'}`} style={{ borderRadius: `${cardRadius}px` }}>
                              {hasLog && pLog.imageUrl && <img src={pLog.imageUrl} className="absolute inset-0 w-full h-full object-cover opacity-40" alt="" />}
                              <div className="absolute top-2 left-2 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold" style={{ backgroundColor: getDotColor(pLog) }}>{slot.dayNum}</div>
                              {hasLog && <div className="relative text-[11px] font-bold text-white line-clamp-2 leading-tight">{pLog.title}</div>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : viewMode === 'week' ? (
              <div className="grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: `${gap}px` }}>
                {slots.map((slot, index) => {
                  const logs = getLogsForDate(slot.dateObj);
                  const hasLog = logs.length > 0;
                  const pLog = logs[0];
                  return (
                    <div key={index} className="flex flex-col gap-2">
                      <div onClick={() => handleCardClick(slot.dateObj)} className={`relative aspect-[3/4] overflow-hidden p-3 border cursor-pointer flex flex-col justify-end ${hasLog ? 'bg-zinc-900 border-zinc-700' : 'bg-zinc-950/20'}`} style={{ borderRadius: `${cardRadius}px` }}>
                        <div className="absolute top-2 left-2 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold" style={{ backgroundColor: getDotColor(pLog) }}>{slot.dayNum}</div>
                        {hasLog && <div className="relative text-[11px] font-bold text-white line-clamp-1">{pLog.title}</div>}
                      </div>
                      {hasLog && pLog.pageContent && <div className="text-[11px] p-2 bg-zinc-900/40 rounded border border-zinc-800 text-zinc-400 whitespace-pre-wrap">{pLog.pageContent}</div>}
                    </div>
                  );
                })}
              </div>
            ) : (
              /* ----------------------------------------------------------------------------------- */
              /* AUTOMATED YEAR TRACKER MATRIX: CHRONOLOGICAL TIMELINE STREAM GRID (FROM PDF DESIGN)  */
              /* ----------------------------------------------------------------------------------- */
              <div className={`p-6 border overflow-x-auto ${isDarkMode ? 'bg-zinc-900/40 border-zinc-800' : 'bg-white border-slate-200 shadow-xs'}`} style={{ borderRadius: `${cardRadius}px` }}>
                <div className="min-w-[1020px] select-none">
                  
                  {/* Master 37-Column Absolute Weekday Header Track */}
                  <div className="grid grid-cols-[65px_1fr] items-center mb-6 border-b pb-2 dark:border-zinc-800">
                    <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500 text-center">Month</div>
                    <div className="grid grid-cols-37 gap-1 text-center">
                      {Array.from({ length: 37 }).map((_, colIndex) => {
                        const weekdayStr = TIMELINE_WEEKDAYS[colIndex % 7];
                        const isWeekend = weekdayStr === 'SUN' || weekdayStr === 'SAT';
                        return (
                          <div 
                            key={colIndex} 
                            className={`text-[9px] font-black tracking-tighter py-1 rounded transition-colors ${
                              isWeekend 
                                ? isDarkMode ? 'bg-rose-950/40 text-rose-400' : 'bg-rose-50 text-rose-600' 
                                : 'text-zinc-400 dark:text-zinc-500'
                            }`}
                          >
                            {weekdayStr.slice(0, 2)}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Horizontal Continuous Month Streams */}
                  <div className="space-y-4 relative">
                    {MONTH_NAMES.map((monthLabel, mIdx) => {
                      const firstDayOfMonthObj = new Date(year, mIdx, 1);
                      // Start weekday offset defines exactly which absolute matrix column Day 1 drops into
                      const startOffsetColumn = firstDayOfMonthObj.getDay(); 
                      const daysInMonth = new Date(year, mIdx + 1, 0).getDate();

                      return (
                        <div key={monthLabel} className="grid grid-cols-[65px_1fr] items-center relative group">
                          
                          {/* Left Sticky Month Handle Row Label */}
                          <div 
                            onClick={() => {
                              setCurrentDate(new Date(year, mIdx, 1));
                              setViewMode('month');
                            }}
                            className={`text-[11px] font-black text-center tracking-wider py-2 w-12 rounded-md border cursor-pointer transition-all ${
                              isDarkMode 
                                ? 'bg-zinc-950/60 border-zinc-800 text-zinc-300 hover:border-rose-500 hover:text-rose-400' 
                                : 'bg-slate-100 border-slate-200 text-slate-700 hover:border-rose-400 hover:bg-rose-50 hover:text-rose-600'
                            }`}
                          >
                            {monthLabel}
                          </div>

                          {/* Linear 37-Slot Matrix Grid Container */}
                          <div className="grid grid-cols-37 gap-1 items-center relative py-1">
                            
                            {/* Horizontal continuous timeline guide wire connecting the data track */}
                            <div className="absolute left-0 right-0 h-[1px] border-b border-dashed border-zinc-300 dark:border-zinc-800/80 top-1/2 -translate-y-1/2 z-0" />

                            {Array.from({ length: 37 }).map((_, colIndex) => {
                              // Calculate if a numeric calendar day sits inside this specific absolute cell position
                              const targetDayNum = colIndex - startOffsetColumn + 1;
                              const isValidCalendarDay = targetDayNum > 0 && targetDayNum <= daysInMonth;

                              if (!isValidCalendarDay) {
                                return <div key={colIndex} className="w-5 h-5 z-10" />;
                              }

                              const targetDate = new Date(year, mIdx, targetDayNum);
                              const logs = getLogsForDate(targetDate);
                              const hasLog = logs.length > 0;
                              const primaryLog = hasLog ? logs[0] : null;
                              const currentDotHex = hasLog ? getDotColor(primaryLog) : 'transparent';
                              const currentIsToday = isToday(targetDate);

                              return (
                                <div
                                  key={colIndex}
                                  onClick={() => handleCardClick(targetDate)}
                                  className="w-5 h-5 flex items-center justify-center relative z-10 cursor-pointer group/node"
                                  title={`${monthLabel} ${targetDayNum}, ${year}${hasLog ? `: ${primaryLog.title}` : ''}`}
                                >
                                  {/* Automated interactive habit dot matching the PDF matrix layout style */}
                                  <div
                                    className={`w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-mono font-bold tracking-tighter border transition-all ${
                                      hasLog 
                                        ? 'text-white border-transparent shadow-xs scale-110 group-hover/node:scale-125' 
                                        : isDarkMode
                                          ? 'border-zinc-700 bg-zinc-900 text-zinc-500 hover:border-zinc-400 hover:text-zinc-300'
                                          : 'border-slate-300 bg-white text-slate-400 hover:border-slate-500 hover:text-slate-700'
                                    } ${currentIsToday ? 'ring-2 ring-rose-500 ring-offset-2 dark:ring-offset-zinc-900' : ''}`}
                                    style={{ backgroundColor: currentDotHex }}
                                  >
                                    {targetDayNum}
                                  </div>

                                  {/* Multiple overlapping task indicator overlay */}
                                  {logs.length > 1 && (
                                    <span className="absolute -top-1 -right-1 flex h-2 w-2 items-center justify-center rounded-full bg-black text-[6px] font-black text-rose-400 border border-zinc-800">
                                      +
                                    </span>
                                  )}
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

      {/* Log Modal with Horizontal Carousel Deck Support */}
      {selectedLogModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs" onClick={() => setSelectedLogModal(null)}>
          <div className={`w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl border ${isDarkMode ? 'bg-zinc-900 text-white border-zinc-800' : 'bg-white text-slate-900 border-slate-200'}`} style={{ borderRadius: `${cardRadius * 2}px` }} onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b dark:border-zinc-800 flex items-center justify-between">
              <span className="text-xs font-bold text-rose-500 uppercase tracking-widest">{selectedLogModal.dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}</span>
              <button onClick={() => setSelectedLogModal(null)} className="text-zinc-400 hover:text-white">✕</button>
            </div>
            <div className="p-6 overflow-x-auto flex-1 flex gap-4" ref={carouselRef} onWheel={handleModalWheel}>
              {selectedLogModal.logs.length > 0 ? (
                selectedLogModal.logs.map((log, idx) => (
                  <div key={idx} className={`shrink-0 w-[380px] p-5 border rounded-xl flex flex-col gap-3 ${isDarkMode ? 'bg-zinc-950 border-zinc-800' : 'bg-slate-50 border-slate-200'}`}>
                    {log.imageUrl && <img src={log.imageUrl} className="max-h-[220px] w-auto mx-auto object-contain rounded" alt="" />}
                    <div>
                      <span className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 border rounded inline-block font-bold mb-1" style={{ color: getDotColor(log), borderColor: getDotColor(log) }}>{log.projectType}</span>
                      <h3 className="text-base font-bold">{log.title}</h3>
                    </div>
                    {log.pageContent && <div className="text-xs leading-relaxed dark:text-zinc-400 p-2.5 rounded bg-zinc-900/40 border dark:border-zinc-800/80 whitespace-pre-wrap">{log.pageContent}</div>}
                  </div>
                ))
              ) : (
                <div className="text-center py-8 w-full text-zinc-500 italic text-xs">No project events or timeline logs submitted for this day.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;