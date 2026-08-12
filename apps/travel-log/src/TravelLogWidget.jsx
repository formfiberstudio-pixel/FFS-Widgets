import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import exifr from 'exifr';
import imageCompression from 'browser-image-compression';
import { useDropzone } from 'react-dropzone';

// --- IMPORT SHARED UI & AUTH ---
import NotionSetupModal from '../../../packages/shared-ui/components/NotionSetupModal.jsx';
import { getNotionToken, getDatabaseId } from '../../../packages/shared-ui/utils/authStorage.js';

// --- DATABASE A FALLBACK / DEFAULT DATA ---
const CALENDAR_DATES = [
  { id: 'date16', title: 'DECEMBER 16', start: '2023-12-16T00:00:00', end: '2023-12-17T00:00:00' },
  { id: 'date17', title: 'DECEMBER 17', start: '2023-12-17T00:00:00', end: '2023-12-18T00:00:00' },
  { id: 'date18', title: 'DECEMBER 18', start: '2023-12-18T00:00:00', end: '2023-12-19T00:00:00' },
];

const PLACES_DATA = {
  home: { title: 'Home', address: '33 Bay St, Toronto, ON MSJ 2Z3, Canada', lat: 43.6426, lon: -79.3772 },
  hotelOttawa: { title: 'Le Germain Hotel Ottawa', address: '30 Daly Ave, Ottawa, ON', lat: 45.4252, lon: -75.6896 },
  hotelMontreal: { title: 'Hotel Monville', address: '1041 Bleury St, Montreal, QC', lat: 45.5034, lon: -73.5638 }
};

const SUN_EVENTS = [
  { time: '2023-12-16T07:45:00', type: 'sunrise' },
  { time: '2023-12-16T16:20:00', type: 'sunset' },
  { time: '2023-12-17T07:46:00', type: 'sunrise' },
  { time: '2023-12-17T16:20:00', type: 'sunset' },
  { time: '2023-12-18T07:46:00', type: 'sunrise' },
  { time: '2023-12-18T16:21:00', type: 'sunset' }
];

const WEATHER_FORECAST = [
  { time: '2023-12-16T10:00:00', condition: 'Cloudy' },
  { time: '2023-12-16T18:00:00', condition: 'Snow' },
  { time: '2023-12-17T11:00:00', condition: 'Sunny' },
  { time: '2023-12-17T15:00:00', condition: 'Partly Cloudy' },
  { time: '2023-12-18T09:30:00', condition: 'Rain' },
  { time: '2023-12-18T15:00:00', condition: 'Sunny' },
];

const TRIP_DAYS = [
  {
    id: 'day1',
    title: 'DAY 1 | OTTAWA',
    start: '2023-12-16T08:00:00',
    end: '2023-12-17T09:00:00',
    subItems: [
      { id: 'p1', title: 'Drive to Ottawa', type: 'transport', start: '2023-12-16T08:00:00', end: '2023-12-16T12:00:00', place: 'home' },
      { 
        id: 'p2', 
        title: 'sight seeing', 
        type: 'sightseeing', 
        start: '2023-12-16T12:00:00', 
        end: '2023-12-16T21:00:00',
        nestedItems: [
          { id: 'n1', title: 'hotel check-in', time: '2023-12-16T14:00:00', place: 'hotelOttawa' },
          { id: 'n2', title: 'dinner with Calvin', time: '2023-12-16T17:45:00' }
        ]
      },
      { id: 'p3', title: 'rest', type: 'lodging', start: '2023-12-16T21:00:00', end: '2023-12-17T09:00:00', place: 'hotelOttawa' },
    ]
  },
  {
    id: 'day2',
    title: 'DAY 2 | MONTREAL',
    start: '2023-12-17T09:00:00',
    end: '2023-12-18T09:00:00',
    subItems: [
      { id: 'p4', title: 'drive to Montreal', type: 'transport', start: '2023-12-17T10:00:00', end: '2023-12-17T12:00:00' },
      { 
        id: 'p5', 
        title: 'sight seeing', 
        type: 'sightseeing', 
        start: '2023-12-17T12:00:00', 
        end: '2023-12-17T21:00:00',
        nestedItems: [
          { id: 'n3', title: 'market', time: '2023-12-17T12:00:00' },
          { id: 'n4', title: 'Day 2 | Lunch', time: '2023-12-17T13:00:00' },
          { id: 'n5', title: 'Hotel Check-in', time: '2023-12-17T13:45:00', place: 'hotelMontreal' }
        ]
      },
      { id: 'p6', title: 'rest', type: 'lodging', start: '2023-12-17T21:00:00', end: '2023-12-18T09:00:00', place: 'hotelMontreal' },
    ]
  },
  {
    id: 'day3',
    title: 'DAY 3 | DRIVE HOME',
    start: '2023-12-18T09:00:00',
    end: '2023-12-18T21:00:00',
    subItems: [
      { id: 'p7', title: 'breakfast', type: 'sightseeing', start: '2023-12-18T09:00:00', end: '2023-12-18T11:00:00' },
      { id: 'p8', title: 'sight seeing', type: 'sightseeing', start: '2023-12-18T11:00:00', end: '2023-12-18T14:00:00' },
      { id: 'p9', title: 'drive home', type: 'transport', start: '2023-12-18T14:00:00', end: '2023-12-18T21:00:00', place: 'home' },
    ]
  }
];

const categoryColors = {
  transport: 'bg-blue-400 dark:bg-blue-500 text-zinc-950',
  sightseeing: 'bg-amber-300 dark:bg-amber-500 text-zinc-950',
  lodging: 'bg-purple-300 dark:bg-purple-500 text-zinc-950',
};

const homeMapIcon = L.divIcon({
  className: 'bg-transparent',
  html: `<div class="p-1 bg-red-600 text-white rounded-full border-2 border-white shadow-md flex items-center justify-center w-7 h-7"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg></div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

const hotelMapIcon = L.divIcon({
  className: 'bg-transparent',
  html: `<div class="p-1 bg-indigo-600 text-white rounded-full border-2 border-white shadow-md flex items-center justify-center w-7 h-7"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5m0 0v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg></div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

const activeIcon = L.divIcon({
  className: 'bg-transparent',
  html: `<div class="w-4 h-4 bg-red-500 rounded-full border-2 border-white dark:border-zinc-900 shadow-[0_0_10px_rgba(239,68,68,0.8)]"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

const inactiveIcon = L.divIcon({
  className: 'bg-transparent',
  html: `<div class="w-3 h-3 bg-zinc-400 dark:bg-zinc-600 rounded-full border-2 border-white dark:border-zinc-900"></div>`,
  iconSize: [12, 12],
  iconAnchor: [6, 6],
});

const LineWeatherIcon = ({ condition = '', className = "w-4 h-4" }) => {
  const lower = String(condition || '').toLowerCase();
  if (lower.includes('cloud')) return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" /></svg>;
  if (lower.includes('sun')) return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>;
  if (lower.includes('rain')) return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 20v-6m0 0l-3 3m3-3l3 3m5-5a5 5 0 00-7.246-4.502 5.002 5.002 0 00-9.508 1.998A4.001 4.001 0 003 15h18z" /></svg>;
  if (lower.includes('snow')) return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3v18m0-18l3 3m-3-3l-3 3m0 12l3 3m3-3l-3 3m8-9H4m16 0l-3-3m3 3l-3 3M4 12l3 3m-3-3l3-3" /></svg>;
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" /></svg>;
};

function MapViewController({ coordinates, resetTrigger }) {
  const map = useMap();
  useEffect(() => {
    if (coordinates && coordinates.length > 1) { 
      const bounds = L.latLngBounds(coordinates);
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15, animate: true });
    } else if (coordinates && coordinates.length === 1) {
      map.setView(coordinates[0], 14, { animate: true });
    }
  }, [resetTrigger, map]);
  return null;
}

function ActivePinFollower({ activeActivity }) {
  const map = useMap();
  useEffect(() => {
    if (activeActivity && activeActivity.center_lat && activeActivity.center_lon) {
      const latLng = L.latLng(activeActivity.center_lat, activeActivity.center_lon);
      if (!map.getBounds().contains(latLng)) {
        map.flyTo(latLng, map.getZoom(), { animate: true, duration: 1.0 });
      }
    }
  }, [activeActivity, map]);
  return null;
}

function MapResizer() {
  const map = useMap();
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      map.invalidateSize();
    });
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}

const TimelineNavArrow = ({ direction, onClick, hidden }) => {
  if (hidden) return null;
  return (
    <button 
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`absolute ${direction === 'left' ? '-left-3' : '-right-3'} top-1/2 -translate-y-1/2 z-30 p-1 text-zinc-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity bg-white/80 dark:bg-zinc-900/80 rounded-full shadow-sm backdrop-blur border border-zinc-200 dark:border-zinc-700`}
    >
      <svg className="w-3 h-3 stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        {direction === 'left' 
          ? <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          : <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />}
      </svg>
    </button>
  );
};

export default function TravelLogWidget() {
  // Use authStorage dynamically instead of local component state
  const [isSettingsOpen, setIsSettingsOpen] = useState(() => !getNotionToken() || !getDatabaseId('notion_trips_db') || !getDatabaseId('notion_photos_db'));
  
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [isTimelineVisible, setIsTimelineVisible] = useState(true);

  const [clustersData, setClustersData] = useState([]);
  const [tripData, setTripData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  const [selectedActivityId, setSelectedActivityId] = useState(null);
  const [hoveredActivityId, setHoveredActivityId] = useState(null);
  
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e) => setIsDarkMode(e.matches);
    
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const [objectFitMode, setObjectFitMode] = useState('cover'); 
  const [cardWidth, setCardWidth] = useState(null); 
  const [cardHeight, setCardHeight] = useState(240); 
  
  const [selectedCalendarDateId, setSelectedCalendarDateId] = useState(null);
  const [selectedTripDayId, setSelectedTripDayId] = useState(null);
  const [selectedBlockId, setSelectedBlockId] = useState(null);
  const [largePhotoUrl, setLargePhotoUrl] = useState(null);

  const [isResizingWidth, setIsResizingWidth] = useState(false);
  const [isResizingHeight, setIsResizingHeight] = useState(false);
  const [leftWidth, setLeftWidth] = useState(58);
  const [isDraggingMainSplitter, setIsDraggingMainSplitter] = useState(false);

  const containerRef = useRef(null);
  const galleryRef = useRef(null);
  const firstCardRef = useRef(null);

  const fetchData = async () => {
    const token = getNotionToken();
    const tripsId = getDatabaseId('notion_trips_db');
    const photosId = getDatabaseId('notion_photos_db');

    if (!token || !tripsId || !photosId) {
      setIsSettingsOpen(true);
      return;
    }
    
    setIsLoading(true);
    setErrorMsg(null);

    try {
      const res = await fetch(`/api/sync`, {
        method: 'GET',
        headers: {
          'x-notion-api-key': token,
          'x-trips-db-id': tripsId,
          'x-photos-db-id': photosId
        }
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Failed to fetch Notion data');

      const processedClusters = (data.clusters || []).map(cluster => {
        let updatedCluster = { ...cluster };
        if (updatedCluster.title && /(Test 01|Test 02|Test 03)/i.test(updatedCluster.title)) {
          updatedCluster.timestamp = '2026-05-31T12:00:00';
          updatedCluster.date = '2026-05-31T12:00:00';
          updatedCluster.start_time = '2026-05-31T12:00:00';
        }
        if (updatedCluster.approx_location && updatedCluster.approx_location.toLowerCase() === 'logged location') {
          updatedCluster.approx_location = updatedCluster.address || 'Address missing';
        }
        return updatedCluster;
      });

      setClustersData(processedClusters);
      setTripData(data.trips || []);
      if (processedClusters.length > 0) {
        setSelectedActivityId(processedClusters[0].activity_id);
      }
      setIsLoading(false);
    } catch (err) {
      setErrorMsg(err.message);
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const onDropPhotos = useCallback(async (acceptedFiles) => {
    if (!acceptedFiles || acceptedFiles.length === 0) return;
    
    const token = getNotionToken();
    const photosId = getDatabaseId('notion_photos_db');

    if (!token || !photosId) {
      setErrorMsg("Please configure Notion settings before uploading.");
      return;
    }

    setUploadStatus('Extracting GPS and Compressing...');
    
    try {
      const fileDataArray = [];
      for (const file of acceptedFiles) {
        let lat = null, lon = null, dateObj = new Date(file.lastModified);
        try {
          const exifData = await exifr.parse(file, true);
          if (exifData) {
            if (exifData.latitude && exifData.longitude) {
              lat = exifData.latitude;
              lon = exifData.longitude;
            }
            if (exifData.DateTimeOriginal) {
              dateObj = exifData.DateTimeOriginal;
            }
          }
        } catch (e) { console.warn("EXIF read failed", e); }
        fileDataArray.push({ file, lat, lon, dateObj });
      }

      fileDataArray.sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());
      let lastKnownLat = null;
      let lastKnownLon = null;

      if (clustersData.length > 0) {
        const sortedExisting = [...clustersData].sort((a, b) => new Date(b.timestamp || b.date || b.start_time).getTime() - new Date(a.timestamp || a.date || a.start_time).getTime());
        const lastValid = sortedExisting.find(c => c.center_lat && c.center_lon);
        if (lastValid) {
          lastKnownLat = lastValid.center_lat;
          lastKnownLon = lastValid.center_lon;
        }
      }

      const processedPhotos = [];
      for (const data of fileDataArray) {
        if (data.lat && data.lon) {
          lastKnownLat = data.lat;
          lastKnownLon = data.lon;
        } else if (lastKnownLat && lastKnownLon) {
          data.lat = lastKnownLat;
          data.lon = lastKnownLon;
        }

        const compressedFile = await imageCompression(data.file, { maxSizeMB: 0.2, maxWidthOrHeight: 1200 });
        const base64Promise = new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(compressedFile);
        });
        
        const offsetMs = data.dateObj.getTimezoneOffset() * 60000;
        const localISOTime = new Date(data.dateObj.getTime() - offsetMs).toISOString().slice(0, 19);

        processedPhotos.push({
          name: data.file.name,
          date: localISOTime,
          lat: data.lat,
          lon: data.lon,
          base64_data: await base64Promise
        });
      }

      const BATCH_SIZE = 10;
      const totalBatches = Math.ceil(processedPhotos.length / BATCH_SIZE);

      for (let i = 0; i < processedPhotos.length; i += BATCH_SIZE) {
        const batch = processedPhotos.slice(i, i + BATCH_SIZE);
        const currentBatchNum = Math.floor(i / BATCH_SIZE) + 1;
        setUploadStatus(`Streaming batch ${currentBatchNum} of ${totalBatches} to Notion...`);
        const res = await fetch('/api/travel_processor', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-notion-api-key': token,
            'x-photos-db-id': photosId
          },
          body: JSON.stringify({ photos: batch })
        });
        if (!res.ok) {
           const errText = await res.text();
           throw new Error(`Batch ${currentBatchNum} Failed: ${errText}`);
        }
      }
      
      setUploadStatus('Success!');
      setTimeout(() => {
        setIsUploadOpen(false);
        setUploadStatus('');
        fetchData();
      }, 2000);

    } catch (err) {
      setUploadStatus('Error: ' + err.message);
    }
  }, [clustersData]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop: onDropPhotos, accept: {'image/*': []} });

  let timelineStartMs = new Date('2023-12-16T00:00:00').getTime();
  let timelineEndMs = new Date('2023-12-19T00:00:00').getTime();
  const allBlocks = TRIP_DAYS.flatMap(d => d.subItems);

  if (selectedBlockId) {
    const blockObj = allBlocks.find(b => b.id === selectedBlockId);
    if (blockObj) {
      timelineStartMs = new Date(blockObj.start).getTime();
      timelineEndMs = new Date(blockObj.end).getTime();
    }
  } else if (selectedCalendarDateId) {
    const calObj = CALENDAR_DATES.find(d => d.id === selectedCalendarDateId);
    if (calObj) {
      timelineStartMs = new Date(calObj.start).getTime();
      timelineEndMs = new Date(calObj.end).getTime();
    }
  } else if (selectedTripDayId) {
    const tripObj = TRIP_DAYS.find(d => d.id === selectedTripDayId);
    if (tripObj) {
      timelineStartMs = new Date(tripObj.start).getTime();
      timelineEndMs = new Date(tripObj.end).getTime();
    }
  }

  const currentDuration = timelineEndMs - timelineStartMs;

  function getPercent(dateStr) {
    if (!dateStr) return 0;
    const time = typeof dateStr === 'number' ? dateStr : new Date(dateStr).getTime();
    const pct = ((time - timelineStartMs) / currentDuration) * 100;
    return Math.max(0, Math.min(100, pct));
  }

  const durationInHours = currentDuration / (1000 * 60 * 60);
  let stepMinutes = 30; 
  if (durationInHours > 72) stepMinutes = 720; 
  else if (durationInHours > 48) stepMinutes = 360; 
  else if (durationInHours > 24) stepMinutes = 180; 
  else if (durationInHours > 12) stepMinutes = 60; 

  const hourStepMs = stepMinutes * 60 * 1000;
  const gridTicks = [];
  for (let t = timelineStartMs; t <= timelineEndMs; t += hourStepMs) {
    const dateObj = new Date(t);
    const hours = String(dateObj.getHours()).padStart(2, '0');
    const mins = String(dateObj.getMinutes()).padStart(2, '0');
    const label = stepMinutes < 60 ? `${hours}:${mins}` : `${hours}:00`;
    gridTicks.push({ timeMs: t, label, pct: getPercent(t) });
  }

  const visibleClusters = clustersData.filter(act => {
    const rawTime = act.timestamp || act.date || act.start_time;
    if (!rawTime) return true;
    const t = new Date(rawTime).getTime();
    return t >= timelineStartMs && t <= timelineEndMs;
  });

  const displayActivityId = hoveredActivityId || selectedActivityId;
  const activeActivity = clustersData.find(act => act.activity_id === displayActivityId) || clustersData[0];

  let mainRouteCoords = visibleClusters
    .filter((c) => c.center_lat && c.center_lon)
    .map((c) => [c.center_lat, c.center_lon]);

  const blockIndex = allBlocks.findIndex(b => b.id === selectedBlockId);
  const isTransportBlock = selectedBlockId && allBlocks[blockIndex]?.type === 'transport';

  if (isTransportBlock) {
    let originPlaceKey = null;
    let destPlaceKey = null;

    for (let i = blockIndex - 1; i >= 0; i--) {
      if (allBlocks[i].place) { originPlaceKey = allBlocks[i].place; break; }
    }
    if (!originPlaceKey && allBlocks[blockIndex].place) { originPlaceKey = allBlocks[blockIndex].place; }

    for (let i = blockIndex + 1; i < allBlocks.length; i++) {
      if (allBlocks[i].nestedItems) {
        const nestedWithPlace = allBlocks[i].nestedItems.find(n => n.place);
        if (nestedWithPlace) { destPlaceKey = nestedWithPlace.place; break; }
      }
      if (allBlocks[i].place) { destPlaceKey = allBlocks[i].place; break; }
    }
    if (!destPlaceKey && allBlocks[blockIndex].place) { destPlaceKey = allBlocks[blockIndex].place; }

    if (originPlaceKey && PLACES_DATA[originPlaceKey]) {
      mainRouteCoords.unshift([PLACES_DATA[originPlaceKey].lat, PLACES_DATA[originPlaceKey].lon]);
    }
    if (destPlaceKey && PLACES_DATA[destPlaceKey]) {
      mainRouteCoords.push([PLACES_DATA[destPlaceKey].lat, PLACES_DATA[destPlaceKey].lon]);
    }
  }

  useEffect(() => {
    if (galleryRef.current && !cardWidth) {
      const defaultW = Math.floor(galleryRef.current.clientWidth / 3) - 12;
      setCardWidth(defaultW);
    }
  }, [cardWidth, activeActivity]);

  const sortedAllClusters = [...clustersData].sort((a, b) => new Date(a.timestamp || a.date || a.start_time).getTime() - new Date(b.timestamp || b.date || b.start_time).getTime());
  const currGalleryIdx = sortedAllClusters.findIndex(act => act.activity_id === selectedActivityId);
  
  const hasPrevGallery = currGalleryIdx > 0;
  const hasNextGallery = currGalleryIdx < sortedAllClusters.length - 1;

  const handleGalleryNav = (direction) => {
    if (largePhotoUrl && activeActivity && activeActivity.web_photos) {
      const photoIdx = activeActivity.web_photos.indexOf(largePhotoUrl);
      if (photoIdx !== -1) {
        const nextPhotoIdx = photoIdx + direction;
        if (nextPhotoIdx >= 0 && nextPhotoIdx < activeActivity.web_photos.length) {
          setLargePhotoUrl(activeActivity.web_photos[nextPhotoIdx]);
          return;
        }
      }
    }

    if (currGalleryIdx === -1) return;
    const nextIndex = currGalleryIdx + direction;
    if (nextIndex < 0 || nextIndex >= sortedAllClusters.length) return;

    const nextActivity = sortedAllClusters[nextIndex];
    setSelectedActivityId(nextActivity.activity_id);

    if (largePhotoUrl) {
      const nextPhotos = nextActivity.web_photos || [];
      if (nextPhotos.length > 0) {
        setLargePhotoUrl(direction === 1 ? nextPhotos[0] : nextPhotos[nextPhotos.length - 1]);
      } else {
        setLargePhotoUrl(null); 
      }
    }
  };

  const currCalIdx = selectedCalendarDateId ? CALENDAR_DATES.findIndex(c => c.id === selectedCalendarDateId) : -1;
  const hasPrevCal = currCalIdx > 0;
  const hasNextCal = currCalIdx === -1 ? CALENDAR_DATES.length > 0 : currCalIdx < CALENDAR_DATES.length - 1;

  const currDayIdx = selectedTripDayId ? TRIP_DAYS.findIndex(d => d.id === selectedTripDayId) : -1;
  const hasPrevDay = currDayIdx > 0;
  const hasNextDay = currDayIdx === -1 ? TRIP_DAYS.length > 0 : currDayIdx < TRIP_DAYS.length - 1;

  const currBlockIdx = selectedBlockId ? allBlocks.findIndex(b => b.id === selectedBlockId) : -1;
  const hasPrevBlock = currBlockIdx > 0;
  const hasNextBlock = currBlockIdx === -1 ? allBlocks.length > 0 : currBlockIdx < allBlocks.length - 1;

  const handleTimelineNav = (type, direction) => {
    if (type === 'calendar') {
      const nextIdx = currCalIdx === -1 && direction > 0 ? 0 : currCalIdx + direction;
      if (nextIdx >= 0 && nextIdx < CALENDAR_DATES.length) {
        setSelectedCalendarDateId(CALENDAR_DATES[nextIdx].id);
        setSelectedTripDayId(null);
        setSelectedBlockId(null);
      }
    } else if (type === 'day') {
      const nextIdx = currDayIdx === -1 && direction > 0 ? 0 : currDayIdx + direction;
      if (nextIdx >= 0 && nextIdx < TRIP_DAYS.length) {
        setSelectedTripDayId(TRIP_DAYS[nextIdx].id);
        setSelectedCalendarDateId(null);
        setSelectedBlockId(null);
      }
    } else if (type === 'block') {
      const nextIdx = currBlockIdx === -1 && direction > 0 ? 0 : currBlockIdx + direction;
      if (nextIdx >= 0 && nextIdx < allBlocks.length) {
        setSelectedBlockId(allBlocks[nextIdx].id);
        setSelectedCalendarDateId(null);
        setSelectedTripDayId(null);
      }
    }
  };

  const handleWindowMouseMove = useCallback((e) => {
    let clientX, clientY;
    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    if (clientX === undefined || clientY === undefined) return;

    if (isDraggingMainSplitter && containerRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const newWidth = ((clientX - containerRect.left) / containerRect.width) * 100;
      if (newWidth > 30 && newWidth < 75) setLeftWidth(newWidth);
    }
    if (isResizingWidth && firstCardRef.current) {
      setCardWidth(Math.max(60, clientX - firstCardRef.current.getBoundingClientRect().left));
    }
    if (isResizingHeight && firstCardRef.current) {
      setCardHeight(Math.max(80, clientY - firstCardRef.current.getBoundingClientRect().top));
    }
  }, [isDraggingMainSplitter, isResizingWidth, isResizingHeight]);

  const handleWindowMouseUp = useCallback(() => {
    setIsDraggingMainSplitter(false);
    setIsResizingWidth(false);
    setIsResizingHeight(false);
  }, []);

  useEffect(() => {
    const handleMove = (e) => {
      if (e.type === 'touchmove' && e.cancelable) e.preventDefault();
      handleWindowMouseMove(e);
    };

    if (isDraggingMainSplitter || isResizingWidth || isResizingHeight) {
      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseup', handleWindowMouseUp);
      window.addEventListener('touchmove', handleMove, { passive: false });
      window.addEventListener('touchend', handleWindowMouseUp);
      document.body.style.userSelect = 'none';
    } else {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleWindowMouseUp);
      document.body.style.userSelect = '';
    }
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleWindowMouseUp);
      document.body.style.userSelect = '';
    };
  }, [isDraggingMainSplitter, isResizingWidth, isResizingHeight, handleWindowMouseMove, handleWindowMouseUp]);

  const daylightBlocks = [];
  for (let i = 0; i < SUN_EVENTS.length; i++) {
    if (SUN_EVENTS[i].type === 'sunrise' && SUN_EVENTS[i+1]?.type === 'sunset') {
        daylightBlocks.push({ start: SUN_EVENTS[i].time, end: SUN_EVENTS[i+1].time });
    }
  }

  const galleryW = galleryRef.current ? galleryRef.current.clientWidth : 600;
  const effectiveCardW = cardWidth || 180;
  const calculatedColumns = Math.max(1, Math.round(galleryW / effectiveCardW));
  const filterResetKey = `${selectedCalendarDateId || 'none'}-${selectedTripDayId || 'none'}-${selectedBlockId || 'none'}`;

  const activeTimestamp = activeActivity?.timestamp || activeActivity?.date || activeActivity?.start_time;
  const dateStr = activeTimestamp ? new Date(activeTimestamp).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase() : 'NO DATE';
  const timeStr = activeTimestamp ? new Date(activeTimestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase() : '--:--';
  const weatherStr = activeActivity?.weather || '-4°C, Partly Cloudy';
  const displayCondition = 'Partly Cloudy'; 

  return (
    <div className={isDarkMode ? 'dark' : ''}>
      <div className="w-screen h-screen flex flex-col p-6 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 tracking-widest selection:bg-red-500 selection:text-white transition-colors duration-300 overflow-hidden relative">
        
        {/* TOP SYSTEM NAV */}
        <header className="flex-shrink-0 mb-4">
          <div className="flex justify-between items-end">
            <div>
              <h1 className="text-xl md:text-2xl font-normal tracking-[0.35em] uppercase text-zinc-900 dark:text-zinc-50">
                TRAVEL LOG
              </h1>
            </div>
            
            <div className="flex items-center gap-3">
              <button 
                onClick={() => setIsUploadOpen(true)}
                className="text-[10px] font-mono tracking-wider uppercase px-3 py-1.5 rounded-sm bg-red-500 text-white hover:bg-red-600 transition-colors flex items-center gap-1.5 shadow-sm"
              >
                <span>⬆️</span> UPLOAD PHOTOS
              </button>

              <button 
                onClick={fetchData}
                disabled={isLoading || !getNotionToken()}
                className="text-[10px] font-mono tracking-wider uppercase px-3 py-1.5 rounded-sm border border-zinc-300 dark:border-zinc-700 hover:border-red-500 hover:text-red-500 transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                <span className={isLoading ? "animate-spin" : ""}>🔄</span> 
                {isLoading ? 'SYNCING...' : 'SYNC DATA'}
              </button>

              <button 
                onClick={() => setIsSettingsOpen(true)}
                className="text-[10px] font-mono tracking-wider uppercase px-3 py-1.5 rounded-sm border border-zinc-300 dark:border-zinc-700 hover:border-red-500 transition-colors flex items-center gap-1.5"
              >
                <span>⚙️</span> Notion Setup
              </button>
              <button 
                onClick={() => setObjectFitMode(objectFitMode === 'cover' ? 'contain' : 'cover')}
                className="text-[10px] font-mono tracking-wider uppercase px-3 py-1.5 rounded-sm border border-zinc-300 dark:border-zinc-700 hover:border-red-500 transition-colors"
              >
                Mode: <span className="text-red-500">{objectFitMode === 'cover' ? 'Fill Frame' : 'Full Photo'}</span>
              </button>
              <button 
                onClick={() => setIsDarkMode(!isDarkMode)}
                className="p-2 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-500 transition-colors"
              >
                {isDarkMode ? '☀️' : '🌙'}
              </button>
            </div>
          </div>
          <div className="w-full border-b border-zinc-300 dark:border-zinc-800 mt-4" />
        </header>

        {/* LOADING / ERROR STATES */}
        {isLoading && (
          <div className="flex-1 flex items-center justify-center font-mono text-xs uppercase tracking-widest text-zinc-400">
            Syncing live data from Notion databases...
          </div>
        )}

        {!isLoading && errorMsg && (
          <div className="flex-1 flex flex-col items-center justify-center font-mono text-xs text-red-500 tracking-wider gap-3">
            <p>Error: {errorMsg}</p>
            <button onClick={() => setIsSettingsOpen(true)} className="px-4 py-2 bg-red-500 text-white rounded-sm text-[10px] uppercase">
              Update Notion Credentials
            </button>
          </div>
        )}

        {/* MAIN WIDGET VIEW */}
        {!isLoading && !errorMsg && (
          <div ref={containerRef} className="flex flex-1 min-h-0 gap-2 relative">
            
            {/* LEFT COLUMN */}
            <div style={{ flex: `0 0 ${leftWidth}%` }} className="flex flex-col gap-6 min-w-0 pr-2">
              
              {/* TIMELINE */}
              <div className="flex-shrink-0 w-full bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 p-4 rounded-sm transition-all duration-300">
                
                {/* TIMELINE TOGGLE HEADER */}
                <div className={`flex justify-between items-center text-[10px] font-mono tracking-widest text-zinc-400 dark:text-zinc-500 uppercase ${isTimelineVisible ? 'mb-4 border-b border-zinc-100 dark:border-zinc-800 pb-3' : ''}`}>
                  <button 
                    onClick={() => setIsTimelineVisible(!isTimelineVisible)}
                    className="flex items-center gap-3 px-3 py-1.5 rounded-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 hover:border-red-400 hover:text-red-500 transition-all outline-none shadow-sm active:scale-95"
                  >
                    <div className="w-5 h-5 flex items-center justify-center bg-white dark:bg-zinc-800 rounded-full shadow-sm text-[8px] text-zinc-500">
                      {isTimelineVisible ? '▼' : '▶'}
                    </div>
                    <span className="font-semibold text-zinc-600 dark:text-zinc-300 tracking-widest">Timeline View</span>
                  </button>

                  {isTimelineVisible && (
                    <button
                      onClick={() => { setSelectedCalendarDateId(null); setSelectedTripDayId(null); setSelectedBlockId(null); }}
                      className={`px-3 py-1.5 rounded-full text-[9px] font-mono border transition-all active:scale-95 ${
                        !selectedCalendarDateId && !selectedTripDayId && !selectedBlockId
                          ? 'bg-red-500 text-white border-red-500 shadow-sm' 
                          : 'bg-zinc-100 dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700 hover:border-red-500 hover:text-red-500'
                      }`}
                    >
                      View Entire Trip
                    </button>
                  )}
                </div>
                
                {isTimelineVisible && (
                  <div className="relative w-full h-56 bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 rounded-sm overflow-visible">
                    <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
                      {gridTicks.map((tick, i) => (
                        <div key={i} style={{ left: `${tick.pct}%` }} className="absolute top-0 bottom-0 w-px border-r border-dashed border-zinc-300 dark:border-zinc-700/60" />
                      ))}
                    </div>

                    <div className="relative w-full h-full p-3 flex flex-col justify-between z-10">
                      
                      {/* 1. CALENDAR DATES */}
                      <div className="relative h-6 w-full group">
                        <TimelineNavArrow direction="left" hidden={!hasPrevCal} onClick={() => handleTimelineNav('calendar', -1)} />
                        <div className="absolute inset-0 overflow-hidden">
                          {CALENDAR_DATES.map((cal) => {
                            const leftPct = getPercent(cal.start);
                            const rightPct = getPercent(cal.end);
                            const widthPct = Math.max(12, rightPct - leftPct);
                            const isSelected = selectedCalendarDateId === cal.id;
                            return (
                              <button
                                key={cal.id}
                                onClick={() => {
                                  setSelectedCalendarDateId(isSelected ? null : cal.id);
                                  setSelectedTripDayId(null);
                                  setSelectedBlockId(null);
                                }}
                                style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                                className={`absolute top-0 bottom-0 px-2 rounded-sm text-[8px] font-mono uppercase flex items-center justify-between border transition-colors ${
                                  isSelected ? 'bg-red-500 text-white border-red-600 font-bold' : 'bg-zinc-200/90 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700'
                                }`}
                              >
                                <span className="truncate">{cal.title}</span>
                              </button>
                            );
                          })}
                        </div>
                        <TimelineNavArrow direction="right" hidden={!hasNextCal} onClick={() => handleTimelineNav('calendar', 1)} />
                      </div>

                      {/* 2. DAY/NIGHT GRADIENT & WEATHER BAR */}
                      <div className="relative h-6 w-full mt-1 bg-slate-800 dark:bg-slate-900 rounded-sm overflow-hidden shadow-inner border border-zinc-200/50 dark:border-zinc-700/50 group">
                        {daylightBlocks.map((block, idx) => {
                          const leftPct = getPercent(block.start);
                          const rightPct = getPercent(block.end);
                          const widthPct = Math.max(0, rightPct - leftPct);
                          return (
                            <div 
                              key={`day-${idx}`} 
                              style={{ left: `${leftPct}%`, width: `${widthPct}%`, filter: 'blur(8px)' }}
                              className="absolute top-0 bottom-0 bg-sky-200 dark:bg-sky-800/80 scale-110"
                            />
                          );
                        })}
                        
                        {WEATHER_FORECAST.filter(forecast => new Date(forecast.time).getTime() >= timelineStartMs && new Date(forecast.time).getTime() <= timelineEndMs).map((forecast, idx) => (
                          <div
                            key={`weather-${idx}`}
                            style={{ left: `${getPercent(forecast.time)}%`, transform: 'translateX(-50%)' }}
                            className="absolute top-1/2 -translate-y-1/2 z-20 flex flex-col items-center text-zinc-600 dark:text-zinc-300"
                            title={`Forecast: ${forecast.condition} (${new Date(forecast.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`}
                          >
                            <LineWeatherIcon condition={forecast.condition} className="w-3.5 h-3.5 drop-shadow-sm" />
                          </div>
                        ))}
                      </div>

                      {/* 3. ADAPTIVE TIME SLOTS */}
                      <div className="relative h-4 w-full mt-1 text-[7.5px] font-mono text-zinc-400 select-none overflow-hidden">
                        {gridTicks.map((tick, i) => (
                          <span key={i} style={{ left: `${tick.pct}%`, transform: 'translateX(-50%)' }} className="absolute top-0">
                            {tick.label}
                          </span>
                        ))}
                      </div>

                      {/* 4. DAY LABELS */}
                      <div className="relative h-6 w-full group mt-1">
                        <TimelineNavArrow direction="left" hidden={!hasPrevDay} onClick={() => handleTimelineNav('day', -1)} />
                        <div className="absolute inset-0 overflow-hidden">
                          {TRIP_DAYS.map((day) => {
                            const leftPct = getPercent(day.start);
                            const rightPct = getPercent(day.end);
                            const widthPct = Math.max(12, rightPct - leftPct);
                            const isSelected = selectedTripDayId === day.id;
                            return (
                              <button
                                key={day.id}
                                onClick={() => {
                                  setSelectedTripDayId(isSelected ? null : day.id);
                                  setSelectedCalendarDateId(null);
                                  setSelectedBlockId(null);
                                }}
                                style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                                className={`absolute top-0 bottom-0 px-2 rounded-sm text-[8px] font-mono font-semibold uppercase flex items-center justify-between border transition-colors ${
                                  isSelected ? 'bg-red-500 text-white border-red-600 font-bold' : 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 border-zinc-300 dark:border-zinc-700'
                                }`}
                              >
                                <span className="truncate">{day.title}</span>
                              </button>
                            );
                          })}
                        </div>
                        <TimelineNavArrow direction="right" hidden={!hasNextDay} onClick={() => handleTimelineNav('day', 1)} />
                      </div>

                      {/* 5. ACTIVITY BLOCKS */}
                      <div className="relative h-7 w-full mt-1 bg-zinc-100/70 dark:bg-zinc-800/30 rounded-sm border border-zinc-200/50 dark:border-zinc-800 group">
                        <TimelineNavArrow direction="left" hidden={!hasPrevBlock} onClick={() => handleTimelineNav('block', -1)} />
                        <div className="absolute inset-0 overflow-hidden">
                          {allBlocks.filter(item => new Date(item.start).getTime() >= timelineStartMs && new Date(item.start).getTime() <= timelineEndMs).map((item) => {
                              const leftPct = getPercent(item.start);
                              const rightPct = getPercent(item.end);
                              const widthPct = Math.max(2, rightPct - leftPct);
                              const isSelected = selectedBlockId === item.id;
                              return (
                                <button
                                  key={item.id}
                                  onClick={() => {
                                    setSelectedBlockId(isSelected ? null : item.id);
                                    setSelectedCalendarDateId(null);
                                    setSelectedTripDayId(null);
                                  }}
                                  style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                                  className={`absolute top-0.5 bottom-0.5 px-1.5 rounded-sm text-[8px] font-mono uppercase truncate flex items-center gap-1 shadow-xs border transition-all cursor-pointer ${categoryColors[item.type]} ${
                                    isSelected ? 'ring-2 ring-red-500 border-red-600 font-bold scale-[1.02] z-10' : 'border-transparent hover:border-zinc-400'
                                  }`}
                                >
                                  {item.place === 'home' && <span title="Home">🏠</span>}
                                  {item.type === 'lodging' && <span title="Hotel Rest Block">🏨</span>}
                                  <span className="truncate">{item.title}</span>
                                </button>
                              );
                            })}
                        </div>
                        <TimelineNavArrow direction="right" hidden={!hasNextBlock} onClick={() => handleTimelineNav('block', 1)} />
                      </div>

                      {/* 6. HORIZONTAL PHOTO DOTS */}
                      <div className="relative h-8 w-full mt-2 overflow-visible">
                        <div className="absolute left-0 right-0 h-px bg-zinc-300 dark:bg-zinc-700 top-1/2 -translate-y-1/2" />
                        
                        {visibleClusters.map((act) => {
                          const exactTimestamp = act.timestamp || act.date || act.start_time;
                          const isDisplayed = act.activity_id === displayActivityId;
                          
                          return (
                            <button
                              key={act.activity_id}
                              onClick={() => setSelectedActivityId(act.activity_id)}
                              onMouseEnter={() => setHoveredActivityId(act.activity_id)}
                              onMouseLeave={() => setHoveredActivityId(null)}
                              style={{ left: `${getPercent(exactTimestamp)}%`, transform: 'translate(-50%, -50%)', zIndex: isDisplayed ? 50 : 10 }}
                              className="absolute top-1/2 flex flex-col items-center justify-center cursor-pointer group/dot outline-none"
                            >
                              {isDisplayed ? (
                                <div className="flex flex-col items-center mb-5">
                                  <div className="w-3.5 h-3.5 bg-red-600 rounded-full border-2 border-white dark:border-zinc-900 shadow-sm z-10" />
                                  <div className="w-px h-3.5 bg-red-600 -mt-0.5" />
                                </div>
                              ) : (
                                <div className="w-2 h-2 bg-zinc-400 dark:bg-zinc-600 rounded-full border-2 border-white dark:border-zinc-900 group-hover/dot:bg-red-400 group-hover/dot:scale-125 transition-all" />
                              )}
                            </button>
                          );
                        })}
                      </div>

                    </div>
                  </div>
                )}
              </div>

              {/* MAP CONTAINER */}
              <div className="flex-1 relative rounded-sm overflow-hidden bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 shadow-sm z-0 min-h-0">
                <MapContainer center={[45.5017, -73.5673]} zoom={13} zoomControl={false} style={{ height: '100%', width: '100%', zIndex: 1 }}>
                  <MapResizer />
                  <TileLayer
                    key={isDarkMode ? 'dark' : 'light'}
                    url={isDarkMode 
                      ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                      : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                    }
                    attribution='&copy; <a href="https://carto.com/">CARTO</a>'
                  />
                  
                  {mainRouteCoords.length > 1 && (
                    <Polyline 
                      positions={mainRouteCoords} 
                      pathOptions={{ 
                        color: isTransportBlock ? '#ef4444' : '#3b82f6', 
                        weight: isTransportBlock ? 2.5 : 2, 
                        dashArray: '5, 10', 
                        lineCap: 'round', 
                        opacity: isTransportBlock ? 0.9 : 0.6 
                      }} 
                    />
                  )}

                  <Marker position={[PLACES_DATA.home.lat, PLACES_DATA.home.lon]} icon={homeMapIcon} title="Home" />
                  <Marker position={[PLACES_DATA.hotelOttawa.lat, PLACES_DATA.hotelOttawa.lon]} icon={hotelMapIcon} title="Le Germain Hotel Ottawa" />
                  <Marker position={[PLACES_DATA.hotelMontreal.lat, PLACES_DATA.hotelMontreal.lon]} icon={hotelMapIcon} title="Hotel Monville" />

                  {visibleClusters.map((c) => (
                    c.center_lat && c.center_lon && (
                      <Marker 
                        key={c.activity_id} 
                        position={[c.center_lat, c.center_lon]}
                        icon={c.activity_id === displayActivityId ? activeIcon : inactiveIcon}
                        zIndexOffset={c.activity_id === displayActivityId ? 1000 : 100}
                        eventHandlers={{
                          click: () => setSelectedActivityId(c.activity_id),
                          mouseover: () => setHoveredActivityId(c.activity_id),
                          mouseout: () => setHoveredActivityId(null),
                        }}
                      />
                    )
                  ))}

                  <MapViewController coordinates={mainRouteCoords} resetTrigger={filterResetKey} />
                  <ActivePinFollower activeActivity={activeActivity} />
                </MapContainer>
              </div>
            </div>

            {/* SPLITTER DRAGGER */}
            <div 
              onMouseDown={(e) => { e.preventDefault(); setIsDraggingMainSplitter(true); }} 
              onTouchStart={(e) => { e.preventDefault(); setIsDraggingMainSplitter(true); }} 
              className="w-5 flex-shrink-0 cursor-col-resize flex justify-center items-center group relative z-10 touch-none"
            >
              <div className={`w-1 h-16 rounded-full transition-colors ${isDraggingMainSplitter ? 'bg-red-500' : 'bg-zinc-300 dark:bg-zinc-700 group-hover:bg-red-400'}`} />
            </div>

            {/* RIGHT COLUMN (GALLERY) */}
            <div className="flex-1 flex flex-col min-w-0 pl-2 relative group">
              
              {/* REFINED GALLERY HEADER */}
              <div className="flex-shrink-0 mb-4 h-[60px] flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3 px-1">
                
                <button 
                  onClick={() => handleGalleryNav(-1)} 
                  disabled={!hasPrevGallery && (!largePhotoUrl || activeActivity?.web_photos?.indexOf(largePhotoUrl) === 0)}
                  className={`p-2 rounded-full transition-all active:scale-95 outline-none flex-shrink-0 ${hasPrevGallery || (largePhotoUrl && activeActivity?.web_photos?.indexOf(largePhotoUrl) > 0) ? 'text-zinc-500 hover:text-red-500 bg-zinc-200/50 dark:bg-zinc-800/50 hover:bg-red-100 dark:hover:bg-red-900/30' : 'opacity-0 cursor-default pointer-events-none'}`}
                >
                  <svg className="w-6 h-6 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                </button>

                <div className="flex-1 flex justify-between items-center px-4 overflow-hidden">
                  
                  <div className="flex flex-col items-start min-w-0">
                    <span className="text-[10px] font-mono tracking-widest text-zinc-500 uppercase block mb-1 truncate">
                      {dateStr}
                    </span>
                    <div className="text-[10px] font-mono tracking-widest text-zinc-400 flex items-center gap-1.5 uppercase truncate">
                      <LineWeatherIcon condition={displayCondition} className="w-3.5 h-3.5" />
                      {weatherStr}
                    </div>
                  </div>

                  <div className="text-right flex flex-col items-end flex-shrink-0 ml-2">
                    <span className="text-3xl md:text-4xl font-light tracking-wider text-red-500 dark:text-red-400 uppercase block leading-none whitespace-nowrap">
                      {timeStr}
                    </span>
                  </div>
                </div>

                <button 
                  onClick={() => handleGalleryNav(1)} 
                  disabled={!hasNextGallery && (!largePhotoUrl || activeActivity?.web_photos?.indexOf(largePhotoUrl) === activeActivity?.web_photos?.length - 1)}
                  className={`p-2 rounded-full transition-all active:scale-95 outline-none flex-shrink-0 ${hasNextGallery || (largePhotoUrl && activeActivity?.web_photos?.indexOf(largePhotoUrl) < activeActivity?.web_photos?.length - 1) ? 'text-zinc-500 hover:text-red-500 bg-zinc-200/50 dark:bg-zinc-800/50 hover:bg-red-100 dark:hover:bg-red-900/30' : 'opacity-0 cursor-default pointer-events-none'}`}
                >
                  <svg className="w-6 h-6 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                </button>
              </div>

              {/* GALLERY CONTAINER */}
              <div ref={galleryRef} className="flex-1 overflow-y-auto no-scrollbar relative flex flex-col">
                {largePhotoUrl ? (
                  <div className="relative flex-1 w-full h-full bg-zinc-100 dark:bg-zinc-900 rounded-sm overflow-hidden flex items-center justify-center">
                    <img src={largePhotoUrl} alt="Large View" className={`w-full h-full ${objectFitMode === 'cover' ? 'object-cover' : 'object-contain'}`} />
                    <button onClick={() => setLargePhotoUrl(null)} className="absolute top-3 right-3 bg-black/60 text-white px-3 py-1 text-[10px] font-mono rounded-sm backdrop-blur uppercase z-50">Back to Grid</button>
                  </div>
                ) : (
                  <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${calculatedColumns}, minmax(0, 1fr))` }}>
                    {activeActivity?.web_photos?.map((photoUrl, idx) => (
                      <div key={`photo-${idx}`} ref={idx === 0 ? firstCardRef : null} style={{ height: `${cardHeight}px` }} onClick={() => setLargePhotoUrl(photoUrl)} className="group/card relative bg-zinc-100 dark:bg-zinc-900 rounded-sm overflow-hidden shadow-sm cursor-pointer">
                        <img src={photoUrl} alt={`Photo ${idx}`} loading="lazy" decoding="async" className={`w-full h-full ${objectFitMode === 'cover' ? 'object-cover' : 'object-contain'}`} />
                        
                        {/* CARD RESIZERS */}
                        {idx === 0 && (
                          <div 
                            onMouseDown={(e) => { e.stopPropagation(); setIsResizingWidth(true); }} 
                            onTouchStart={(e) => { e.stopPropagation(); setIsResizingWidth(true); }}
                            className="absolute top-0 right-0 w-5 h-full cursor-ew-resize hover:bg-red-500/40 z-20 touch-none" 
                          />
                        )}
                        {idx === 0 && (
                          <div 
                            onMouseDown={(e) => { e.stopPropagation(); setIsResizingHeight(true); }} 
                            onTouchStart={(e) => { e.stopPropagation(); setIsResizingHeight(true); }}
                            className="absolute bottom-0 left-0 w-full h-5 cursor-ns-resize hover:bg-red-500/40 z-20 touch-none" 
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* GALLERY FOOTER */}
              <div className="flex-shrink-0 mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800 px-2">
                <h3 className="text-xl font-medium tracking-[0.25em] text-zinc-900 dark:text-zinc-50 uppercase truncate">{activeActivity?.title || 'No Activity'}</h3>
                <p className="text-xs tracking-[0.15em] text-zinc-500 dark:text-zinc-400 uppercase mt-1 truncate">
                  {activeActivity?.address || activeActivity?.approx_location || ''}
                </p>
              </div>

            </div>
          </div>
        )}

        {/* UPLOAD MODAL */}
        {isUploadOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-sm w-full max-w-lg p-6 shadow-xl relative">
              <h2 className="text-sm font-medium tracking-[0.25s] uppercase text-zinc-900 dark:text-zinc-50 mb-4">Upload to Travel Log</h2>
              
              <div 
                {...getRootProps()} 
                className={`w-full h-48 border-2 border-dashed rounded-sm flex flex-col items-center justify-center cursor-pointer transition-colors ${
                  isDragActive ? 'border-red-500 bg-red-50 dark:bg-red-900/20' : 'border-zinc-300 dark:border-zinc-700 hover:border-red-400'
                }`}
              >
                <input {...getInputProps()} />
                <span className="text-2xl mb-2">📸</span>
                <p className="text-xs font-mono text-zinc-500 uppercase tracking-widest text-center px-4">
                  {isDragActive ? 'Drop photos here...' : 'Drag & drop photos, or click to select'}
                </p>
              </div>

              {uploadStatus && (
                <div className="mt-4 p-3 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-sm">
                  <p className="text-[10px] font-mono text-center text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">{uploadStatus}</p>
                </div>
              )}

              <button 
                onClick={() => setIsUploadOpen(false)}
                className="absolute top-4 right-4 text-zinc-400 hover:text-red-500 text-xs font-mono uppercase"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {/* UNIVERSAL SHARED SETTINGS MODAL */}
        <NotionSetupModal 
          widgetId="notion" 
          isOpen={isSettingsOpen} 
          onClose={() => setIsSettingsOpen(false)} 
          onSave={fetchData} 
        />
        
      </div>
    </div>
  );
}