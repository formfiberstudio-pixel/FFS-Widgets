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

function App() {
  // -------------------------------------------------------------
  // 1. STATE: Selected Date, View Mode, Modal & System Theme
  // -------------------------------------------------------------
  const today = new Date(2026, 6, 20); // July 20, 2026
  const [currentDate, setCurrentDate] = useState(today);
  const [viewMode, setViewMode] = useState('month'); // 'month' | 'week' | 'year'
  const [selectedLogModal, setSelectedLogModal] = useState(null); // Holds dateObj and matching logs
  
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
    setSelectedLogModal({
      dateObj,
      logs: logs,
    });
  };

  // Mouse wheel listener to scroll horizontally through modal cards
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
        return (
          Number(log.year) === targetYear &&
          Number(log.monthNumber) === targetMonth &&
          Number(log.dayNumber) === targetDay
        );
      }
      return false;
    });
  };

  const getYearProjects = (targetYear) => {
    if (!Array.isArray(timelineLogs)) return [];
    const yearLogs = timelineLogs.filter(log => Number(log.year) === targetYear);
    
    const projectMap = {};
    yearLogs.forEach(log => {
      const key = log.title + '::' + (log.projectType || 'General');
      const logDate = new Date(Number(log.year), Number(log.monthNumber) - 1, Number(log.dayNumber));
      if (!projectMap[key]) {
        projectMap[key] = {
          title: log.title,
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

  const rows = [];
  if (viewMode === 'month') {
    for (let i = 0; i < slots.length; i += 7) {
      rows.push(slots.slice(i, i + 7));
    }
  }

  // -------------------------------------------------------------
  // 5. RENDER
  // -------------------------------------------------------------
  return (
    <div className={`min-h-screen transition-colors duration-300 p-8 ${
      isDarkMode ? 'bg-[#0B0B0C] text-white' : 'bg-slate-50 text-slate-900'
    }`}>
      <div className="max-w-[1600px] mx-auto">
        
        {/* Header & Controls */}
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            {viewMode === 'month' ? (
              <h1 
                onClick={() => setViewMode('year')}
                className={`text-2xl font-bold tracking-tight cursor-pointer hover:text-rose-500 transition-colors inline-block`}
                title="Click to view annual habit tracker"
              >
                {currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              </h1>
            ) : viewMode === 'week' ? (
              <h1 className={`text-2xl font-bold tracking-tight flex items-center gap-1.5 ${
                isDarkMode ? 'text-zinc-100' : 'text-slate-800'
              }`}>
                <button
                  onClick={() => handleHeaderMonthClick(startOfWeek)}
                  className="hover:underline hover:text-rose-500 transition-colors cursor-pointer"
                  title="Switch to month view"
                >
                  {startOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </button>
                <span>–</span>
                <span>{endOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, {endOfWeek.getFullYear()}</span>
              </h1>
            ) : (
              <h1 className={`text-2xl font-bold tracking-tight ${
                isDarkMode ? 'text-zinc-100' : 'text-slate-800'
              }`}>
                {year} Projects
              </h1>
            )}
            <p className={`text-sm mt-1 ${
              isDarkMode ? 'text-zinc-500' : 'text-slate-500'
            }`}>
              Driven by Figma Tokens & Notion Data.
            </p>
          </div>

          <div className="flex items-center gap-3">
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

            <div className={`flex items-center p-0.5 rounded-lg border ${
              isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-slate-200 border-slate-300'
            }`}>
              <button
                onClick={() => setViewMode('month')}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                  viewMode === 'month'
                    ? isDarkMode ? 'bg-zinc-800 text-white shadow' : 'bg-white text-slate-900 shadow-sm'
                    : isDarkMode ? 'text-zinc-400 hover:text-white' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Month
              </button>
              <button
                onClick={() => setViewMode('week')}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                  viewMode === 'week'
                    ? isDarkMode ? 'bg-zinc-800 text-white shadow' : 'bg-white text-slate-900 shadow-sm'
                    : isDarkMode ? 'text-zinc-400 hover:text-white' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Week
              </button>
              <button
                onClick={() => setViewMode('year')}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                  viewMode === 'year'
                    ? isDarkMode ? 'bg-zinc-800 text-white shadow' : 'bg-white text-slate-900 shadow-sm'
                    : isDarkMode ? 'text-zinc-400 hover:text-white' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Year
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={handlePrev}
                className={`px-3 py-1.5 text-xs font-semibold border rounded-md transition-colors cursor-pointer ${
                  isDarkMode 
                    ? 'bg-zinc-900 border-zinc-800 hover:bg-zinc-800 text-white' 
                    : 'bg-white border-slate-300 hover:bg-slate-100 text-slate-700'
                }`}
              >
                ← Prev
              </button>
              <button
                onClick={handleNext}
                className={`px-3 py-1.5 text-xs font-semibold border rounded-md transition-colors cursor-pointer ${
                  isDarkMode 
                    ? 'bg-zinc-900 border-zinc-800 hover:bg-zinc-800 text-white' 
                    : 'bg-white border-slate-300 hover:bg-slate-100 text-slate-700'
                }`}
              >
                Next →
              </button>
            </div>
          </div>
        </header>

        {/* Weekday Column Headers (for Month/Week views) */}
        {viewMode !== 'year' && (
          <div
            className={`grid mb-3 text-center text-xs font-semibold uppercase tracking-wider ${
              viewMode === 'month' ? 'pl-8' : ''
            }`}
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: `${gap}px` }}
          >
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => {
              const isWeekend = idx === 0 || idx === 6;
              return (
                <div
                  key={day}
                  className={
                    isWeekend
                      ? isDarkMode ? 'text-rose-400/80 font-bold' : 'text-rose-600 font-bold'
                      : isDarkMode ? 'text-zinc-500' : 'text-slate-400'
                  }
                >
                  {day}
                </div>
              );
            })}
          </div>
        )}

        {/* Calendar Layout */}
        {viewMode === 'month' ? (
          <div className="flex flex-col" style={{ gap: `${gap}px` }}>
            {rows.map((rowSlots, rowIndex) => {
              const firstValidSlotInRow = rowSlots.find((s) => s.isValid && s.dateObj);
              const rowStartDate = firstValidSlotInRow ? firstValidSlotInRow.dateObj : currentDate;

              return (
                <div key={rowIndex} className="relative flex items-start group/row">
                  <button
                    onClick={() => handleSelectWeekRow(rowStartDate)}
                    title="Switch to this week's view"
                    className={`absolute -left-7 top-0 w-5 h-16 rounded-l-md flex items-center justify-center text-[10px] font-bold transition-all opacity-30 group-hover/row:opacity-100 cursor-pointer ${
                      isDarkMode
                        ? 'bg-zinc-800/80 text-zinc-400 hover:bg-rose-500 hover:text-white border-y border-l border-zinc-700'
                        : 'bg-slate-200 text-slate-600 hover:bg-rose-600 hover:text-white border-y border-l border-slate-300'
                    }`}
                  >
                    ›
                  </button>

                  <div
                    className="grid w-full transition-all duration-300"
                    style={{
                      gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                      gap: `${gap}px`,
                    }}
                  >
                    {rowSlots.map((slot, slotIndex) => {
                      const isWeekend = slot.columnIndex === 0 || slot.columnIndex === 6;

                      if (!slot.isValid) {
                        return (
                          <div
                            key={slotIndex}
                            className={`aspect-[3/4] border border-transparent rounded-md ${
                              isWeekend 
                                ? isDarkMode ? 'bg-zinc-900/20' : 'bg-slate-200/30' 
                                : 'opacity-10'
                            }`}
                          />
                        );
                      }

                      const logs = getLogsForDate(slot.dateObj);
                      const hasLog = logs.length > 0;
                      const primaryLog = hasLog ? logs[0] : null;
                      const isCurrentToday = isToday(slot.dateObj);

                      const title = primaryLog?.title || 'Untitled Log';
                      const projectType = primaryLog?.projectType || 'General';
                      const imageUrl = primaryLog?.imageUrl;
                      const dotHex = hasLog ? getDotColor(primaryLog) : (isDarkMode ? '#27272A' : '#E4E4E7');

                      return (
                        <div
                          key={slotIndex}
                          onClick={() => handleCardClick(slot.dateObj)}
                          className={`relative aspect-[3/4] overflow-hidden group flex flex-col justify-end p-4 border transition-all duration-300 cursor-pointer ${
                            isCurrentToday ? 'ring-2 ring-rose-500 shadow-rose-500/10' : ''
                          } ${
                            hasLog
                              ? isDarkMode
                                ? 'bg-zinc-900/80 border-zinc-700/80 hover:border-zinc-500 hover:scale-[1.02] shadow-lg'
                                : 'bg-white border-slate-200 hover:border-slate-400 hover:scale-[1.02] shadow-sm text-slate-900'
                              : isWeekend
                                ? isDarkMode ? 'bg-zinc-900/30 border-zinc-900/80 hover:border-zinc-700 opacity-40 hover:opacity-80' : 'bg-slate-200/40 border-slate-200/80 hover:border-slate-300 opacity-60 hover:opacity-100'
                                : isDarkMode ? 'bg-zinc-950/40 border-zinc-900/60 hover:border-zinc-700 opacity-30 hover:opacity-70' : 'bg-slate-100/60 border-slate-200/50 hover:border-slate-300 opacity-40 hover:opacity-90'
                          }`}
                          style={{ borderRadius: `${cardRadius}px` }}
                        >
                          {hasLog && imageUrl && (
                            <img
                              src={imageUrl}
                              alt={title}
                              className={`absolute inset-0 w-full h-full object-cover z-0 group-hover:scale-105 transition-transform duration-500 ease-out ${
                                isDarkMode ? 'opacity-60' : 'opacity-85'
                              }`}
                            />
                          )}

                          {hasLog && (
                            <div className={`absolute inset-0 z-10 ${
                              isDarkMode 
                                ? 'bg-gradient-to-t from-black via-black/40 to-transparent' 
                                : 'bg-gradient-to-t from-slate-900/90 via-slate-900/30 to-transparent'
                            }`} />
                          )}

                          <div className="absolute top-3 left-3 flex items-center gap-1.5 z-20">
                            <div
                              className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs shadow-md ${
                                hasLog ? 'text-black' : isDarkMode ? 'text-zinc-400' : 'text-slate-600'
                              }`}
                              style={{ backgroundColor: dotHex }}
                            >
                              {slot.dayNum}

                              {isCurrentToday && (
                                <span className={`absolute -top-1 -right-1 w-3 h-3 bg-rose-500 rounded-full border-2 ${
                                  isDarkMode ? 'border-[#0B0B0C]' : 'border-white'
                                }`} />
                              )}
                            </div>

                            {logs.length > 1 && (
                              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-black/70 text-rose-400 border border-zinc-700 backdrop-blur-sm">
                                +{logs.length - 1}
                              </span>
                            )}
                          </div>

                          {hasLog && (
                            <div className="relative z-20">
                              <span
                                className="text-[9px] font-semibold tracking-widest uppercase px-1.5 py-0.5 rounded border inline-block mb-1.5 bg-black/60 text-white border-zinc-700/60 backdrop-blur-sm"
                                style={{ borderLeftColor: dotHex, borderLeftWidth: '3px' }}
                              >
                                {projectType}
                              </span>
                              <h3 className="text-sm font-bold text-white tracking-tight leading-snug drop-shadow-md line-clamp-2">
                                {title}
                              </h3>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ) : viewMode === 'week' ? (
          <div
            className="grid transition-all duration-300"
            style={{
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              gap: `${gap}px`,
            }}
          >
            {slots.map((slot, index) => {
              const isWeekend = slot.columnIndex === 0 || slot.columnIndex === 6;
              const logs = getLogsForDate(slot.dateObj);
              const hasLog = logs.length > 0;
              const primaryLog = hasLog ? logs[0] : null;
              const isCurrentToday = isToday(slot.dateObj);

              const title = primaryLog?.title || 'Untitled Log';
              const projectType = primaryLog?.projectType || 'General';
              const imageUrl = primaryLog?.imageUrl;
              const dotHex = hasLog ? getDotColor(primaryLog) : (isDarkMode ? '#27272A' : '#E4E4E7');

              return (
                <div
                  key={index}
                  onClick={() => handleCardClick(slot.dateObj)}
                  className={`relative aspect-[3/4] overflow-hidden group flex flex-col justify-end p-4 border transition-all duration-300 cursor-pointer ${
                    isCurrentToday ? 'ring-2 ring-rose-500 shadow-rose-500/10' : ''
                  } ${
                    hasLog
                      ? isDarkMode
                        ? 'bg-zinc-900/80 border-zinc-700/80 hover:border-zinc-500 hover:scale-[1.02] shadow-lg'
                        : 'bg-white border-slate-200 hover:border-slate-400 hover:scale-[1.02] shadow-sm text-slate-900'
                      : isWeekend
                        ? isDarkMode ? 'bg-zinc-900/30 border-zinc-900/80 hover:border-zinc-700 opacity-40 hover:opacity-80' : 'bg-slate-200/40 border-slate-200/80 hover:border-slate-300 opacity-60 hover:opacity-100'
                        : isDarkMode ? 'bg-zinc-950/40 border-zinc-900/60 hover:border-zinc-700 opacity-30 hover:opacity-70' : 'bg-slate-100/60 border-slate-200/50 hover:border-slate-300 opacity-40 hover:opacity-90'
                  }`}
                  style={{ borderRadius: `${cardRadius}px` }}
                >
                  {hasLog && imageUrl && (
                    <img
                      src={imageUrl}
                      alt={title}
                      className={`absolute inset-0 w-full h-full object-cover z-0 group-hover:scale-105 transition-transform duration-500 ease-out ${
                        isDarkMode ? 'opacity-60' : 'opacity-85'
                      }`}
                    />
                  )}

                  {hasLog && (
                    <div className={`absolute inset-0 z-10 ${
                      isDarkMode 
                        ? 'bg-gradient-to-t from-black via-black/40 to-transparent' 
                        : 'bg-gradient-to-t from-slate-900/90 via-slate-900/30 to-transparent'
                    }`} />
                  )}

                  <div className="absolute top-3 left-3 flex items-center gap-1.5 z-20">
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs shadow-md ${
                        hasLog ? 'text-black' : isDarkMode ? 'text-zinc-400' : 'text-slate-600'
                      }`}
                      style={{ backgroundColor: dotHex }}
                    >
                      {slot.dayNum}

                      {isCurrentToday && (
                        <span className={`absolute -top-1 -right-1 w-3 h-3 bg-rose-500 rounded-full border-2 ${
                          isDarkMode ? 'border-[#0B0B0C]' : 'border-white'
                        }`} />
                      )}
                    </div>

                    {logs.length > 1 && (
                      <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-black/70 text-rose-400 border border-zinc-700 backdrop-blur-sm">
                        +{logs.length - 1}
                      </span>
                    )}
                  </div>

                  {hasLog && (
                    <div className="relative z-20">
                      <span
                        className="text-[9px] font-semibold tracking-widest uppercase px-1.5 py-0.5 rounded border inline-block mb-1.5 bg-black/60 text-white border-zinc-700/60 backdrop-blur-sm"
                        style={{ borderLeftColor: dotHex, borderLeftWidth: '3px' }}
                      >
                        {projectType}
                      </span>
                      <h3 className="text-sm font-bold text-white tracking-tight leading-snug drop-shadow-md line-clamp-2">
                        {title}
                      </h3>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          /* ------------------------------------------------------------- */
          /* ANNUAL HABIT TRACKER & PROJECT LIST VIEW                       */
          /* ------------------------------------------------------------- */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            
            {/* Left Side: Projects List */}
            <div className={`lg:col-span-4 p-6 rounded-xl border ${
              isDarkMode ? 'bg-zinc-900/80 border-zinc-800' : 'bg-white border-slate-200 shadow-sm'
            }`} style={{ borderRadius: `${cardRadius}px` }}>
              <h2 className={`text-base font-bold mb-4 flex items-center justify-between ${
                isDarkMode ? 'text-zinc-100' : 'text-slate-800'
              }`}>
                <span>Projects ({year})</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  isDarkMode ? 'bg-zinc-800 text-zinc-400' : 'bg-slate-100 text-slate-600'
                }`}>
                  {getYearProjects(year).length} total
                </span>
              </h2>
              
              <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
                {getYearProjects(year).length > 0 ? (
                  getYearProjects(year).map((proj, idx) => {
                    const dotHex = proj.projectTypeColor && NOTION_COLOR_MAP[proj.projectTypeColor] 
                      ? NOTION_COLOR_MAP[proj.projectTypeColor] 
                      : (themeTokens?.colour?.dot?.[proj.projectType]?.$value?.hex || '#3F3F46');
                    
                    return (
                      <div key={idx} className={`p-3 rounded-lg border transition-all ${
                        isDarkMode ? 'bg-zinc-950/50 border-zinc-800 hover:border-zinc-700' : 'bg-slate-50 border-slate-200 hover:border-slate-300'
                      }`}>
                        <div className="flex items-center gap-2 mb-1">
                          <span 
                            className="w-2.5 h-2.5 rounded-full shrink-0" 
                            style={{ backgroundColor: dotHex }} 
                          />
                          <span className="text-[10px] font-semibold tracking-wider uppercase opacity-70">
                            {proj.projectType}
                          </span>
                          <span className="ml-auto text-[10px] opacity-50">
                            Started {proj.startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </span>
                        </div>
                        <h3 className={`text-sm font-bold ${isDarkMode ? 'text-zinc-200' : 'text-slate-800'}`}>
                          {proj.title}
                        </h3>
                      </div>
                    );
                  })
                ) : (
                  <p className={`text-xs italic py-8 text-center ${isDarkMode ? 'text-zinc-500' : 'text-slate-400'}`}>
                    No projects recorded for {year}.
                  </p>
                )}
              </div>
            </div>

            {/* Right Side: Annual Habit Habit Grid */}
            <div className={`lg:col-span-8 p-6 rounded-xl border overflow-x-auto ${
              isDarkMode ? 'bg-zinc-900/80 border-zinc-800' : 'bg-white border-slate-200 shadow-sm'
            }`} style={{ borderRadius: `${cardRadius}px` }}>
              <div className="min-w-[850px]">
                {/* Days Header 1 to 31 */}
                <div className="flex items-center mb-4 pb-2 border-b border-zinc-700/30 text-[11px] font-mono opacity-60">
                  <div className="w-12 shrink-0 font-bold uppercase">Mo</div>
                  <div className="flex-1 grid text-center" style={{ gridTemplateColumns: 'repeat(31, minmax(0, 1fr))' }}>
                    {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                      <div key={d} className="truncate">{d}</div>
                    ))}
                  </div>
                </div>

                {/* Months Rows 01 to 12 */}
                <div className="space-y-3.5">
                  {Array.from({ length: 12 }, (_, mIdx) => {
                    const monthNum = mIdx + 1;
                    const monthStr = String(monthNum).padStart(2, '0');
                    const daysInMonth = new Date(year, monthNum, 0).getDate();

                    return (
                      <div key={monthNum} className="flex items-center group">
                        {/* Month Badge */}
                        <div className={`w-12 h-8 rounded flex items-center justify-center font-bold text-xs shrink-0 mr-3 border ${
                          isDarkMode ? 'bg-zinc-800 border-zinc-700 text-zinc-200' : 'bg-slate-100 border-slate-200 text-slate-700'
                        }`}>
                          {monthStr}
                        </div>

                        {/* 31 Day Slots */}
                        <div className="flex-1 grid items-center" style={{ gridTemplateColumns: 'repeat(31, minmax(0, 1fr))' }}>
                          {Array.from({ length: 31 }, (_, dIdx) => {
                            const dayNum = dIdx + 1;
                            const isValidDay = dayNum <= daysInMonth;

                            if (!isValidDay) {
                              return <div key={dIdx} className="w-3.5 h-3.5 mx-auto opacity-10">·</div>;
                            }

                            const dateObj = new Date(year, mIdx, dayNum);
                            const logs = getLogsForDate(dateObj);
                            const hasLog = logs.length > 0;
                            const primaryLog = hasLog ? logs[0] : null;
                            const dotHex = hasLog ? getDotColor(primaryLog) : (isDarkMode ? '#3F3F46' : '#D4D4D8');

                            return (
                              <div 
                                key={dIdx} 
                                onClick={() => handleCardClick(dateObj)}
                                className="flex justify-center cursor-pointer group/dot relative py-1"
                                title={`${monthStr}/${dayNum}/${year}${hasLog ? `: ${primaryLog.title}` : ''}`}
                              >
                                <div 
                                  className={`w-3.5 h-3.5 rounded-full transition-transform hover:scale-125 flex items-center justify-center ${
                                    hasLog ? 'shadow-sm' : 'border border-dashed opacity-40'
                                  }`}
                                  style={{ 
                                    backgroundColor: hasLog ? dotHex : 'transparent',
                                    borderColor: hasLog ? dotHex : (isDarkMode ? '#52525B' : '#A1A1AA')
                                  }}
                                >
                                  {hasLog && (
                                    <span className="w-1 h-1 bg-white rounded-full opacity-70" />
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
            </div>

          </div>
        )}
      </div>

      {/* ------------------------------------------------------------- */}
      {/* 6. LOG DETAIL MODAL (Horizontal Scrolling Card Deck)           */}
      {/* ------------------------------------------------------------- */}
      {selectedLogModal && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm transition-all duration-300"
          onClick={() => setSelectedLogModal(null)}
        >
          <div 
            className={`w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl border transition-all transform scale-100 ${
              isDarkMode 
                ? 'bg-zinc-900/95 border-zinc-800 text-white' 
                : 'bg-white/95 border-slate-200 text-slate-900'
            }`}
            style={{ borderRadius: `${cardRadius * 2}px` }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className={`px-6 py-4 border-b flex items-center justify-between shrink-0 ${
              isDarkMode ? 'border-zinc-800 bg-zinc-950/50' : 'border-slate-100 bg-slate-50/50'
            }`}>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-rose-500">
                  {selectedLogModal.dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
                {selectedLogModal.logs.length > 1 && (
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                    isDarkMode ? 'bg-zinc-800 text-zinc-300' : 'bg-slate-200 text-slate-700'
                  }`}>
                    {selectedLogModal.logs.length} Entries
                  </span>
                )}
              </div>
              <button
                onClick={() => setSelectedLogModal(null)}
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors cursor-pointer ${
                  isDarkMode ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-slate-200 text-slate-600'
                }`}
              >
                ✕
              </button>
            </div>

            {/* Modal Body / Horizontal Scrollable Card Deck with Mouse Wheel support */}
            <div className="p-8 overflow-y-hidden flex-1 flex items-center justify-center">
              {selectedLogModal.logs.length > 0 ? (
                <div 
                  ref={carouselRef}
                  onWheel={handleModalWheel}
                  className="flex items-center gap-6 overflow-x-auto px-6 py-4 snap-x snap-mandatory scrollbar-none w-full focus:outline-none"
                  style={{ scrollBehavior: 'smooth' }}
                >
                  {selectedLogModal.logs.map((logItem, idx) => (
                    <div 
                      key={idx}
                      className={`snap-center shrink-0 w-[420px] max-w-[85vw] max-h-[70vh] flex flex-col p-6 rounded-xl border shadow-xl overflow-hidden transition-all duration-300 ${
                        isDarkMode 
                          ? 'bg-zinc-950/90 border-zinc-800 text-white' 
                          : 'bg-white border-slate-200 text-slate-900 shadow-slate-200/50'
                      }`}
                      style={{ borderRadius: `${cardRadius * 1.5}px` }}
                    >
                      {/* Natural Photo Dimension Frame (No Buffers) */}
                      {logItem.imageUrl && (
                        <div className="flex justify-center mb-4 shrink-0">
                          <img 
                            src={logItem.imageUrl} 
                            alt={logItem.title}
                            className="max-h-[300px] w-auto rounded-md object-contain shadow-sm" 
                          />
                        </div>
                      )}

                      {/* Project Type Badge & Title */}
                      <div className="shrink-0">
                        <span
                          className="text-[10px] font-semibold tracking-widest uppercase px-2 py-0.5 rounded border inline-block mb-2"
                          style={{ 
                            borderColor: getDotColor(logItem),
                            color: getDotColor(logItem)
                          }}
                        >
                          {logItem.projectType || 'General'}
                        </span>
                        <h2 className={`text-xl font-bold tracking-tight ${isDarkMode ? 'text-zinc-100' : 'text-slate-900'}`}>
                          {logItem.title}
                        </h2>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-10 space-y-2">
                  <div className={`w-12 h-12 mx-auto rounded-full flex items-center justify-center text-lg ${
                    isDarkMode ? 'bg-zinc-800 text-zinc-500' : 'bg-slate-100 text-slate-400'
                  }`}>
                    📅
                  </div>
                  <h3 className={`text-lg font-bold ${isDarkMode ? 'text-zinc-200' : 'text-slate-800'}`}>
                    No log entry for this day
                  </h3>
                  <p className={`text-xs ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>
                    There are no recorded Notion logs or items matching {selectedLogModal.dateObj.toLocaleDateString()}.
                  </p>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className={`px-6 py-4 border-t flex justify-end gap-2 shrink-0 ${
              isDarkMode ? 'border-zinc-800 bg-zinc-950/50' : 'border-slate-100 bg-slate-50/50'
            }`}>
              <button
                onClick={() => setSelectedLogModal(null)}
                className={`px-4 py-2 text-xs font-semibold rounded-md border transition-colors cursor-pointer ${
                  isDarkMode 
                    ? 'border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-white' 
                    : 'border-slate-300 bg-white hover:bg-slate-100 text-slate-700'
                }`}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;