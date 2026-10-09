import { useState, useRef, useEffect } from 'react';
import exifr from 'exifr';
import { resizeImageForUpload } from './imageResize.js';
import { isNativePhotoPickerSupported, queryPhotosByDateRange, getPhotoThumbnail, getPhotoData } from './nativePhotoPicker.js';
import { canReadClipboardImages, imageFilesFromClipboardData, readClipboardImageFiles } from './clipboardImages.js';
import { edgeScrollSpeed, idsBetween, idsInBox, shiftRange } from './dragSelect.js';
import { freshSharedRecords, sharedPhotoFromRecord } from './sharedPhotos.js';
import { loadLoggedPhotos, saveLoggedPhotos, withLoggedPhoto, loggedInfo, countLogged } from './loggedPhotos.js';

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

// What the add form's `type` is while it is adding a brand-new type (with its
// first project) rather than a project to an existing type.
const NEW_TYPE = '\u0000new-type';

// The project a photo is for, if it has none, defaults to "General" (see
// getAllTreeProjects) -- which is a stand-in for "no type", never a type to write.
const FALLBACK_TYPE = 'General';

// A dashed "+ Add ..." button that opens an inline form.
function AddRow({ label, onActivate }) {
  return (
    <button
      onClick={onActivate}
      style={{ borderColor: 'var(--theme-border)' }}
      className="w-full text-left p-3 rounded-lg lf-frame border border-dashed cursor-pointer transition-colors hover:border-[var(--theme-primary)] text-sm font-semibold opacity-60 hover:opacity-100"
    >
      {label}
    </button>
  );
}

// The inline form for adding a project to a type -- or, with `withType`, a new
// type together with its first project (a type only exists in Notion as the
// type of some project). Enter submits, Escape cancels, as in
// LogTitleEditor's click-to-edit pattern elsewhere in this app.
function AddProjectForm({ withType, typeDraft, onTypeDraftChange, draft, onDraftChange, onCancel, onSubmit, submitting, error }) {
  const canSubmit = !submitting && draft.trim() && (!withType || typeDraft.trim());
  const onKeyDown = (e) => {
    if (e.key === 'Enter' && canSubmit) onSubmit();
    if (e.key === 'Escape') onCancel();
  };
  const inputProps = {
    type: 'text',
    onKeyDown,
    style: { borderColor: 'var(--theme-border)', color: 'var(--theme-text)', backgroundColor: 'var(--theme-card)' },
    className: 'w-full text-sm px-2 py-1.5 rounded border outline-none',
  };
  return (
    <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: 'var(--theme-bg)', borderColor: 'var(--theme-primary)' }} className="p-3 rounded-lg lf-frame border space-y-2">
      {withType && (
        <input {...inputProps} autoFocus value={typeDraft} onChange={(e) => onTypeDraftChange(e.target.value)} placeholder="New type name" aria-label="New type name" />
      )}
      <input {...inputProps} autoFocus={!withType} value={draft} onChange={(e) => onDraftChange(e.target.value)} placeholder={withType ? 'First project in it' : 'New project name'} aria-label={withType ? 'First project in the new type' : 'New project name'} />
      {error && <div className="text-[10px]" style={{ color: 'var(--theme-secondary)' }}>{error}</div>}
      <div className="flex items-center justify-end gap-1.5">
        <button onClick={onCancel} className="text-xs font-semibold px-2 py-1 rounded cursor-pointer opacity-60 hover:opacity-100 transition-opacity">
          Cancel
        </button>
        <button
          onClick={onSubmit}
          disabled={!canSubmit}
          style={{ backgroundColor: 'var(--theme-primary)' }}
          className="text-xs font-bold text-white px-2.5 py-1 rounded cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          {submitting ? 'Adding…' : withType ? 'Add type' : 'Add'}
        </button>
      </div>
    </div>
  );
}

// The grouped, tap-to-assign project list -- shared between mobile's step
// (below its horizontal photo strip) and desktop's (in its own left-hand
// column), since the interaction itself (click a project to arm it and assign
// photos one at a time, or batch-assign whatever's already selected) is
// identical either way, only the surrounding layout differs.
//
// Grouped like the app's own Categories sidebar -- database (source), then
// type, then project -- and styled to match it. The deliberate difference is
// the add rows the sidebar has no equivalent for: "+ Add Project" at the end
// of each type (a new topic in that type) and "+ Add Type" at the end of each
// database (a new type, with its first project). `addTarget` is which add form
// is open, { source, type } (type is NEW_TYPE for the add-a-type form) --
// only one at a time. projectColorMap mirrors the sidebar's own per-project
// color overrides; a project with no override falls back to the theme's
// primary color.
function ProjectAssignList({
  bySource, armedProjectKey, onProjectTap, countByProjectKey, projectColorMap,
  collapsedSources, onToggleSource,
  addTarget, newProjectDraft, newTypeDraft, onNewProjectDraftChange, onNewTypeDraftChange,
  onAddActivate, onAddCancel, onAddSubmit, creatingProject, createProjectError, createProjectNotice,
  isEmpty,
}) {
  const isOpen = (source, type) => addTarget?.source === source && addTarget?.type === type;
  return (
    <>
      {createProjectNotice && (
        <div role="status" className="text-xs p-2 rounded-lg border" style={{ borderColor: 'var(--theme-secondary)', color: 'var(--theme-secondary)' }}>
          {createProjectNotice}
        </div>
      )}
      {Object.entries(bySource).map(([source, projs]) => {
        const isCollapsed = collapsedSources.has(source);
        const sourceCount = projs.reduce((sum, p) => sum + (countByProjectKey[projectKeyOf(p)] || 0), 0);
        // This database's types, in order, each with its projects.
        const byType = new Map();
        projs.forEach((p) => {
          const type = p.projectType || FALLBACK_TYPE;
          if (!byType.has(type)) byType.set(type, []);
          byType.get(type).push(p);
        });
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
              <div className="space-y-3">
                {Array.from(byType, ([type, typeProjects]) => (
                  <div key={type} className="space-y-1.5">
                    <div className="px-0.5 text-[10px] font-bold uppercase tracking-wider opacity-60">{type}</div>
                    {typeProjects.map((p) => {
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
                          className={`p-2.5 rounded lf-frame border transition-all cursor-pointer flex items-center gap-2 ${isArmed ? 'font-bold' : ''}`}
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
                    {isOpen(source, type) ? (
                      <AddProjectForm
                        draft={newProjectDraft}
                        onDraftChange={onNewProjectDraftChange}
                        onCancel={onAddCancel}
                        onSubmit={() => onAddSubmit(source, type)}
                        submitting={creatingProject}
                        error={createProjectError}
                      />
                    ) : (
                      <AddRow label="+ Add Project" onActivate={() => onAddActivate(source, type)} />
                    )}
                  </div>
                ))}
                {isOpen(source, NEW_TYPE) ? (
                  <AddProjectForm
                    withType
                    typeDraft={newTypeDraft}
                    onTypeDraftChange={onNewTypeDraftChange}
                    draft={newProjectDraft}
                    onDraftChange={onNewProjectDraftChange}
                    onCancel={onAddCancel}
                    onSubmit={() => onAddSubmit(source, NEW_TYPE)}
                    submitting={creatingProject}
                    error={createProjectError}
                  />
                ) : (
                  <AddRow label="+ Add Type" onActivate={() => onAddActivate(source, NEW_TYPE)} />
                )}
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

const COARSE_POINTER_QUERY = '(pointer: coarse)';
const wantsTouchReviewLayout = () =>
  window.innerWidth < MOBILE_BREAKPOINT || Boolean(window.matchMedia?.(COARSE_POINTER_QUERY).matches);

function useTouchReviewLayout() {
  const [touch, setTouch] = useState(wantsTouchReviewLayout);
  useEffect(() => {
    const update = () => setTouch(wantsTouchReviewLayout());
    window.addEventListener('resize', update);
    const query = window.matchMedia?.(COARSE_POINTER_QUERY);
    query?.addEventListener?.('change', update);
    return () => {
      window.removeEventListener('resize', update);
      query?.removeEventListener?.('change', update);
    };
  }, []);
  return touch;
}

export default function ImportPhotosPanel({ allProjects, tenantId, onClose, onUploaded, sharedPhotos, onConsumedSharedPhotos, sharedNativePhotos, onConsumedSharedNativePhotos, fixedDateRange, projectColorMap, knownEntryIds, onStepChange }) {
  // The phone's review layout (a strip of the current date block's photos over
  // the project list) is used on a narrow window AND on a touch-first device
  // such as a tablet, whatever its width -- an iPad opens the web version, but
  // is held and tapped like a phone.
  const isMobile = useTouchReviewLayout();

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
  // Reports which step is active up to App.jsx -- swiping to change the
  // fixed date range (see shiftImportDateRange there) should only work on
  // native-pick, where a horizontal swipe has nothing else to mean. Once
  // photos are staged and the mobile review step's own horizontal photo
  // strip is on screen, the same swipe needs to scroll THAT instead of
  // being hijacked into changing the date block out from under it.
  useEffect(() => {
    onStepChange?.(step);
  }, [step, onStepChange]);
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 });
  const [uploadResults, setUploadResults] = useState({ byProject: [], filed: [], datingProblems: [], failed: [] });
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

  // Projects created THIS session via "+ Add Project" / "+ Add Type" (see AddProjectForm)
  // -- allProjects only ever lists projects that already have at least
  // one synced log entry, so a brand-new one has nowhere else to live
  // until the user eventually logs something under it and re-syncs.
  // Merged into every {source: [...]} grouping and into startUpload's
  // own project lookup right alongside allProjects.
  const [newlyCreatedProjects, setNewlyCreatedProjects] = useState([]);
  const effectiveProjects = [...allProjects, ...newlyCreatedProjects];
  // Which inline add form is open -- "+ Add Project" under a type, or "+ Add
  // Type" under a database -- as { source, type } (type is NEW_TYPE for the
  // latter). Only one at a time, mirroring armedProjectKey's single-active-
  // mode pattern above.
  const [addTarget, setAddTarget] = useState(null);
  const [newProjectDraft, setNewProjectDraft] = useState('');
  const [newTypeDraft, setNewTypeDraft] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);
  const [createProjectError, setCreateProjectError] = useState(null);
  // A project was added but something it asked for couldn't be done (its
  // type, in Notion): shown until the next add is started.
  const [createProjectNotice, setCreateProjectNotice] = useState('');

  const cancelAddProject = () => {
    setAddTarget(null);
    setNewProjectDraft('');
    setNewTypeDraft('');
    setCreateProjectError(null);
  };
  const startAddProject = (source, type) => {
    setAddTarget({ source, type });
    setNewProjectDraft('');
    setNewTypeDraft('');
    setCreateProjectError(null);
    setCreateProjectNotice('');
  };

  // referenceLogId is only ever used structurally (which property is the
  // relation, which database it points to) -- ANY existing project in
  // the same source works, including one added earlier this same session,
  // so a database with zero synced projects is the only case with truly
  // nothing to bootstrap a new one from.
  //
  // `type` is the existing type the project goes under, or NEW_TYPE when the
  // form is adding a type (named in newTypeDraft) along with its first
  // project. The server writes the type where this database keeps it -- on
  // the new project's page, or (for a select-style database) later on each
  // entry, see backlog-photo.js -- so a project/type made here exists in
  // Notion once something is uploaded to it (or, for a page-backed project,
  // straight away).
  const submitAddProject = async (source, type) => {
    const isNewType = type === NEW_TYPE;
    const title = newProjectDraft.trim();
    if (!title || (isNewType && !newTypeDraft.trim())) return;
    const reference = effectiveProjects.find((p) => p.source === source);
    if (!reference) {
      setCreateProjectError('Need at least one existing project in this database first.');
      return;
    }
    // A name already in use in this database would collide with it (projects
    // are keyed by database + name).
    if (effectiveProjects.some((p) => p.source === source && p.title.toLowerCase() === title.toLowerCase())) {
      setCreateProjectError('A project with that name already exists in this database.');
      return;
    }
    // A typed type that matches an existing one (ignoring case) is that type.
    const existingTypes = effectiveProjects.filter((p) => p.source === source).map((p) => p.projectType || FALLBACK_TYPE);
    const typedType = newTypeDraft.trim();
    const typeName = isNewType
      ? existingTypes.find((t) => t.toLowerCase() === typedType.toLowerCase()) || typedType
      : type;
    setCreatingProject(true);
    setCreateProjectError(null);
    try {
      const response = await fetch('/api/backlog-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          action: 'createProject',
          referenceLogId: reference.referenceLogId,
          newProjectTitle: title,
          sourceLabel: source,
          // The "General" group is where projects with no type land: there is
          // no type to set on one added to it.
          ...(typeName !== FALLBACK_TYPE ? { projectType: typeName } : {}),
        }),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Could not create project');
      setNewlyCreatedProjects((prev) => [...prev, {
        title,
        source,
        projectType: typeName,
        referenceLogId: reference.referenceLogId,
        // A page-backed project has a page to link entries to; a select-style
        // one (virtual) is just a name that gets written on each entry.
        projectPageId: result.projectPageId,
      }]);
      if (result.warning) setCreateProjectNotice(result.warning);
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
  // Which of the phone's photos were already logged from here (see loggedPhotos.js):
  // the picker marks them, and can hide them.
  const [loggedPhotos, setLoggedPhotos] = useState(() => loadLoggedPhotos(localStorage, tenantId));
  const [hideLogged, setHideLogged] = useState(false);

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

  // A date block's photos arrive in two steps, so the grid is there straight away:
  // MediaStore says WHICH photos fall in the range (one quick query), and the
  // thumbnails then come in a few at a time, filling in the tiles as they do. They
  // used to be waited for all together, so a week of sixty photos showed
  // "Scanning your photos…" until the sixtieth had been decoded.
  const fetchRangePhotos = async (range) => {
    const results = await queryPhotosByDateRange(range.start, range.end);
    return results.map((p) => ({ ...p, thumbnail: null }));
  };

  const THUMBNAIL_WORKERS = 4;
  // Which block is on screen, so a loader whose block has been swiped away stops.
  const activeScanKeyRef = useRef('');
  const thumbRenderTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(thumbRenderTimerRef.current), []);
  // Redraws the grid once for a burst of arriving thumbnails, not once each.
  const scheduleThumbRender = () => {
    if (thumbRenderTimerRef.current) return;
    thumbRenderTimerRef.current = setTimeout(() => {
      thumbRenderTimerRef.current = null;
      setNativePickPhotos((prev) => [...prev]);
    }, 60);
  };

  // Loads the thumbnails `photos` (the block `key`) still lack, a few at a time,
  // onto the photo objects themselves -- they are what the per-block cache holds, so
  // coming back to a block finds what was loaded. Stops once `ownerKey` (the block
  // being looked at; a neighbour being warmed up belongs to the one beside it) is
  // no longer the one on screen.
  const loadThumbnails = async (photos, key, ownerKey = key) => {
    const queue = photos.filter((p) => !p.thumbnail && !p.thumbnailFailed && !p.thumbnailLoading);
    let next = 0;
    const worker = async () => {
      while (next < queue.length && activeScanKeyRef.current === ownerKey) {
        const p = queue[next++];
        p.thumbnailLoading = true;
        try {
          p.thumbnail = await getPhotoThumbnail(p.uri);
        } catch {
          p.thumbnailFailed = true; // keeps the "?" tile
        }
        p.thumbnailLoading = false;
        if (activeScanKeyRef.current === key) scheduleThumbRender();
      }
    };
    await Promise.all(Array.from({ length: THUMBNAIL_WORKERS }, worker));
  };

  // Shows fixedDateRange's photos in the visible grid (from the cache if the block
  // has been seen), loads their thumbnails, then quietly warms up the blocks on
  // either side, so by the time a swipe lands on one its photos are normally
  // already there -- the same instant feel as Mandalart's own date-block swiping.
  const runNativeScan = async () => {
    const requestId = ++scanRequestIdRef.current;
    const range = fixedDateRange;
    const key = rangeKey(range);
    activeScanKeyRef.current = key;
    const cached = nativeScanCacheRef.current.get(key);

    setNativePickSelected(new Set());
    setNativePickError(null);

    let rangePhotos = cached;
    if (cached) {
      setNativePickPhotos(cached);
      setNativePickLoading(false);
    } else {
      setNativePickLoading(true);
      try {
        rangePhotos = await fetchRangePhotos(range);
        nativeScanCacheRef.current.set(key, rangePhotos);
        if (scanRequestIdRef.current === requestId) setNativePickPhotos(rangePhotos);
      } catch (err) {
        if (scanRequestIdRef.current === requestId) {
          setNativePickError(err.message || 'Could not load photos from your device.');
        }
      } finally {
        if (scanRequestIdRef.current === requestId) setNativePickLoading(false);
      }
    }
    if (!rangePhotos || scanRequestIdRef.current !== requestId) return;

    // What is on screen first...
    await loadThumbnails(rangePhotos, key);

    // ...then the neighbours. Errors here just mean that neighbour loads in the
    // normal (visible) way if the user actually swipes there.
    for (const direction of [1, -1]) {
      if (scanRequestIdRef.current !== requestId) return;
      const neighbor = adjacentRange(range, direction);
      const neighborKey = rangeKey(neighbor);
      try {
        let neighborPhotos = nativeScanCacheRef.current.get(neighborKey);
        if (!neighborPhotos) {
          neighborPhotos = await fetchRangePhotos(neighbor);
          nativeScanCacheRef.current.set(neighborKey, neighborPhotos);
        }
        await loadThumbnails(neighborPhotos, neighborKey, key);
      } catch {
        // see above
      }
    }
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

  const confirmingNativePickRef = useRef(false);
  const confirmNativePick = async () => {
    if (confirmingNativePickRef.current) return;
    confirmingNativePickRef.current = true;
    const chosen = nativePickPhotos.filter((p) => nativePickSelected.has(p.uri));
    // The next step shows each photo's thumbnail: any still on its way is fetched now.
    await Promise.all(chosen.filter((p) => !p.thumbnail).map(async (p) => {
      try { p.thumbnail = await getPhotoThumbnail(p.uri); } catch { /* the review step copes without one */ }
    }));
    confirmingNativePickRef.current = false;
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

  // `pasted` marks an image that came off the clipboard (a screenshot, a
  // copied picture): it has no capture date of its own, but it is from now.
  const photoFromFile = async (file, exifOverrideDate, { pasted = false } = {}) => {
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
        // for Week view. A pasted image is dated today instead when today is
        // inside that window.
        const today = toDateInputValue(new Date());
        dateStr = pasted && today >= fixedDateRange.start && today <= fixedDateRange.end ? today : fixedDateRange.start;
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

  const handleFiles = async (fileList, options) => {
    const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
    const results = await Promise.all(files.map((file) => photoFromFile(file, undefined, options)));
    const newPhotos = results.filter(Boolean);
    if (fixedDateRange) setSkippedOutOfRangeCount((prev) => prev + (results.length - newPhotos.length));
    setPhotos((prev) => [...prev, ...newPhotos]);
  };

  // Pasting a copied image (Ctrl/Cmd+V) adds it as a photo, like picking a
  // file does -- while photos can be added (the review step), wherever
  // focus is. A paste of text is left alone, so typing a new project's
  // name still pastes normally. handleFilesRef always points at the
  // current render's handleFiles, so the listener never uses a stale date range.
  const handleFilesRef = useRef(handleFiles);
  handleFilesRef.current = handleFiles;
  useEffect(() => {
    if (step !== 'review') return undefined;
    const onPaste = (e) => {
      const files = imageFilesFromClipboardData(e.clipboardData);
      if (!files.length) return;
      e.preventDefault();
      setPasteHint('');
      handleFilesRef.current(files, { pasted: true });
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [step]);

  // The Paste button: the same, from the async Clipboard API (not every
  // browser has it, and it needs permission), with a hint when it can't.
  const [pasteHint, setPasteHint] = useState('');
  const pasteFromClipboard = async () => {
    setPasteHint('');
    try {
      const files = await readClipboardImageFiles();
      if (files.length === 0) { setPasteHint('There’s no image on the clipboard — copy one first.'); return; }
      await handleFiles(files, { pasted: true });
    } catch {
      setPasteHint('Couldn’t read the clipboard here — press Ctrl/⌘+V to paste instead.');
    }
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

  // Photos shared to the Android app from the phone's gallery (Share > Creator
  // Timeline, see SharedPhotosPlugin.java): added to the review list with the
  // date each was taken -- read natively from the photo itself -- ready to be
  // given a project, along with anything already in the list. They are handed
  // over once; one that arrives while an upload runs waits for it to finish.
  useEffect(() => {
    if (!sharedNativePhotos || sharedNativePhotos.length === 0) return;
    if (step === 'uploading') return;
    const incoming = sharedNativePhotos;
    onConsumedSharedNativePhotos?.();
    const startingOver = step === 'done';
    if (startingOver) resetToStart();
    else if (step !== 'review') setStep('review');
    const staged = startingOver ? [] : photos;
    const added = freshSharedRecords(incoming, staged.map((p) => p.nativeUri).filter(Boolean))
      .map((record) => sharedPhotoFromRecord(record, toDateInputValue));
    if (added.length === 0) return;
    setPhotos((prev) => [...(startingOver ? [] : prev), ...added]);

    // Pictures are read a few at a time -- a big batch is not asked for all at once.
    const queue = [...added];
    const worker = async () => {
      while (queue.length > 0) {
        const next = queue.shift();
        try {
          const thumbnail = await getPhotoThumbnail(next.nativeUri);
          setPhotos((prev) => prev.map((p) => (p.id === next.id ? { ...p, previewUrl: thumbnail } : p)));
        } catch {
          // The blank tile stays; the photo can still be given a project and uploaded.
        }
      }
    };
    Promise.all([worker(), worker(), worker(), worker()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, sharedNativePhotos]);

  const updatePhotoDate = (id, newDate) => {
    setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, date: newDate, hasExif: false } : p)));
  };

  const updatePhotoProject = (id, newProjectKey) => {
    setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, projectKey: newProjectKey } : p)));
  };

  // Mobile tap-to-assign -- see the state comment above for the model.
  const handlePhotoTap = (id) => {
    if (Date.now() < suppressTapUntilRef.current) return; // the lift that ended a drag
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

  // Selecting several photos at once -- on a computer: shift+click one to take
  // everything from the last photo clicked to it, or press on the grid (on a
  // photo or between them) and drag to draw a box around the ones to take;
  // with a finger: touch and hold a photo, then drag across the others (see the
  // touch effect below). With a project armed, the box and the finger assign
  // it to everything they cross instead of selecting. Ctrl/Cmd/Shift held as a
  // drag begins adds to the selection rather than starting it afresh.
  const lastClickedPhotoIndexRef = useRef(null);
  // The click that ends a drag (mouse up over the photo it began on) is not a
  // click on that photo.
  const suppressTileClickRef = useRef(false);
  const handleDesktopPhotoClick = (photo, index, e) => {
    if (suppressTileClickRef.current) return;
    if (e.shiftKey) {
      const rangeIds = shiftRange(photos.map((p) => p.id), lastClickedPhotoIndexRef.current, index);
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

  // The drawn box -- viewport (clientX/Y) coordinates throughout, compared
  // directly against each tile's own getBoundingClientRect().
  const [isDragSelecting, setIsDragSelecting] = useState(false);
  const [dragBox, setDragBox] = useState(null);
  const photoTileRefs = useRef({});
  const gridScrollRef = useRef(null);
  // The armed project as the drag sees it now (the listeners outlive a render).
  const armedKeyRef = useRef(null);
  armedKeyRef.current = armedProjectKey;
  const endMouseDragRef = useRef(null);
  const DRAG_START_PX = 5;

  const handleGridMouseDown = (e) => {
    if (e.button !== 0) return; // left click/drag only
    // A photo's ×, a date field: they have their own clicks.
    if (e.target.closest('button, input, select, textarea, a')) return;
    const onTile = Boolean(e.target.closest('[data-photo-tile]'));
    // Shift+click on a photo is the range select (its click handler).
    if (onTile && e.shiftKey) return;

    const scroller = gridScrollRef.current;
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const base = additive ? new Set(selectedPhotoIds) : new Set();
    const origin = { x: e.clientX, y: e.clientY };
    // Where the box began, in the grid's own scrolled coordinates, so it stays
    // on the same photos when the grid scrolls (by the wheel, or by the drag
    // pushing against its top or bottom edge) -- not on the same pixels.
    const startX = origin.x + (scroller?.scrollLeft || 0);
    const startY = origin.y + (scroller?.scrollTop || 0);
    let pointer = origin;
    let dragging = false;
    let scrollTimer = null;

    const apply = () => {
      const sx = startX - (scroller?.scrollLeft || 0);
      const sy = startY - (scroller?.scrollTop || 0);
      const box = { left: Math.min(sx, pointer.x), top: Math.min(sy, pointer.y), right: Math.max(sx, pointer.x), bottom: Math.max(sy, pointer.y) };
      setDragBox({ left: box.left, top: box.top, width: box.right - box.left, height: box.bottom - box.top });
      const tiles = Object.entries(photoTileRefs.current).map(([id, el]) => [id, el.getBoundingClientRect()]);
      const inside = idsInBox(tiles, box);
      const armedKey = armedKeyRef.current;
      if (armedKey) {
        // Paint-assign: whatever the box has crossed takes the project.
        setPhotos((prev) => {
          let changed = false;
          const next = prev.map((p) => {
            if (!inside.includes(p.id) || p.projectKey === armedKey) return p;
            changed = true;
            return { ...p, projectKey: armedKey };
          });
          return changed ? next : prev;
        });
      } else {
        setSelectedPhotoIds(new Set([...base, ...inside]));
      }
    };

    const onMove = (ev) => {
      pointer = { x: ev.clientX, y: ev.clientY };
      if (!dragging) {
        if (Math.hypot(pointer.x - origin.x, pointer.y - origin.y) < DRAG_START_PX) return;
        dragging = true;
        setIsDragSelecting(true);
        // Held against the top or bottom edge, the grid keeps scrolling.
        scrollTimer = setInterval(() => {
          if (!scroller) return;
          const r = scroller.getBoundingClientRect();
          const speed = edgeScrollSpeed(pointer.y, r.top, r.bottom);
          if (speed) { scroller.scrollTop += speed; apply(); }
        }, 16);
      }
      apply();
    };

    const finish = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      clearInterval(scrollTimer);
      endMouseDragRef.current = null;
      if (dragging) {
        setIsDragSelecting(false);
        setDragBox(null);
        suppressTileClickRef.current = true;
        setTimeout(() => { suppressTileClickRef.current = false; }, 0);
      }
    };
    function onUp() {
      finish();
      // A plain click on the space around the photos clears the selection.
      if (!dragging && !onTile && !additive) setSelectedPhotoIds(new Set());
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    endMouseDragRef.current = finish;
  };
  // Leaving mid-drag must not leave its listeners behind.
  useEffect(() => () => endMouseDragRef.current?.(), []);

  // Touch: the strip of photos scrolls sideways under a finger, so a drag has
  // to be asked for -- touch and hold a photo (it buzzes), then drag across
  // the others without lifting. Everything from the photo first touched to the
  // one under the finger is selected (or, with a project armed, assigned to
  // it); the strip scrolls itself when the finger reaches its ends. A finger
  // that moves before the hold is up is just scrolling, as it always was.
  // Uses native listeners: a React touchmove is passive, and cannot stop the
  // strip scrolling under the drag.
  const stripRef = useRef(null);
  const touchPickRef = useRef({ visibleIds: [], armedProjectKey: null, selected: new Set() });
  const suppressTapUntilRef = useRef(0);
  useEffect(() => {
    if (step !== 'review' || !isMobile) return undefined;
    const strip = stripRef.current;
    if (!strip) return undefined;

    const HOLD_MS = 260;
    const SLOP_PX = 10;
    let holdTimer = null;
    let raf = 0;
    let dragging = false;
    let anchorId = null;
    let base = new Set();
    let covered = new Set();
    let start = { x: 0, y: 0 };
    let pointer = { x: 0, y: 0 };

    const idAt = (x, y) => document.elementFromPoint(x, y)?.closest('[data-strip-photo]')?.getAttribute('data-strip-photo') || null;

    const reach = (id) => {
      const { visibleIds, armedProjectKey: armedKey } = touchPickRef.current;
      const range = idsBetween(visibleIds, visibleIds.indexOf(anchorId), visibleIds.indexOf(id));
      if (range.length === 0) return;
      if (armedKey) {
        range.forEach((rangeId) => covered.add(rangeId));
        setPhotos((prev) => {
          let changed = false;
          const next = prev.map((p) => {
            if (!covered.has(p.id) || p.projectKey === armedKey) return p;
            changed = true;
            return { ...p, projectKey: armedKey };
          });
          return changed ? next : prev;
        });
      } else {
        setSelectedPhotoIds(new Set([...base, ...range]));
      }
    };

    const tick = () => {
      if (!dragging) return;
      const r = strip.getBoundingClientRect();
      const speed = edgeScrollSpeed(pointer.x, r.left, r.right);
      if (speed) {
        strip.scrollLeft += speed;
        const id = idAt(pointer.x, pointer.y);
        if (id) reach(id);
      }
      raf = requestAnimationFrame(tick);
    };

    const begin = () => {
      holdTimer = null;
      dragging = true;
      base = new Set(touchPickRef.current.selected);
      covered = new Set();
      navigator.vibrate?.(12);
      reach(anchorId);
      raf = requestAnimationFrame(tick);
    };

    const onStart = (e) => {
      if (e.touches.length !== 1) return;
      // A photo's × and its date field stay taps.
      if (e.target.closest('button, input')) return;
      const id = e.target.closest('[data-strip-photo]')?.getAttribute('data-strip-photo');
      if (!id) return;
      anchorId = id;
      start = pointer = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      clearTimeout(holdTimer);
      holdTimer = setTimeout(begin, HOLD_MS);
    };

    const onMove = (e) => {
      const touch = e.touches[0];
      if (!touch) return;
      pointer = { x: touch.clientX, y: touch.clientY };
      if (!dragging) {
        if (holdTimer && Math.hypot(pointer.x - start.x, pointer.y - start.y) > SLOP_PX) {
          clearTimeout(holdTimer);
          holdTimer = null;
        }
        return;
      }
      e.preventDefault(); // the finger is selecting now, not scrolling
      const id = idAt(pointer.x, pointer.y);
      if (id) reach(id);
    };

    const onEnd = (e) => {
      clearTimeout(holdTimer);
      holdTimer = null;
      cancelAnimationFrame(raf);
      if (!dragging) return;
      dragging = false;
      // The lift would otherwise count as a tap on the last photo.
      if (e.cancelable) e.preventDefault();
      suppressTapUntilRef.current = Date.now() + 400;
    };

    strip.addEventListener('touchstart', onStart, { passive: true });
    strip.addEventListener('touchmove', onMove, { passive: false });
    strip.addEventListener('touchend', onEnd);
    strip.addEventListener('touchcancel', onEnd);
    return () => {
      clearTimeout(holdTimer);
      cancelAnimationFrame(raf);
      strip.removeEventListener('touchstart', onStart);
      strip.removeEventListener('touchmove', onMove);
      strip.removeEventListener('touchend', onEnd);
      strip.removeEventListener('touchcancel', onEnd);
    };
  }, [step, isMobile]);

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
    // What went where, so the result can say which date each project's photos
    // were filed under, and anything that kept an entry from getting its date.
    const filed = new Map(); // project + date -> { title, date, count }
    const datingProblems = [];
    let doneCount = 0;
    // The phone's photos uploaded in this go are added to the record of what has been logged.
    let loggedNow = loggedPhotos;

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
                // A select-style database keeps its topic and type on the entry
                // itself, so they are sent for the server to write (it ignores
                // them for a database that links its project by relation).
                sourceLabel: groupProject.source,
                topicName: groupProject.title,
                ...(groupProject.projectType && groupProject.projectType !== FALLBACK_TYPE ? { typeName: groupProject.projectType } : {}),
              };

          const response = await fetch('/api/backlog-photo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const result = await response.json();
          if (!result.success) throw new Error(result.error || 'Upload failed');
          if (!pageId) {
            pageId = result.pageId;
            // The entry is made on its first photo: what the server says it did
            // about the date is what is reported for the whole group.
            if (result.dated === false) datingProblems.push({ title: groupProject.title, date, kind: 'no-date-property' });
            else if (result.storedDate && result.storedDate.slice(0, 10) !== date) datingProblems.push({ title: groupProject.title, date, kind: 'other-date', stored: result.storedDate.slice(0, 10) });
          }
          succeededByProject.set(groupProject.title, (succeededByProject.get(groupProject.title) || 0) + 1);
          const filedKey = `${groupProject.title}\u0000${date}`;
          filed.set(filedKey, { title: groupProject.title, date, count: (filed.get(filedKey)?.count || 0) + 1 });
          if (photo.nativeUri) loggedNow = withLoggedPhoto(loggedNow, photo.nativeUri, { pageId, title: groupProject.title, date });
        } catch (err) {
          failed.push({ name: photo.file?.name || photo.displayName || 'photo', error: err.message });
        }
        doneCount++;
        setUploadProgress({ done: doneCount, total: photos.length });
      }
    }

    if (loggedNow !== loggedPhotos) {
      saveLoggedPhotos(localStorage, tenantId, loggedNow);
      setLoggedPhotos(loggedNow);
    }

    setUploadResults({
      byProject: Array.from(succeededByProject, ([title, count]) => ({ title, count })),
      filed: Array.from(filed.values()).sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title)),
      datingProblems,
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
    setUploadResults({ byProject: [], filed: [], datingProblems: [], failed: [] });
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
    // Photos already logged from here are marked, and can be hidden.
    const loggedCount = countLogged(loggedPhotos, nativePickPhotos, knownEntryIds);
    const shownPhotos = hideLogged ? nativePickPhotos.filter((p) => !loggedInfo(loggedPhotos, p.uri, knownEntryIds)) : nativePickPhotos;
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

        {!nativePickLoading && !nativePickError && nativePickPhotos.length > 0 && (
          <div className="flex items-center justify-between gap-2 mb-2 shrink-0 text-xs">
            <span className="opacity-70">
              {nativePickPhotos.length} photo{nativePickPhotos.length === 1 ? '' : 's'}
              {loggedCount > 0 ? ` · ${loggedCount} already logged` : ''}
            </span>
            {loggedCount > 0 && (
              <button
                onClick={() => setHideLogged((v) => !v)}
                className="font-bold cursor-pointer hover:opacity-70"
                style={{ color: 'var(--theme-primary)' }}
              >
                {hideLogged ? 'Show logged' : 'Hide logged'}
              </button>
            )}
          </div>
        )}

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
          ) : shownPhotos.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm italic opacity-50 text-center px-4">
              Every photo for {dateRangeLabel} is already logged.
            </div>
          ) : (
            <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))' }}>
              {shownPhotos.map((p) => {
                const isSelected = nativePickSelected.has(p.uri);
                const logged = loggedInfo(loggedPhotos, p.uri, knownEntryIds);
                return (
                  <div
                    key={p.uri}
                    onClick={() => toggleNativePick(p.uri)}
                    className="relative rounded-lg lf-frame overflow-hidden cursor-pointer"
                    style={{
                      aspectRatio: '1',
                      backgroundColor: 'var(--theme-card)',
                      border: isSelected ? '3px solid var(--theme-secondary)' : '1px solid var(--theme-border)',
                    }}
                  >
                    {p.thumbnail ? (
                      <img src={p.thumbnail} alt="" className="w-full h-full object-cover" style={logged ? { opacity: 0.5 } : undefined} />
                    ) : (
                      <div className={`w-full h-full flex items-center justify-center text-xs opacity-40 ${p.thumbnailFailed ? '' : 'animate-pulse'}`}>{p.thumbnailFailed ? '?' : ''}</div>
                    )}
                    {logged && (
                      <div
                        className="absolute bottom-1 left-1 right-1 flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold text-white pointer-events-none"
                        style={{ backgroundColor: 'rgba(0, 0, 0, 0.68)' }}
                        title={`Already logged${logged.title ? ` to ${logged.title}` : ''}${logged.date ? ` on ${logged.date}` : ''}`}
                      >
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: projectColorMap?.[logged.title] || 'var(--theme-primary)' }} />
                        <span className="truncate">✓ {logged.title || 'Logged'}</span>
                      </div>
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
    // What the hold-and-drag listeners (see the touch effect) read at each touch.
    touchPickRef.current = { visibleIds: visiblePhotos.map((p) => p.id), armedProjectKey, selected: selectedPhotoIds };

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
          <div className="flex items-center gap-2 shrink-0">
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
            {canReadClipboardImages() && (
              <button
                onClick={pasteFromClipboard}
                title="Add the image you have copied (or press Ctrl/⌘+V)"
                style={{ backgroundColor: 'var(--theme-bg)', borderColor: 'var(--theme-border)' }}
                className="text-xs font-semibold px-3 py-2 rounded-lg border cursor-pointer shrink-0"
              >
                Paste
              </button>
            )}
          </div>
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

        {pasteHint && (
          <div role="status" className="shrink-0 mb-2 text-xs" style={{ color: 'var(--theme-secondary)' }}>{pasteHint}</div>
        )}

        {skippedOutOfRangeCount > 0 && (
          <div className="shrink-0 mb-2 text-xs italic opacity-60">
            Skipped {skippedOutOfRangeCount} photo{skippedOutOfRangeCount === 1 ? '' : 's'} taken outside this date range.
          </div>
        )}

        {/* Horizontal photo strip */}
        <div ref={stripRef} onContextMenu={(e) => e.preventDefault()} className="shrink-0 mb-2 -mx-1 px-1 overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch', WebkitTouchCallout: 'none', userSelect: 'none' }}>
          {visiblePhotos.length === 0 ? (
            <div className="text-xs italic opacity-50 py-8 text-center">
              {photos.length > 0
                ? 'No photos staged for this date yet — move to another date, or tap "+ Add Photos" above.'
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
                      data-strip-photo={photo.id}
                      onClick={() => handlePhotoTap(photo.id)}
                      className="relative rounded-lg lf-frame overflow-hidden cursor-pointer"
                      style={{
                        width: '92px',
                        height: '92px',
                        backgroundColor: 'var(--theme-card)',
                        border: isSelected ? '3px solid var(--theme-secondary)' : '1px solid var(--theme-border)',
                      }}
                    >
                      <img src={photo.previewUrl} alt="" draggable={false} className="w-full h-full object-cover" />
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
            ? `Assigning to "${effectiveProjects.find((p) => projectKeyOf(p) === armedProjectKey)?.title}" — tap photos, or hold one and drag across several. Tap the project again to stop.`
            : selectedPhotoIds.size > 0
              ? `${selectedPhotoIds.size} photo${selectedPhotoIds.size === 1 ? '' : 's'} selected — tap a project below to assign.`
              : 'Tap photos to select them, or hold one and drag across several. Or tap a project to start assigning.'}
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
            addTarget={addTarget}
            newProjectDraft={newProjectDraft}
            newTypeDraft={newTypeDraft}
            onNewProjectDraftChange={setNewProjectDraft}
            onNewTypeDraftChange={setNewTypeDraft}
            onAddActivate={startAddProject}
            onAddCancel={cancelAddProject}
            onAddSubmit={submitAddProject}
            creatingProject={creatingProject}
            createProjectError={createProjectError}
            createProjectNotice={createProjectNotice}
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
                ? `Assigning to "${effectiveProjects.find((p) => projectKeyOf(p) === armedProjectKey)?.title}" — click photos, or drag across several. Click the project again to stop.`
                : selectedPhotoIds.size > 0
                  ? `${selectedPhotoIds.size} photo${selectedPhotoIds.size === 1 ? '' : 's'} selected — click a project to assign.`
                  : 'Click photos to select them — drag across several, or shift+click a range — or click a project to start assigning.'}
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
                addTarget={addTarget}
                newProjectDraft={newProjectDraft}
                newTypeDraft={newTypeDraft}
                onNewProjectDraftChange={setNewProjectDraft}
                onNewTypeDraftChange={setNewTypeDraft}
                onAddActivate={startAddProject}
                onAddCancel={cancelAddProject}
                onAddSubmit={submitAddProject}
                creatingProject={creatingProject}
                createProjectError={createProjectError}
                createProjectNotice={createProjectNotice}
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
              className="shrink-0 mb-3 border-2 border-dashed rounded-lg lf-frame p-4 text-center cursor-pointer transition-colors"
            >
              <div className="text-sm font-semibold opacity-70">+ Add Photos</div>
              <div className="text-xs opacity-50 mt-1">Click to browse, drag and drop, or paste an image (Ctrl/⌘+V) -- dates are read from each photo automatically</div>
              {canReadClipboardImages() && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); pasteFromClipboard(); }}
                  title="Add the image you have copied (or press Ctrl/⌘+V)"
                  style={{ backgroundColor: 'var(--theme-bg)', borderColor: 'var(--theme-border)' }}
                  className="mt-2 text-xs font-semibold px-3 py-1.5 rounded-lg border cursor-pointer"
                >
                  Paste image
                </button>
              )}
              {pasteHint && <div role="status" className="text-xs mt-2" style={{ color: 'var(--theme-secondary)' }}>{pasteHint}</div>}
            </div>

            <div ref={gridScrollRef} onMouseDown={handleGridMouseDown} className="flex-1 overflow-y-auto min-h-0 pr-1">
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
                          className="relative rounded-lg lf-frame overflow-hidden cursor-pointer aspect-square"
                          style={{
                            backgroundColor: 'var(--theme-card)',
                            border: isSelected ? '3px solid var(--theme-secondary)' : '1px solid var(--theme-border)',
                          }}
                        >
                          <img src={photo.previewUrl} alt="" draggable={false} className="w-full h-full object-cover" />
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
      {uploadResults.filed.length > 0 && (
        // One line per project and date: the date is the one each photo was
        // filed under, so a wrong one is visible at a glance.
        <ul className="text-sm opacity-70 space-y-0.5">
          {uploadResults.filed.map(({ title, date, count }) => {
            const [y, m, d] = date.split('-').map(Number);
            const label = new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            return <li key={`${title}-${date}`}>{count} to {title} · {label}</li>;
          })}
        </ul>
      )}
      {uploadResults.datingProblems.length > 0 && (
        <div role="alert" className="text-sm text-left w-full p-3 rounded-lg lf-frame border" style={{ borderColor: '#e11d48', backgroundColor: 'var(--theme-bg)' }}>
          <div className="font-bold mb-1">Not filed under the photo’s date</div>
          <p className="opacity-80">
            {uploadResults.datingProblems.some((p) => p.kind === 'no-date-property')
              ? 'Notion has no date property on this database to put the photo’s date in, so the calendar dates those entries by when they were made — today. Add a Date property to the database in Notion and the date will be set from the next import on.'
              : 'Notion kept a different date than the photo’s.'}
          </p>
          <ul className="mt-1 space-y-0.5 opacity-70">
            {uploadResults.datingProblems.map((p, i) => <li key={i}>• {p.title} ({p.date}{p.stored ? `, Notion kept ${p.stored}` : ''})</li>)}
          </ul>
        </div>
      )}
      {uploadResults.failed.length > 0 && (
        <div className="text-sm text-left w-full p-3 rounded-lg lf-frame border" style={{ borderColor: 'var(--theme-border)', backgroundColor: 'var(--theme-bg)' }}>
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
