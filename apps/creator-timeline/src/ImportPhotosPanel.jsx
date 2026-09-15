import { useState, useRef, useEffect } from 'react';
import exifr from 'exifr';
import { resizeImageForUpload } from './imageResize.js';
import { isNativePhotoPickerSupported, queryPhotosByDateRange, getPhotoThumbnail, getPhotoData } from './nativePhotoPicker.js';

function toDateInputValue(date) {
  const d = new Date(date);
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60000).toISOString().split('T')[0];
}

// Identifies a project across a photo's projectKey and the <select>
// options -- two different sources could otherwise name a project the
// same thing, so source is part of the identity, matching how the
// gallery/sidebar already key projects elsewhere in the app.
const projectKeyOf = (p) => `${p.source}::${p.title}`;

// Below this width the review step swaps the grid+per-photo-dropdown
// layout for a compact tap-to-assign UI (horizontal photo strip over a
// vertical project list) -- matches Tailwind's `sm` breakpoint already
// used elsewhere for the same narrow/wide split.
const MOBILE_BREAKPOINT = 640;

// A "+ Add Project" row shown at the bottom of one source's project list
// in the mobile tap-to-assign step -- desktop's review grid uses a more
// compact inline form instead (no per-source grouped list there to hang
// a row off of), but both end up calling the same submitAddProject.
// Collapses to a single dashed button until tapped, then swaps to a
// plain inline text input, matching LogTitleEditor's click-to-edit
// pattern elsewhere in this app.
function AddProjectRow({ isActive, draft, onDraftChange, onActivate, onCancel, onSubmit, submitting, error }) {
  if (!isActive) {
    return (
      <button
        onClick={onActivate}
        style={{ borderColor: 'var(--theme-border)' }}
        className="w-full text-left p-3 rounded-lg border border-dashed cursor-pointer transition-colors hover:border-[var(--theme-primary)] text-sm font-semibold opacity-60 hover:opacity-100"
      >
        + Add Project
      </button>
    );
  }
  return (
    <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: 'var(--theme-bg)', borderColor: 'var(--theme-primary)' }} className="p-3 rounded-lg border space-y-2">
      <input
        autoFocus
        type="text"
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onSubmit(); if (e.key === 'Escape') onCancel(); }}
        placeholder="New project name"
        style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text)', backgroundColor: 'var(--theme-card)' }}
        className="w-full text-sm px-2 py-1.5 rounded border outline-none"
      />
      {error && <div className="text-[10px]" style={{ color: 'var(--theme-secondary)' }}>{error}</div>}
      <div className="flex items-center justify-end gap-1.5">
        <button onClick={onCancel} className="text-xs font-semibold px-2 py-1 rounded cursor-pointer opacity-60 hover:opacity-100 transition-opacity">
          Cancel
        </button>
        <button
          onClick={onSubmit}
          disabled={submitting || !draft.trim()}
          style={{ backgroundColor: 'var(--theme-primary)' }}
          className="text-xs font-bold text-white px-2.5 py-1 rounded cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          {submitting ? 'Adding…' : 'Add'}
        </button>
      </div>
    </div>
  );
}

// The grouped-by-source, tap-to-assign project list -- shared between
// mobile's step (below its horizontal photo strip) and desktop's (in its
// own left-hand column), since the interaction itself (click a project
// to arm it and assign photos one at a time, or batch-assign whatever's
// already selected) is identical either way, only the surrounding layout
// differs.
//
// Styled to match the app's own Categories sidebar (source header
// typography, the colored-dot project row) rather than its own bespoke
// look, so Import Photos' project list reads as the same list, not a
// different-looking one -- the one deliberate difference is the
// "+ Add Project" row at the bottom of each source, which the sidebar
// itself has no equivalent for. projectColorMap mirrors the sidebar's
// own per-project color overrides; a project with no override there
// falls back to the theme's primary color rather than the sidebar's own
// per-CATEGORY fallback (baseTypeHex), since this list has no "type"
// grouping level to pull one from.
function ProjectAssignList({
  bySource, armedProjectKey, onProjectTap, countByProjectKey, projectColorMap,
  collapsedSources, onToggleSource,
  addProjectSource, newProjectDraft, onNewProjectDraftChange, onAddProjectActivate, onAddProjectCancel, onAddProjectSubmit, creatingProject, createProjectError,
  isEmpty,
}) {
  return (
    <>
      {Object.entries(bySource).map(([source, projs]) => {
        const isCollapsed = collapsedSources.has(source);
        const sourceCount = projs.reduce((sum, p) => sum + (countByProjectKey[projectKeyOf(p)] || 0), 0);
        return (
          <div key={source}>
            <div
              onClick={() => onToggleSource(source)}
              className="flex items-center justify-between px-0.5 cursor-pointer select-none mb-1.5"
            >
              <span className="font-black uppercase tracking-wider opacity-80 text-[11px]">{source}</span>
              <div className="flex items-center gap-2">
                {isCollapsed && sourceCount > 0 && (
                  <span
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                    style={{ backgroundColor: 'var(--theme-primary)', color: '#fff' }}
                  >
                    {sourceCount}
                  </span>
                )}
                <span className="text-[9px] font-mono opacity-50">{isCollapsed ? '▼' : '▲'}</span>
              </div>
            </div>
            {!isCollapsed && (
              <div className="space-y-1.5">
                {projs.map((p) => {
                  const key = projectKeyOf(p);
                  const isArmed = armedProjectKey === key;
                  const count = countByProjectKey[key] || 0;
                  const dotHex = projectColorMap?.[p.title] || 'var(--theme-primary)';
                  return (
                    <div
                      key={key}
                      onClick={() => onProjectTap(key)}
                      style={{
                        backgroundColor: isArmed ? 'var(--theme-primary)' : 'var(--theme-bg)',
                        borderColor: isArmed ? 'var(--theme-primary)' : 'var(--theme-border)',
                        color: isArmed ? '#fff' : 'var(--theme-text)',
                        fontSize: '12px',
                      }}
                      className={`p-2.5 rounded border transition-all cursor-pointer flex items-center gap-2 ${isArmed ? 'font-bold' : ''}`}
                    >
                      <span className="w-2.5 h-2.5 rounded-full shrink-0 border border-white/20 shadow-sm" style={{ backgroundColor: dotHex }} />
                      <span className="truncate flex-1">{p.title}</span>
                      {count > 0 && (
                        <span
                          className="text-xs font-bold px-1.5 py-0.5 rounded-full shrink-0"
                          style={{ backgroundColor: isArmed ? 'rgba(255,255,255,0.25)' : 'var(--theme-primary)', color: '#fff' }}
                        >
                          {count}
                        </span>
                      )}
                    </div>
                  );
                })}
                <AddProjectRow
                  isActive={addProjectSource === source}
                  draft={newProjectDraft}
                  onDraftChange={onNewProjectDraftChange}
                  onActivate={() => onAddProjectActivate(source)}
                  onCancel={onAddProjectCancel}
                  onSubmit={() => onAddProjectSubmit(source)}
                  submitting={creatingProject}
                  error={addProjectSource === source ? createProjectError : null}
                />
              </div>
            )}
          </div>
        );
      })}
      {isEmpty && (
        <div className="text-sm italic opacity-50 text-center py-8">
          No projects found yet -- sync your calendar first.
        </div>
      )}
    </>
  );
}

export default function ImportPhotosPanel({ allProjects, tenantId, onClose, onUploaded, sharedPhotos, onConsumedSharedPhotos, fixedDateRange, projectColorMap }) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < MOBILE_BREAKPOINT);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Every photo carries its own projectKey, starting unassigned ('') --
  // set individually (desktop's per-photo dropdown, mobile's tap-to-assign
  // strip) once photos are already in the batch, not picked up front.
  // Used to require picking a "default project" before you could even see
  // an "+ Add Photos" button at all on desktop; dropped in favor of
  // dump-first-categorize-after everywhere, matching how mobile already
  // worked.
  const [photos, setPhotos] = useState([]);
  // Opened for a specific day/week on the Android app -- skip straight to
  // the native MediaStore picker instead of landing on the (at that point
  // still-empty) categorization screen first and making the user tap
  // "+ Add Photos" a second time to actually see any photos.
  const [step, setStep] = useState(() => {
    if (isNativePhotoPickerSupported() && fixedDateRange) return 'native-pick';
    return 'review';
  }); // native-pick | review | uploading | done
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 });
  const [uploadResults, setUploadResults] = useState({ byProject: [], failed: [] });
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  // Mobile tap-to-assign state: tapping photos with no project armed
  // multi-selects them (checkboxes); tapping a project with photos
  // selected assigns all of them and clears the selection. Tapping a
  // project with NOTHING selected arms it instead, and every photo
  // tapped after that is assigned to it immediately, one at a time,
  // until the project is tapped again to disarm -- covers both
  // "photos first" and "project first" orderings without the two modes
  // fighting each other (only one is ever active: armed OR multi-select).
  const [selectedPhotoIds, setSelectedPhotoIds] = useState(() => new Set());
  const [armedProjectKey, setArmedProjectKey] = useState(null);

  // Which source (database) groups are collapsed in the project list --
  // shared between the project-picker step and the mobile tap-to-assign
  // list below, since both group the same projects by source the same way.
  const [collapsedSources, setCollapsedSources] = useState(() => new Set());
  const toggleSourceCollapse = (source) => {
    setCollapsedSources((prev) => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source); else next.add(source);
      return next;
    });
  };

  // Projects created THIS session via "+ Add Project" (see AddProjectRow)
  // -- allProjects only ever lists projects that already have at least
  // one synced log entry, so a brand-new one has nowhere else to live
  // until the user eventually logs something under it and re-syncs.
  // Merged into every {source: [...]} grouping and into startUpload's
  // own project lookup right alongside allProjects.
  const [newlyCreatedProjects, setNewlyCreatedProjects] = useState([]);
  const effectiveProjects = [...allProjects, ...newlyCreatedProjects];
  // Which source's inline "+ Add Project" input is currently open --
  // only one at a time, mirroring armedProjectKey's single-active-mode
  // pattern above.
  const [addProjectSource, setAddProjectSource] = useState(null);
  const [newProjectDraft, setNewProjectDraft] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);
  const [createProjectError, setCreateProjectError] = useState(null);

  const cancelAddProject = () => {
    setAddProjectSource(null);
    setNewProjectDraft('');
    setCreateProjectError(null);
  };

  // referenceLogId is only ever used structurally (which property is the
  // relation, which database it points to) -- ANY existing project in
  // the same source works, including one added earlier this same session,
  // so a database with zero synced projects is the only case with truly
  // nothing to bootstrap a new one from.
  const submitAddProject = async (source) => {
    const title = newProjectDraft.trim();
    if (!title) return;
    const reference = effectiveProjects.find((p) => p.source === source);
    if (!reference) {
      setCreateProjectError('Need at least one existing project in this database first.');
      return;
    }
    setCreatingProject(true);
    setCreateProjectError(null);
    try {
      const response = await fetch('/api/backlog-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, action: 'createProject', referenceLogId: reference.referenceLogId, newProjectTitle: title }),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Could not create project');
      setNewlyCreatedProjects((prev) => [...prev, { title, source, referenceLogId: reference.referenceLogId, projectPageId: result.projectPageId }]);
      cancelAddProject();
    } catch (err) {
      setCreateProjectError(err.message);
    } finally {
      setCreatingProject(false);
    }
  };

  // Object URLs are only good until the tab/component goes away -- clean
  // up whatever's still outstanding rather than leaking them.
  useEffect(() => {
    return () => photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
  }, []);

  // Set (non-null) whenever a photo gets excluded for falling outside
  // fixedDateRange -- surfaced as a brief notice rather than silently
  // dropping photos the user explicitly picked.
  const [skippedOutOfRangeCount, setSkippedOutOfRangeCount] = useState(0);

  // Native picker (Android app only, see nativePhotoPicker.js) -- MediaStore
  // itself gets queried for photos taken (or, failing that, last modified)
  // within fixedDateRange, so unlike the web <input type=file> path there's
  // nothing to filter after the fact: everything shown here already
  // belongs in this window. Thumbnails are fetched once, up front, for the
  // whole result set; the full-resolution bytes for whatever gets picked
  // aren't pulled until upload time (see startUpload), so selecting a lot
  // of photos here doesn't mean decoding a lot of photos here.
  const [nativePickPhotos, setNativePickPhotos] = useState([]);
  const [nativePickSelected, setNativePickSelected] = useState(() => new Set());
  const [nativePickLoading, setNativePickLoading] = useState(false);
  const [nativePickError, setNativePickError] = useState(null);

  // Per-date-block results cache (uri+thumbnail included), keyed by
  // "start::end" -- swiping to a block that's already in here shows
  // instantly, no MediaStore query or thumbnail decoding on the swipe
  // itself, which is what was actually causing the lag: each swipe was
  // triggering that whole pipeline fresh, same as the very first open. A
  // ref, not state, since populating it should never itself cause a
  // render (the scan functions below already set state when a render IS
  // warranted).
  const nativeScanCacheRef = useRef(new Map());
  const rangeKey = (r) => `${r.start}::${r.end}`;
  // Ignore a stale fetch resolving after a newer one (rapid swipes) --
  // whichever runNativeScan call is most recent wins the state update.
  const scanRequestIdRef = useRef(0);

  // Mirrors shiftImportDateRange's day-vs-week granularity (App.jsx) --
  // duplicated rather than imported since this panel only ever sees the
  // resulting fixedDateRange prop, not that app-level function. Used only
  // to know what to prefetch, never to actually change the active range.
  const adjacentRange = (range, direction) => {
    const [sy, sm, sd] = range.start.split('-').map(Number);
    const [ey, em, ed] = range.end.split('-').map(Number);
    const days = (range.start === range.end ? 1 : 7) * direction;
    const newStart = new Date(sy, sm - 1, sd);
    newStart.setDate(newStart.getDate() + days);
    const newEnd = new Date(ey, em - 1, ed);
    newEnd.setDate(newEnd.getDate() + days);
    return { start: toDateInputValue(newStart), end: toDateInputValue(newEnd) };
  };

  const fetchRangePhotos = async (range) => {
    const results = await queryPhotosByDateRange(range.start, range.end);
    return Promise.all(results.map(async (p) => {
      try {
        const thumbnail = await getPhotoThumbnail(p.uri);
        return { ...p, thumbnail };
      } catch {
        return { ...p, thumbnail: null };
      }
    }));
  };

  // Fetches (or serves from cache) fixedDateRange's photos into the
  // visible grid, then silently warms the cache for the immediately
  // adjacent blocks in the background. By the time a swipe actually
  // lands on one of those, its data is normally already cached, so the
  // grid updates instantly instead of showing another loading spinner --
  // the same instant feel as Mandalart's own date-block swiping.
  const runNativeScan = async () => {
    const requestId = ++scanRequestIdRef.current;
    const range = fixedDateRange;
    const key = rangeKey(range);
    const cached = nativeScanCacheRef.current.get(key);

    setNativePickSelected(new Set());
    setNativePickError(null);

    if (cached) {
      setNativePickPhotos(cached);
      setNativePickLoading(false);
    } else {
      setNativePickLoading(true);
      try {
        const withThumbs = await fetchRangePhotos(range);
        nativeScanCacheRef.current.set(key, withThumbs);
        if (scanRequestIdRef.current === requestId) setNativePickPhotos(withThumbs);
      } catch (err) {
        if (scanRequestIdRef.current === requestId) {
          setNativePickError(err.message || 'Could not load photos from your device.');
        }
      } finally {
        if (scanRequestIdRef.current === requestId) setNativePickLoading(false);
      }
    }

    // Fire-and-forget: errors here just mean that neighbor falls back to
    // the normal (visible) loading path if the user actually swipes
    // there before it finishes.
    [1, -1].forEach((direction) => {
      const neighbor = adjacentRange(range, direction);
      const neighborKey = rangeKey(neighbor);
      if (nativeScanCacheRef.current.has(neighborKey)) return;
      fetchRangePhotos(neighbor)
        .then((photos) => { nativeScanCacheRef.current.set(neighborKey, photos); })
        .catch(() => {});
    });
  };

  const openNativePicker = () => {
    setStep('native-pick');
  };

  // Runs the MediaStore scan whenever the native-pick step becomes
  // active -- covers both "opened directly into the picker" (see the step
  // lazy initializer above) and openNativePicker() switching into it from
  // elsewhere -- AND whenever fixedDateRange itself changes while already
  // sitting on this step, which is what actually makes swiping to an
  // adjacent date block (shiftImportDateRange in App.jsx) show that
  // date's photos instead of leaving the grid frozen on whatever was
  // queried at mount time.
  useEffect(() => {
    if (step === 'native-pick') runNativeScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, fixedDateRange?.start, fixedDateRange?.end]);

  const toggleNativePick = (uri) => {
    setNativePickSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uri)) next.delete(uri); else next.add(uri);
      return next;
    });
  };

  const confirmNativePick = () => {
    const chosen = nativePickPhotos.filter((p) => nativePickSelected.has(p.uri));
    const newPhotos = chosen.map((p) => ({
      id: `native-${p.uri}`,
      file: null,
      nativeUri: p.uri,
      displayName: p.displayName,
      previewUrl: p.thumbnail,
      date: toDateInputValue(new Date(p.dateTaken)),
      hasExif: true,
      projectKey: '',
    }));
    setPhotos((prev) => [...prev, ...newPhotos]);
    setStep('review');
  };

  const photoFromFile = async (file, exifOverrideDate) => {
    const previewUrl = URL.createObjectURL(file);
    let date = new Date();
    let hasReliableDate = false;
    if (exifOverrideDate) {
      // Already extracted server-side (see share-target.js) from the
      // original, full-EXIF bytes -- re-reading EXIF from this same file
      // client-side would just repeat that same lookup.
      date = new Date(exifOverrideDate);
      hasReliableDate = true;
    } else {
      try {
        const exif = await exifr.parse(file, { pick: ['DateTimeOriginal', 'CreateDate'] });
        const exifDate = exif?.DateTimeOriginal || exif?.CreateDate;
        if (exifDate instanceof Date && !isNaN(exifDate.getTime())) {
          date = exifDate;
          hasReliableDate = true;
        }
      } catch (err) {
        // No EXIF, or a format exifr can't read -- HEIC in particular
        // (the default format on modern iPhones) frequently fails to
        // parse in-browser even though the photo does have a real date.
      }
      if (!hasReliableDate && file.lastModified && Date.now() - file.lastModified > 60 * 60 * 1000) {
        // Fall back to the file's own last-modified time, which the OS's
        // photo picker generally sets to the original capture date even
        // when the EXIF block itself couldn't be read. Without this,
        // every HEIC (or otherwise unparseable) photo silently falls
        // through the date-range filter below instead of being checked
        // against it -- the "older than an hour" guard is there so a
        // freshly-exported temp file (lastModified == right now, no real
        // signal) doesn't get mistaken for a genuine date.
        const modDate = new Date(file.lastModified);
        if (!isNaN(modDate.getTime())) {
          date = modDate;
          hasReliableDate = true;
        }
      }
    }

    let dateStr = toDateInputValue(date);
    if (fixedDateRange) {
      if (hasReliableDate && (dateStr < fixedDateRange.start || dateStr > fixedDateRange.end)) {
        // Has a real date and it falls outside the requested day/week --
        // excluded. The device's own photo picker has no way to filter
        // itself by date (there's no web API for that), so it always shows
        // the whole camera roll regardless of where this button was
        // opened from; this is the actual filtering, applied to whatever
        // gets picked out of it.
        return null;
      }
      if (!hasReliableDate) {
        // No reliable date of its own (screenshot, or a format nothing
        // above could read) -- can't judge whether it belongs here, so
        // instead of rejecting it outright it defaults into the requested
        // window: the single day for Day view, the first day of the week
        // for Week view.
        dateStr = fixedDateRange.start;
      }
    }

    return {
      id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
      file,
      previewUrl,
      date: dateStr,
      hasExif: hasReliableDate,
      projectKey: '',
    };
  };

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
    const results = await Promise.all(files.map((file) => photoFromFile(file)));
    const newPhotos = results.filter(Boolean);
    if (fixedDateRange) setSkippedOutOfRangeCount((prev) => prev + (results.length - newPhotos.length));
    setPhotos((prev) => [...prev, ...newPhotos]);
  };

  // Photos that arrived via the Android share-target landing (App.jsx) are
  // waiting on `sharedPhotos` until a project is picked -- pick them up
  // the moment the review screen for that project opens, exactly once.
  useEffect(() => {
    if (step !== 'review' || !sharedPhotos || sharedPhotos.length === 0) return;
    (async () => {
      const newPhotos = await Promise.all(sharedPhotos.map(({ file, capturedAt }) => photoFromFile(file, capturedAt)));
      setPhotos((prev) => [...prev, ...newPhotos]);
      onConsumedSharedPhotos();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, sharedPhotos]);

  const updatePhotoDate = (id, newDate) => {
    setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, date: newDate, hasExif: false } : p)));
  };

  const updatePhotoProject = (id, newProjectKey) => {
    setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, projectKey: newProjectKey } : p)));
  };

  // Mobile tap-to-assign -- see the state comment above for the model.
  const handlePhotoTap = (id) => {
    if (armedProjectKey) {
      updatePhotoProject(id, armedProjectKey);
      return;
    }
    setSelectedPhotoIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleProjectTap = (key) => {
    if (selectedPhotoIds.size > 0) {
      setPhotos((prev) => prev.map((p) => (selectedPhotoIds.has(p.id) ? { ...p, projectKey: key } : p)));
      setSelectedPhotoIds(new Set());
      return;
    }
    setArmedProjectKey((prev) => (prev === key ? null : key));
  };

  // Desktop-only batch selection: shift+click a photo to select the
  // whole range from the last plain click to it (standard file-manager
  // behavior), or click-and-drag across empty grid space to draw a
  // marquee and select whatever it touches. Neither has a mobile
  // equivalent (no shift key, no mouse drag there) -- mobile keeps
  // using handlePhotoTap directly.
  const lastClickedPhotoIndexRef = useRef(null);
  const handleDesktopPhotoClick = (photo, index, e) => {
    if (e.shiftKey && lastClickedPhotoIndexRef.current !== null) {
      const start = Math.min(lastClickedPhotoIndexRef.current, index);
      const end = Math.max(lastClickedPhotoIndexRef.current, index);
      const rangeIds = photos.slice(start, end + 1).map((p) => p.id);
      // Mirrors handlePhotoTap's own armed-vs-select branching, just
      // applied to the whole range instead of one photo -- the anchor
      // (lastClickedPhotoIndexRef) deliberately doesn't move on a
      // shift+click, so a second shift+click extends/shrinks the SAME
      // range rather than chaining off the last one, matching how
      // Explorer/Finder-style range select behaves.
      if (armedProjectKey) {
        setPhotos((prev) => prev.map((p) => (rangeIds.includes(p.id) ? { ...p, projectKey: armedProjectKey } : p)));
      } else {
        setSelectedPhotoIds((prev) => new Set([...prev, ...rangeIds]));
      }
      return;
    }
    lastClickedPhotoIndexRef.current = index;
    handlePhotoTap(photo.id);
  };

  // Marquee (click-and-drag) selection over empty grid space -- viewport
  // (clientX/Y) coordinates throughout, compared directly against each
  // tile's own getBoundingClientRect(), so none of this has to reason
  // about the grid's own scroll offset.
  const [isDragSelecting, setIsDragSelecting] = useState(false);
  const [dragBox, setDragBox] = useState(null);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const photoTileRefs = useRef({});

  const handleGridMouseDown = (e) => {
    if (e.button !== 0) return; // left click/drag only
    if (e.target.closest('[data-photo-tile]')) return; // a tile's own onClick handles that
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    setArmedProjectKey(null); // a marquee always means "select", not "assign as you go"
    setSelectedPhotoIds(new Set()); // a plain click on empty space starts a fresh selection
    setIsDragSelecting(true);
    setDragBox({ left: e.clientX, top: e.clientY, width: 0, height: 0 });
  };

  useEffect(() => {
    if (!isDragSelecting) return;
    const handleMove = (e) => {
      const { x: startX, y: startY } = dragStartRef.current;
      const left = Math.min(startX, e.clientX);
      const top = Math.min(startY, e.clientY);
      const width = Math.abs(e.clientX - startX);
      const height = Math.abs(e.clientY - startY);
      setDragBox({ left, top, width, height });
      const right = left + width;
      const bottom = top + height;
      const idsInRect = Object.keys(photoTileRefs.current).filter((id) => {
        const el = photoTileRefs.current[id];
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.left < right && r.right > left && r.top < bottom && r.bottom > top;
      });
      setSelectedPhotoIds(new Set(idsInRect));
    };
    const handleUp = () => {
      setIsDragSelecting(false);
      setDragBox(null);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isDragSelecting]);

  const removePhoto = (id) => {
    setPhotos((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
    setSelectedPhotoIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const startUpload = async () => {
    setStep('uploading');
    setUploadProgress({ done: 0, total: photos.length });
    const failed = [];
    const succeededByProject = new Map(); // projectKey -> count
    let doneCount = 0;

    // Photos backlogged for the same PROJECT and DATE land on ONE page
    // (multiple image blocks) instead of one page each -- group by both,
    // not just date, so two photos on the same day but different projects
    // correctly end up as two separate pages. Within each group, the
    // first photo uploads in "create" mode and every photo after it
    // chains onto the page that call returns via `pageId` (see
    // backlog-photo.js). If the first photo in a group fails, the next
    // one just falls back to creating its own page rather than the whole
    // group silently vanishing.
    const groups = new Map();
    photos.forEach((photo) => {
      const groupKey = `${photo.projectKey}::${photo.date}`;
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push(photo);
    });

    for (const groupPhotos of groups.values()) {
      const { date, projectKey } = groupPhotos[0];
      const groupProject = effectiveProjects.find((p) => projectKeyOf(p) === projectKey);
      let pageId = null;

      if (!groupProject) {
        // Shouldn't happen (every photo's projectKey comes from
        // effectiveProjects), but fail that group's photos explicitly
        // rather than silently dropping them if it ever does.
        groupPhotos.forEach((photo) => {
          failed.push({ name: photo.file?.name || photo.displayName || 'photo', error: 'No project selected for this photo' });
          doneCount++;
        });
        setUploadProgress({ done: doneCount, total: photos.length });
        continue;
      }

      // `date` is a bare "YYYY-MM-DD" -- new Date(date) would parse that as
      // UTC midnight (a spec guarantee for date-only ISO strings) and then
      // render it in the browser's LOCAL timezone, which is exactly the
      // bug just fixed on the write side, just for the title text instead
      // of the Notion date property. Building the Date from the parsed
      // components instead keeps it entirely in local semantics, so
      // formatting can't shift it across a day boundary.
      const [dY, dM, dD] = date.split('-').map(Number);
      const formattedDate = new Date(dY, dM - 1, dD).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

      for (const photo of groupPhotos) {
        try {
          // Native-picked photos (photo.nativeUri set) were never a File
          // to begin with -- the plugin already downscaled/re-encoded them
          // on the Android side (see DateFilteredPhotoPickerPlugin's
          // getPhotoData), so this just fetches those bytes now rather
          // than up front for every photo in the picker grid.
          const imageBase64 = photo.nativeUri
            ? await getPhotoData(photo.nativeUri)
            : await resizeImageForUpload(photo.file);
          const body = pageId
            ? { tenantId, pageId, imageBase64 }
            : {
                tenantId,
                referenceLogId: groupProject.referenceLogId,
                title: `${groupProject.title} — ${formattedDate}`,
                dateTaken: date,
                imageBase64,
                // Only set for a project created THIS session via
                // "+ Add Project" -- tells backlog-photo.js to link this
                // entry to the newly-created project page instead of
                // copying referenceLogId's own (unrelated) project.
                ...(groupProject.projectPageId ? { projectPageId: groupProject.projectPageId } : {}),
              };

          const response = await fetch('/api/backlog-photo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const result = await response.json();
          if (!result.success) throw new Error(result.error || 'Upload failed');
          if (!pageId) pageId = result.pageId;
          succeededByProject.set(groupProject.title, (succeededByProject.get(groupProject.title) || 0) + 1);
        } catch (err) {
          failed.push({ name: photo.file?.name || photo.displayName || 'photo', error: err.message });
        }
        doneCount++;
        setUploadProgress({ done: doneCount, total: photos.length });
      }
    }

    setUploadResults({
      byProject: Array.from(succeededByProject, ([title, count]) => ({ title, count })),
      failed,
    });
    setStep('done');
    onUploaded();
  };

  const resetToStart = () => {
    photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    setPhotos([]);
    setSelectedPhotoIds(new Set());
    setArmedProjectKey(null);
    setUploadResults({ byProject: [], failed: [] });
    setStep('review');
  };

  // -----------------------------------------------------------------

  // -----------------------------------------------------------------
  // NATIVE PICKER (Android app only): MediaStore already filtered this to
  // fixedDateRange, so every thumbnail shown here is fair game -- no
  // per-photo date badge/notice needed the way the web <input type=file>
  // path has, since there's nothing to filter after the fact.
  // -----------------------------------------------------------------
  if (step === 'native-pick') {
    const dateRangeLabel = fixedDateRange
      ? fixedDateRange.start === fixedDateRange.end
        ? 'this day'
        : 'this range'
      : '';
    return (
      <div className="flex flex-col h-full w-full min-h-0">
        <div className="flex items-center justify-between gap-2 mb-3 shrink-0">
          <button
            onClick={() => setStep('review')}
            className="text-xs font-semibold cursor-pointer hover:opacity-70"
            style={{ color: 'var(--theme-primary)' }}
          >
            ‹ Cancel
          </button>
          <button
            onClick={confirmNativePick}
            disabled={nativePickSelected.size === 0}
            style={{ backgroundColor: 'var(--theme-primary)' }}
            className="text-sm font-bold text-white px-4 py-2 rounded-lg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Add {nativePickSelected.size > 0 ? nativePickSelected.size : ''} Photo{nativePickSelected.size === 1 ? '' : 's'}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {nativePickLoading ? (
            <div className="h-full flex items-center justify-center text-sm italic opacity-50">Scanning your photos…</div>
          ) : nativePickError ? (
            <div className="h-full flex items-center justify-center text-sm text-center px-4" style={{ color: 'var(--theme-secondary)' }}>
              {nativePickError}
            </div>
          ) : nativePickPhotos.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm italic opacity-50 text-center px-4">
              No photos found on your phone for {dateRangeLabel}.
            </div>
          ) : (
            <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))' }}>
              {nativePickPhotos.map((p) => {
                const isSelected = nativePickSelected.has(p.uri);
                return (
                  <div
                    key={p.uri}
                    onClick={() => toggleNativePick(p.uri)}
                    className="relative rounded-lg overflow-hidden cursor-pointer"
                    style={{
                      aspectRatio: '1',
                      backgroundColor: 'var(--theme-card)',
                      border: isSelected ? '3px solid var(--theme-secondary)' : '1px solid var(--theme-border)',
                    }}
                  >
                    {p.thumbnail ? (
                      <img src={p.thumbnail} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs opacity-40">?</div>
                    )}
                    {isSelected && (
                      <div
                        className="absolute top-1 right-1 w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-black"
                        style={{ backgroundColor: 'var(--theme-secondary)' }}
                      >
                        ✓
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // -----------------------------------------------------------------
  // STEP 2 (mobile): a horizontal strip of photos over a vertical list of
  // projects -- tap photos then a project to batch-assign, or tap a
  // project then photos to paint-assign one at a time (see
  // handlePhotoTap/handleProjectTap above). Replaces the grid+dropdown
  // layout below, which stays for desktop where there's room for it.
  // -----------------------------------------------------------------
  if (step === 'review' && isMobile) {
    const bySource = {};
    effectiveProjects.forEach((p) => {
      if (!bySource[p.source]) bySource[p.source] = [];
      bySource[p.source].push(p);
    });
    const countByProjectKey = {};
    photos.forEach((p) => {
      if (p.projectKey) countByProjectKey[p.projectKey] = (countByProjectKey[p.projectKey] || 0) + 1;
    });
    const unassignedCount = photos.filter((p) => !p.projectKey).length;

    // Swiping to an adjacent date block (see shiftImportDateRange in
    // App.jsx) only moves fixedDateRange -- it doesn't touch `photos`
    // itself, so anything already staged for a different date would
    // otherwise keep showing in the strip no matter which block's header
    // is displayed. Scoping the strip to just what falls in the CURRENT
    // block is what actually makes the swipe read as "now looking at a
    // different date's photos" -- nothing staged for other blocks is lost,
    // it's just not shown until swiping back to that date.
    const visiblePhotos = fixedDateRange
      ? photos.filter((p) => p.date >= fixedDateRange.start && p.date <= fixedDateRange.end)
      : photos;

    return (
      <div className="flex flex-col h-full w-full min-h-0">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }}
        />

        <div className="flex items-center justify-between gap-2 mb-3 shrink-0">
          <button
            onClick={() => {
              if (isNativePhotoPickerSupported() && fixedDateRange) openNativePicker();
              else fileInputRef.current?.click();
            }}
            style={{ backgroundColor: 'var(--theme-bg)', borderColor: 'var(--theme-border)' }}
            className="text-xs font-semibold px-3 py-2 rounded-lg border cursor-pointer shrink-0"
          >
            + Add Photos
          </button>
          <button
            onClick={startUpload}
            disabled={photos.length === 0 || unassignedCount > 0}
            title={unassignedCount > 0 ? `${unassignedCount} photo${unassignedCount === 1 ? '' : 's'} still need${unassignedCount === 1 ? 's' : ''} a project` : undefined}
            style={{ backgroundColor: 'var(--theme-primary)' }}
            className="text-sm font-bold text-white px-4 py-2 rounded-lg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            Upload {photos.length}
          </button>
        </div>

        {skippedOutOfRangeCount > 0 && (
          <div className="shrink-0 mb-2 text-xs italic opacity-60">
            Skipped {skippedOutOfRangeCount} photo{skippedOutOfRangeCount === 1 ? '' : 's'} taken outside this date range.
          </div>
        )}

        {/* Horizontal photo strip */}
        <div className="shrink-0 mb-2 -mx-1 px-1 overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
          {visiblePhotos.length === 0 ? (
            <div className="text-xs italic opacity-50 py-8 text-center">
              {photos.length > 0
                ? 'No photos staged for this date yet — swipe back, or tap "+ Add Photos" above.'
                : 'No photos yet — tap "+ Add Photos" above.'}
            </div>
          ) : (
            <div className="flex gap-2 pb-1" style={{ width: 'max-content' }}>
              {visiblePhotos.map((photo) => {
                const isSelected = selectedPhotoIds.has(photo.id);
                const assignedProject = photo.projectKey ? effectiveProjects.find((p) => projectKeyOf(p) === photo.projectKey) : null;
                return (
                  <div key={photo.id} className="shrink-0" style={{ width: '92px' }}>
                    <div
                      onClick={() => handlePhotoTap(photo.id)}
                      className="relative rounded-lg overflow-hidden cursor-pointer"
                      style={{
                        width: '92px',
                        height: '92px',
                        backgroundColor: 'var(--theme-card)',
                        border: isSelected ? '3px solid var(--theme-secondary)' : '1px solid var(--theme-border)',
                      }}
                    >
                      <img src={photo.previewUrl} alt="" className="w-full h-full object-cover" />
                      <button
                        onClick={(e) => { e.stopPropagation(); removePhoto(photo.id); }}
                        title="Remove"
                        className="absolute top-0.5 right-0.5 w-6 h-6 rounded-full bg-black/60 text-white text-sm flex items-center justify-center cursor-pointer"
                      >
                        ×
                      </button>
                      {isSelected && (
                        <div
                          className="absolute top-0.5 left-0.5 w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-black"
                          style={{ backgroundColor: 'var(--theme-secondary)' }}
                        >
                          ✓
                        </div>
                      )}
                      {!photo.hasExif && (
                        <div
                          title="No reliable date found -- check the date below"
                          className="absolute bottom-1 left-1 w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: 'var(--theme-secondary)' }}
                        />
                      )}
                      <div className="absolute bottom-0 inset-x-0 px-1 py-0.5 text-center" style={{ backgroundColor: 'rgba(0,0,0,0.65)' }}>
                        <div className="text-[9px] font-bold text-white truncate">{assignedProject ? assignedProject.title : 'Unassigned'}</div>
                      </div>
                    </div>
                    <input
                      type="date"
                      value={photo.date}
                      onChange={(e) => updatePhotoDate(photo.id, e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ backgroundColor: 'var(--theme-bg)', borderColor: 'var(--theme-border)', color: 'var(--theme-text)' }}
                      className="w-full mt-1 text-[10px] px-1 py-0.5 rounded border"
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="text-xs opacity-60 mb-2 shrink-0">
          {armedProjectKey
            ? `Assigning to "${effectiveProjects.find((p) => projectKeyOf(p) === armedProjectKey)?.title}" — tap photos, or tap the project again to stop.`
            : selectedPhotoIds.size > 0
              ? `${selectedPhotoIds.size} photo${selectedPhotoIds.size === 1 ? '' : 's'} selected — tap a project below to assign.`
              : 'Tap photos to select them, or tap a project to start assigning.'}
        </div>

        {/* Vertical project list */}
        <div className="flex-1 overflow-y-auto min-h-0 space-y-3 pr-1">
          <ProjectAssignList
            bySource={bySource}
            armedProjectKey={armedProjectKey}
            onProjectTap={handleProjectTap}
            countByProjectKey={countByProjectKey}
            projectColorMap={projectColorMap}
            collapsedSources={collapsedSources}
            onToggleSource={toggleSourceCollapse}
            addProjectSource={addProjectSource}
            newProjectDraft={newProjectDraft}
            onNewProjectDraftChange={setNewProjectDraft}
            onAddProjectActivate={(source) => { setAddProjectSource(source); setNewProjectDraft(''); setCreateProjectError(null); }}
            onAddProjectCancel={cancelAddProject}
            onAddProjectSubmit={submitAddProject}
            creatingProject={creatingProject}
            createProjectError={createProjectError}
            isEmpty={effectiveProjects.length === 0}
          />
        </div>
      </div>
    );
  }

  // -----------------------------------------------------------------
  // STEP 2 (desktop): same dump-first, tap-to-assign interaction as
  // mobile (handlePhotoTap/handleProjectTap, armedProjectKey/
  // selectedPhotoIds below) -- just laid out as a left-hand project list
  // (matching the app's own Categories sidebar) beside a photo grid,
  // instead of a vertical list below a horizontal strip. The list itself
  // is the same ProjectAssignList component mobile's step uses.
  // -----------------------------------------------------------------
  if (step === 'review') {
    const bySource = {};
    effectiveProjects.forEach((p) => {
      if (!bySource[p.source]) bySource[p.source] = [];
      bySource[p.source].push(p);
    });
    const countByProjectKey = {};
    photos.forEach((p) => {
      if (p.projectKey) countByProjectKey[p.projectKey] = (countByProjectKey[p.projectKey] || 0) + 1;
    });
    const unassignedCount = photos.filter((p) => !p.projectKey).length;

    return (
      <div className="flex flex-col h-full w-full min-h-0">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }}
        />

        <div className="flex items-center justify-between gap-3 mb-4 shrink-0">
          {skippedOutOfRangeCount > 0 ? (
            <div className="text-xs italic opacity-60">
              Skipped {skippedOutOfRangeCount} photo{skippedOutOfRangeCount === 1 ? '' : 's'} taken outside this date range.
            </div>
          ) : <div />}
          <button
            onClick={startUpload}
            disabled={photos.length === 0 || unassignedCount > 0}
            title={unassignedCount > 0 ? `${unassignedCount} photo${unassignedCount === 1 ? '' : 's'} still need${unassignedCount === 1 ? 's' : ''} a project` : undefined}
            style={{ backgroundColor: 'var(--theme-primary)' }}
            className="px-4 py-2 text-sm font-bold text-white rounded-lg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-opacity shrink-0"
          >
            Upload {photos.length} Photo{photos.length === 1 ? '' : 's'}
          </button>
        </div>

        <div className="flex-1 flex gap-4 min-h-0">
          {/* LEFT: project list, styled like the app's own Categories
              sidebar -- click a project to arm it (then click photos to
              assign them one at a time), or select photos first and
              click a project to batch-assign them all at once. */}
          <div className="w-60 shrink-0 flex flex-col min-h-0">
            <div className="text-xs opacity-60 mb-2 shrink-0">
              {armedProjectKey
                ? `Assigning to "${effectiveProjects.find((p) => projectKeyOf(p) === armedProjectKey)?.title}" — click photos, or click the project again to stop.`
                : selectedPhotoIds.size > 0
                  ? `${selectedPhotoIds.size} photo${selectedPhotoIds.size === 1 ? '' : 's'} selected — click a project to assign.`
                  : 'Click photos to select them, or click a project to start assigning.'}
            </div>
            <div className="flex-1 overflow-y-auto min-h-0 space-y-3 pr-1">
              <ProjectAssignList
                bySource={bySource}
                armedProjectKey={armedProjectKey}
                onProjectTap={handleProjectTap}
                countByProjectKey={countByProjectKey}
                projectColorMap={projectColorMap}
                collapsedSources={collapsedSources}
                onToggleSource={toggleSourceCollapse}
                addProjectSource={addProjectSource}
                newProjectDraft={newProjectDraft}
                onNewProjectDraftChange={setNewProjectDraft}
                onAddProjectActivate={(source) => { setAddProjectSource(source); setNewProjectDraft(''); setCreateProjectError(null); }}
                onAddProjectCancel={cancelAddProject}
                onAddProjectSubmit={submitAddProject}
                creatingProject={creatingProject}
                createProjectError={createProjectError}
                isEmpty={effectiveProjects.length === 0}
              />
            </div>
          </div>

          {/* RIGHT: add photos + the grid itself */}
          <div className="flex-1 flex flex-col min-h-0">
            <div
              onClick={() => {
                if (isNativePhotoPickerSupported() && fixedDateRange) openNativePicker();
                else fileInputRef.current?.click();
              }}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFiles(e.dataTransfer.files); }}
              style={{
                borderColor: isDragging ? 'var(--theme-primary)' : 'var(--theme-border)',
                backgroundColor: isDragging ? 'var(--theme-bg)' : 'transparent',
              }}
              className="shrink-0 mb-3 border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors"
            >
              <div className="text-sm font-semibold opacity-70">+ Add Photos</div>
              <div className="text-xs opacity-50 mt-1">Click to browse, or drag and drop -- dates are read from each photo automatically</div>
            </div>

            <div onMouseDown={handleGridMouseDown} className="flex-1 overflow-y-auto min-h-0 pr-1">
              {photos.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm italic opacity-50">
                  No photos added yet.
                </div>
              ) : (
                <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' }}>
                  {photos.map((photo, index) => {
                    const isSelected = selectedPhotoIds.has(photo.id);
                    const assignedProject = photo.projectKey ? effectiveProjects.find((p) => projectKeyOf(p) === photo.projectKey) : null;
                    return (
                      <div key={photo.id}>
                        <div
                          ref={(el) => { if (el) photoTileRefs.current[photo.id] = el; else delete photoTileRefs.current[photo.id]; }}
                          data-photo-tile
                          onClick={(e) => handleDesktopPhotoClick(photo, index, e)}
                          className="relative rounded-lg overflow-hidden cursor-pointer aspect-square"
                          style={{
                            backgroundColor: 'var(--theme-card)',
                            border: isSelected ? '3px solid var(--theme-secondary)' : '1px solid var(--theme-border)',
                          }}
                        >
                          <img src={photo.previewUrl} alt="" className="w-full h-full object-cover" />
                          <button
                            onClick={(e) => { e.stopPropagation(); removePhoto(photo.id); }}
                            title="Remove"
                            className="absolute top-1 right-1 w-7 h-7 rounded-full bg-black/60 text-white text-base flex items-center justify-center cursor-pointer hover:bg-black/80"
                          >
                            ×
                          </button>
                          {isSelected && (
                            <div
                              className="absolute top-1 left-1 w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-black"
                              style={{ backgroundColor: 'var(--theme-secondary)' }}
                            >
                              ✓
                            </div>
                          )}
                          {!photo.hasExif && (
                            <div
                              title="No reliable date found -- check the date below"
                              className="absolute bottom-1 left-1 w-2.5 h-2.5 rounded-full"
                              style={{ backgroundColor: 'var(--theme-secondary)' }}
                            />
                          )}
                          <div className="absolute bottom-0 inset-x-0 px-1.5 py-1 text-center" style={{ backgroundColor: 'rgba(0,0,0,0.65)' }}>
                            <div className="text-[10px] font-bold text-white truncate">{assignedProject ? assignedProject.title : 'Unassigned'}</div>
                          </div>
                        </div>
                        <input
                          type="date"
                          value={photo.date}
                          onChange={(e) => updatePhotoDate(photo.id, e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          style={{ backgroundColor: 'var(--theme-bg)', borderColor: 'var(--theme-border)', color: 'var(--theme-text)' }}
                          className="w-full mt-1 text-[10px] px-1.5 py-1 rounded border"
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Marquee rectangle -- fixed/viewport-positioned so it never has
            to reason about the grid's own scroll offset (see
            handleGridMouseDown's effect, which compares clientX/Y
            directly against each tile's getBoundingClientRect()). Outer
            div carries a fully-opaque border; the inner one is a
            separate element so its fill can be partially transparent
            without washing out the border too. */}
        {isDragSelecting && dragBox && (
          <div
            className="fixed pointer-events-none z-50 rounded-sm"
            style={{ left: dragBox.left, top: dragBox.top, width: dragBox.width, height: dragBox.height, border: '2px solid var(--theme-primary)' }}
          >
            <div className="w-full h-full" style={{ backgroundColor: 'var(--theme-primary)', opacity: 0.15 }} />
          </div>
        )}
      </div>
    );
  }

  // -----------------------------------------------------------------
  // STEP 3: uploading
  // -----------------------------------------------------------------
  if (step === 'uploading') {
    const pct = uploadProgress.total > 0 ? Math.round((uploadProgress.done / uploadProgress.total) * 100) : 0;
    return (
      <div className="flex flex-col items-center justify-center h-full w-full gap-4">
        <div className="text-sm font-semibold">Uploading {uploadProgress.done} of {uploadProgress.total}…</div>
        <div className="w-64 h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--theme-bg)' }}>
          <div className="h-full transition-all duration-300" style={{ width: `${pct}%`, backgroundColor: 'var(--theme-primary)' }} />
        </div>
        <div className="text-xs opacity-50">Don't close this tab -- each photo is a separate Notion request.</div>
      </div>
    );
  }

  // -----------------------------------------------------------------
  // STEP 4: done
  // -----------------------------------------------------------------
  const totalSucceeded = uploadResults.byProject.reduce((sum, p) => sum + p.count, 0);
  return (
    <div className="flex flex-col items-center justify-center h-full w-full gap-4 max-w-md mx-auto text-center">
      <div className="text-lg font-bold">
        {totalSucceeded} photo{totalSucceeded === 1 ? '' : 's'} added
      </div>
      {uploadResults.byProject.length > 0 && (
        <ul className="text-sm opacity-70 space-y-0.5">
          {uploadResults.byProject.map(({ title, count }) => (
            <li key={title}>{count} to {title}</li>
          ))}
        </ul>
      )}
      {uploadResults.failed.length > 0 && (
        <div className="text-sm text-left w-full p-3 rounded-lg border" style={{ borderColor: 'var(--theme-border)', backgroundColor: 'var(--theme-bg)' }}>
          <div className="font-bold mb-1 opacity-80">{uploadResults.failed.length} failed:</div>
          <ul className="space-y-0.5 opacity-70">
            {uploadResults.failed.map((f, i) => <li key={i} className="truncate">• {f.name}: {f.error}</li>)}
          </ul>
        </div>
      )}
      <div className="flex items-center gap-3 mt-2">
        <button onClick={resetToStart} style={{ borderColor: 'var(--theme-border)' }} className="px-4 py-2 text-sm font-semibold border rounded-lg cursor-pointer">
          Import More
        </button>
        <button onClick={onClose} style={{ backgroundColor: 'var(--theme-primary)' }} className="px-4 py-2 text-sm font-bold text-white rounded-lg cursor-pointer">
          Back to Calendar
        </button>
      </div>
    </div>
  );
}
