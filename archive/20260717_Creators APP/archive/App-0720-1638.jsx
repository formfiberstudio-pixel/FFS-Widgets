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
const TIMELINE_WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function App() {
  // -------------------------------------------------------------
  // 1. STATE & INITIALIZATION
  // -------------------------------------------------------------
  const today = new Date(2026, 6, 20); // July 20, 2026
  const [currentDate, setCurrentDate] = useState(today);
  const [viewMode, setViewMode] = useState('year'); 
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [selectedProjectFilters, setSelectedProjectFilters] = useState([]); 
  const [selectedLogModal, setSelectedLogModal] = useState(null); 
  
  // Track collapsed state per Category Type (True Toggle Lists)
  const [collapsedTypes, setCollapsedTypes] = useState({});

  const carouselRef = useRef(null);

  // Dynamic Theme Trackers
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
        // If filters are active, only show logs belonging to selected filters
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

  // Toggle single category accordion list
  const toggleTypeAccordion = (type) => {
    setCollapsedTypes(prev => ({
      ...prev,
      [type]: !prev[type]
    }));
  };

  // Expand All Lists
  const handleExpandAllCategories = () => {
    const freshState = {};
    Object.keys(groupedProjects).forEach(type => {
      freshState[type] = false; 
    });
    setCollapsedTypes(freshState);
  };

  // Collapse All Lists
  const handleCollapseAllCategories = () => {
    const freshState = {};
    Object.keys(groupedProjects).forEach(type => {
      freshState[type] = true; 
    });
    setCollapsedTypes(freshState);
  };

  // Reset filtering configuration completely
  const handleShowAllFilters = () => {
    setSelectedProjectFilters([]);
  };

  const toggleProjectFilter = (title) => {
    setSelectedProjectFilters((prev) => 
      prev.includes(title) ? prev.filter(t => t !== title) : [...prev, title]
    );
  };

  // -------------------------------------------------------------
  // 4. TIMELINE SLOTS SETUP
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
    if (viewMode === 'month') {
      setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
    } else if (viewMode === 'week') {
      const d = new Date(currentDate); d.setDate(currentDate.getDate() - 7); setCurrentDate(d);
    } else {
      setCurrentDate(new Date(currentDate.getFullYear() - 1, currentDate.getMonth(), 1));
    }
  };

  const handleNext = () => {
    if (viewMode === 'month') {
      setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
    } else if (viewMode === 'week') {
      const d = new Date(currentDate); d.setDate(currentDate.getDate() + 7); setCurrentDate(d);
    } else {
      setCurrentDate(new Date(currentDate.getFullYear() + 1, currentDate.getMonth(), 1));
    }
  };

  return (
    <div className={`min-h-screen transition-colors duration-300 p-8 ${
      isDarkMode ? 'bg-[#0B0B0C] text-white' : 'bg-slate-50 text-slate-900'
    }`}>
      <div className="max-w-[1600px] mx-auto">
        
        {/* Header Control Bar */}
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

        {/* Layout Workspace split */}
        <div className={`grid grid-cols-1 ${isSidebarOpen ? 'lg:grid-cols-12' : ''} gap-8 items-start`}>
          
          {/* Categories Sidebar */}
          {isSidebarOpen && (
            <div className="lg:col-span-3 p-5 rounded-xl border flex flex-col bg-white border-slate-200 shadow-xs" style={{ borderRadius: `${cardRadius}px` }}>
              <div className="mb-4">
                <h2 className="text-sm font-bold text-slate-800 mb-2">Categories</h2>
                
                {/* Global Accordion Toggle Controls */}
                <div className="flex flex-wrap items-center gap-1.5 mb-2 pb-2 border-b border-slate-100">
                  <button 
                    onClick={handleExpandAllCategories}
                    className="text-[10px] font-bold text-slate-500 hover:text-rose-500 bg-slate-100 hover:bg-rose-50 px-2 py-1 rounded cursor-pointer"
                  >
                    Expand All
                  </button>
                  <button 
                    onClick={handleCollapseAllCategories}
                    className="text-[10px] font-bold text-slate-500 hover:text-rose-500 bg-slate-100 hover:bg-rose-50 px-2 py-1 rounded cursor-pointer"
                  >
                    Collapse All
                  </button>
                  <button 
                    onClick={handleShowAllFilters}
                    className="text-[10px] font-bold text-rose-600 hover:bg-rose-100 bg-rose-50 px-2 py-1 rounded cursor-pointer ml-auto"
                  >
                    Show All
                  </button>
                </div>
              </div>
              
              <div className="space-y-3 max-h-[68vh] overflow-y-auto pr-1">
                {Object.entries(groupedProjects).map(([type, projs]) => {
                  const isHidden = collapsedTypes[type] === true;
                  return (
                    <div key={type} className="border border-slate-200 rounded-md bg-slate-50/50 overflow-hidden">
                      {/* Accordion Toggle Header Row */}
                      <div 
                        onClick={() => toggleTypeAccordion(type)}
                        className="text-[10px] font-bold uppercase tracking-wider p-2 text-slate-500 flex items-center justify-between cursor-pointer hover:bg-slate-100 transition-colors"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: projs[0]?.projectTypeColor && NOTION_COLOR_MAP[projs[0].projectTypeColor] ? NOTION_COLOR_MAP[projs[0].projectTypeColor] : '#7c7c7c' }} />
                          {type}
                        </div>
                        <span className="text-[9px] font-mono opacity-60">{isHidden ? '▼' : '▲'}</span>
                      </div>

                      {/* Toggled Child Node Panel List Container */}
                      {!isHidden && (
                        <div className="p-2 pt-0 space-y-1.5 border-t border-slate-150">
                          {projs.map((p, i) => {
                            const isSelected = selectedProjectFilters.includes(p.title);
                            const dynamicFilterActive = selectedProjectFilters.length > 0;
                            
                            // Relation flipped: bold if active filter item (or default style when no active filtering), faded otherwise
                            const cardStyles = dynamicFilterActive 
                              ? isSelected 
                                ? 'border-rose-400 font-bold text-slate-900 shadow-xs ring-1 ring-rose-400/20' 
                                : 'border-slate-200 opacity-30 font-normal text-slate-400 hover:opacity-60'
                              : 'border-slate-300 font-medium text-slate-800 shadow-2xs hover:border-rose-400';

                            return (
                              <div 
                                key={i} 
                                onClick={() => toggleProjectFilter(p.title)}
                                className={`text-xs p-2.5 rounded border transition-all cursor-pointer bg-white ${cardStyles}`}
                              >
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
            
            {/* Day Row Legend */}
            {viewMode !== 'year' && (
              <div className="grid mb-3 text-center text-xs font-semibold uppercase tracking-wider" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: `${gap}px` }}>
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => (
                  <div key={day} className={idx === 0 || idx === 6 ? 'text-rose-500 font-bold' : 'text-slate-500'}>{day}</div>
                ))}
              </div>
            )}

            {/* ----------------------------------------------------------------- */}
            {/* VIEW MODE: MONTHLY GRID LAYOUT                                    */}
            {/* ----------------------------------------------------------------- */}
            {viewMode === 'month' ? (
              <div className="flex flex-col" style={{ gap: `${gap}px` }}>
                {rows.map((rowSlots, rowIndex) => (
                  <div key={rowIndex} className="grid w-full" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: `${gap}px` }}>
                    {rowSlots.map((slot, slotIndex) => {
                      if (!slot.isValid) return <div key={slotIndex} className="aspect-[3/4] opacity-5 bg-slate-200" />;
                      
                      const logs = getLogsForDate(slot.dateObj);
                      const hasLog = logs.length > 0;
                      const pLog = logs[0];
                      
                      return (
                        <div 
                          key={slotIndex} 
                          onClick={() => slot.dateObj && setSelectedLogModal({ dateObj: slot.dateObj, logs })}
                          className={`relative aspect-[3/4] overflow-hidden p-3 border cursor-pointer flex flex-col justify-end transition-all bg-white border-slate-200 hover:shadow-md ${
                            isToday(slot.dateObj) ? 'ring-2 ring-rose-500 ring-offset-1' : ''
                          }`}
                          style={{ borderRadius: `${cardRadius}px` }}
                        >
                          {hasLog && pLog.imageUrl && (
                            <img src={pLog.imageUrl} className="absolute inset-0 w-full h-full object-cover z-0" alt="" />
                          )}
                          
                          <div 
                            className="absolute top-2 left-2 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold z-10 text-white shadow-2xs" 
                            style={{ backgroundColor: getDotColor(pLog) }}
                          >
                            {slot.dayNum}
                          </div>
                          
                          {hasLog && (
                            <div className="relative z-10 text-[11px] font-bold text-white bg-black/60 p-1 rounded-xs backdrop-blur-xs line-clamp-2 leading-tight">
                              {pLog.title}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            ) : viewMode === 'week' ? (
              /* ----------------------------------------------------------------- */
              /* VIEW MODE: WEEKLY TIMELINE EXTENDED DESCRIPTIVE LAYOUT            */
              /* ----------------------------------------------------------------- */
              <div className="grid items-start" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: `${gap}px` }}>
                {slots.map((slot, index) => {
                  const logs = getLogsForDate(slot.dateObj);
                  const hasLog = logs.length > 0;
                  const pLog = logs[0];
                  
                  return (
                    <div key={index} className="flex flex-col bg-white border border-slate-200 shadow-2xs overflow-hidden" style={{ borderRadius: `${cardRadius}px` }}>
                      <div 
                        onClick={() => slot.dateObj && setSelectedLogModal({ dateObj: slot.dateObj, logs })}
                        className={`relative aspect-[3/4] overflow-hidden p-3 border-b border-slate-100 cursor-pointer flex flex-col justify-end ${
                          isToday(slot.dateObj) ? 'ring-2 ring-rose-500 ring-inset' : ''
                        }`}
                      >
                        {hasLog && pLog.imageUrl && (
                          <img src={pLog.imageUrl} className="absolute inset-0 w-full h-full object-cover z-0" alt="" />
                        )}
                        
                        <div 
                          className="absolute top-2 left-2 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold z-10 text-white shadow-2xs" 
                          style={{ backgroundColor: getDotColor(pLog) }}
                        >
                          {slot.dayNum}
                        </div>
                        
                        {hasLog && (
                          <div className="relative z-10 text-[11px] font-bold text-white bg-black/60 p-1 rounded-xs backdrop-blur-xs line-clamp-2 leading-tight">
                            {pLog.title}
                          </div>
                        )}
                      </div>
                      
                      <div className="p-3 min-h-[120px] flex flex-col">
                        {hasLog && pLog.pageContent ? (
                          <p className="text-[11px] text-slate-500 leading-normal whitespace-pre-wrap line-clamp-6">
                            {pLog.pageContent}
                          </p>
                        ) : (
                          <p className="text-[10px] text-slate-300 italic">Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor...</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* ----------------------------------------------------------------- */
              /* VIEW MODE: YEARLY INTERACTIVE MATRIX                              */
              /* ----------------------------------------------------------------- */
              <div className={`p-6 border overflow-x-auto bg-white border-slate-200 shadow-2xs`} style={{ borderRadius: `${cardRadius}px` }}>
                <div className="min-w-[1020px] select-none">
                  
                  <div className="grid grid-cols-[65px_1fr] items-center mb-4 border-b border-slate-100 pb-2">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 text-center">Month</div>
                    <div className="grid grid-cols-37 gap-1 text-center">
                      {Array.from({ length: 37 }).map((_, colIndex) => {
                        const weekdayStr = TIMELINE_WEEKDAYS[colIndex % 7];
                        const isWeekend = weekdayStr === 'SUN' || weekdayStr === 'SAT';
                        return (
                          <div 
                            key={colIndex} 
                            className={`text-[9px] font-black tracking-tight py-1 rounded ${
                              isWeekend ? 'bg-rose-50 text-rose-600 font-bold' : 'text-slate-400'
                            }`}
                          >
                            {weekdayStr.slice(0, 2)}
                          </div>
                        );
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
                          
                          <div 
                            onClick={() => {
                              setCurrentDate(new Date(year, mIdx, 1));
                              setViewMode('month');
                            }}
                            className="text-[11px] font-bold text-center tracking-wide py-1.5 w-12 rounded border bg-slate-50 border-slate-200 text-slate-600 hover:border-rose-400 hover:text-rose-600 transition-all cursor-pointer"
                          >
                            {monthLabel}
                          </div>

                          <div className="grid grid-cols-37 gap-1 items-center relative py-1">
                            <div className="absolute left-0 right-0 h-[1px] border-b border-dashed border-slate-200 top-1/2 -translate-y-1/2 z-0" />

                            {Array.from({ length: 37 }).map((_, colIndex) => {
                              const targetDayNum = colIndex - startOffsetColumn + 1;
                              const isValidCalendarDay = targetDayNum > 0 && targetDayNum <= daysInMonth;

                              if (!isValidCalendarDay) return <div key={colIndex} className="w-5 h-5 z-10" />;

                              const targetDate = new Date(year, mIdx, targetDayNum);
                              const logs = getLogsForDate(targetDate);
                              const hasLog = logs.length > 0;
                              const primaryLog = hasLog ? logs[0] : null;
                              const currentDotHex = hasLog ? getDotColor(primaryLog) : 'transparent';

                              return (
                                <div
                                  key={colIndex}
                                  onClick={() => setSelectedLogModal({ dateObj: targetDate, logs })}
                                  className="w-5 h-5 flex items-center justify-center relative z-10 cursor-pointer group/node"
                                >
                                  <div
                                    className={`w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold border transition-all ${
                                      hasLog 
                                        ? 'text-white border-transparent shadow-xs scale-110' 
                                        : 'border-slate-200 bg-white text-slate-400 hover:border-slate-400 hover:text-slate-600'
                                    } ${isToday(targetDate) ? 'ring-2 ring-rose-500 ring-offset-1' : ''}`}
                                    style={{ backgroundColor: currentDotHex }}
                                  >
                                    {targetDayNum}
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
            )}
          </div>

        </div>
      </div>

      {/* Detail Slide Modal Component */}
      {selectedLogModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs" onClick={() => setSelectedLogModal(null)}>
          <div className="w-full max-w-2xl max-h-[80vh] bg-white rounded-xl flex flex-col overflow-hidden shadow-xl border border-slate-200" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <span className="text-xs font-bold text-rose-500 tracking-wider">
                {selectedLogModal.dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
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