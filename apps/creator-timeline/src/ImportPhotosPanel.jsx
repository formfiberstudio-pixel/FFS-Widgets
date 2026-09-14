import { useState, useRef, useEffect } from 'react';
import exifr from 'exifr';

// Downscales+recompresses a photo client-side before it ever leaves the
// browser. A phone photo can easily be 5-15MB; Vercel serverless functions
// hard-cap the incoming request body at 4.5MB regardless of how the body
// is parsed, so sending originals would fail outright for exactly the
// photos this feature exists to handle. imageOrientation: 'from-image'
// asks the browser to bake in the EXIF rotation flag so a photo shot in
// portrait doesn't come out sideways once EXIF is stripped by re-encoding.
async function resizeImageForUpload(file, maxDim = 1800, quality = 0.82) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  let { width, height } = bitmap;
  if (width > maxDim || height > maxDim) {
    const scale = maxDim / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('Could not encode image'));
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    }, 'image/jpeg', quality);
  });
}

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

export default function ImportPhotosPanel({ allProjects, tenantId, onClose, onUploaded, sharedPhotos, onConsumedSharedPhotos }) {
  // The project picked in step 1 -- now just the DEFAULT new photos get
  // assigned, not a batch-wide setting. Each photo carries its own
  // projectKey (below) and can be reassigned individually in the review
  // grid, so a single batch can land across several different projects.
  const [defaultProject, setDefaultProject] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [step, setStep] = useState('select-project'); // select-project | review | uploading | done
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 });
  const [uploadResults, setUploadResults] = useState({ byProject: [], failed: [] });
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  // Object URLs are only good until the tab/component goes away -- clean
  // up whatever's still outstanding rather than leaking them.
  useEffect(() => {
    return () => photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
  }, []);

  const photoFromFile = async (file, exifOverrideDate) => {
    const previewUrl = URL.createObjectURL(file);
    let date = new Date();
    let hasExif = false;
    if (exifOverrideDate) {
      // Already extracted server-side (see share-target.js) from the
      // original, full-EXIF bytes -- re-reading EXIF from this same file
      // client-side would just repeat that same lookup.
      date = new Date(exifOverrideDate);
      hasExif = true;
    } else {
      try {
        const exif = await exifr.parse(file, { pick: ['DateTimeOriginal', 'CreateDate'] });
        const exifDate = exif?.DateTimeOriginal || exif?.CreateDate;
        if (exifDate instanceof Date && !isNaN(exifDate.getTime())) {
          date = exifDate;
          hasExif = true;
        }
      } catch (err) {
        // No EXIF, or a format exifr can't read (e.g. some HEIC/PNG paths)
        // -- falls back to today, left for the user to fix below.
      }
    }
    return {
      id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
      file,
      previewUrl,
      date: toDateInputValue(date),
      hasExif,
      projectKey: defaultProject ? projectKeyOf(defaultProject) : '',
    };
  };

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
    const newPhotos = await Promise.all(files.map((file) => photoFromFile(file)));
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

  const removePhoto = (id) => {
    setPhotos((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
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
      const groupProject = allProjects.find((p) => projectKeyOf(p) === projectKey);
      let pageId = null;

      if (!groupProject) {
        // Shouldn't happen (every photo's projectKey comes from
        // allProjects), but fail that group's photos explicitly rather
        // than silently dropping them if it ever does.
        groupPhotos.forEach((photo) => {
          failed.push({ name: photo.file.name, error: 'No project selected for this photo' });
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
          const imageBase64 = await resizeImageForUpload(photo.file);
          const body = pageId
            ? { tenantId, pageId, imageBase64 }
            : { tenantId, referenceLogId: groupProject.referenceLogId, title: `${groupProject.title} — ${formattedDate}`, dateTaken: date, imageBase64 };

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
          failed.push({ name: photo.file.name, error: err.message });
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
    setDefaultProject(null);
    setUploadResults({ byProject: [], failed: [] });
    setStep('select-project');
  };

  // -----------------------------------------------------------------
  // STEP 1: pick a default project for new photos (each photo can still
  // be reassigned individually once added, in step 2)
  // -----------------------------------------------------------------
  if (step === 'select-project') {
    const bySource = {};
    allProjects.forEach((p) => {
      if (!bySource[p.source]) bySource[p.source] = [];
      bySource[p.source].push(p);
    });

    return (
      <div className="flex flex-col h-full w-full min-h-0 max-w-2xl mx-auto">
        <p className="text-sm opacity-60 mb-4 shrink-0">
          Which project should backlogged photos default to? You can assign individual photos to a different project once they're added.
        </p>
        <div className="flex-1 overflow-y-auto min-h-0 space-y-4 pr-1">
          {Object.entries(bySource).map(([source, projs]) => (
            <div key={source}>
              <div className="text-[10px] font-black uppercase tracking-wider opacity-50 mb-1.5">{source}</div>
              <div className="space-y-1.5">
                {projs.map((p) => (
                  <button
                    key={projectKeyOf(p)}
                    onClick={() => { setDefaultProject(p); setStep('review'); }}
                    style={{ backgroundColor: 'var(--theme-bg)', borderColor: 'var(--theme-border)' }}
                    className="w-full text-left p-3 rounded-lg border cursor-pointer transition-colors hover:border-[var(--theme-primary)] flex items-center justify-between"
                  >
                    <span className="font-semibold text-sm">{p.title}</span>
                    <span className="text-xs opacity-50">Select →</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {allProjects.length === 0 && (
            <div className="text-sm italic opacity-50 text-center py-8">
              No projects found yet -- sync your calendar first.
            </div>
          )}
        </div>
      </div>
    );
  }

  // -----------------------------------------------------------------
  // STEP 2: add photos, review/fix each one's date
  // -----------------------------------------------------------------
  if (step === 'review') {
    return (
      <div className="flex flex-col h-full w-full min-h-0">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4 shrink-0">
          <div>
            <button onClick={() => setStep('select-project')} className="text-xs font-semibold cursor-pointer hover:opacity-70" style={{ color: 'var(--theme-primary)' }}>
              ‹ Change Default Project
            </button>
            <div className="text-sm font-bold mt-0.5">New photos default to: {defaultProject.title}</div>
          </div>
          <button
            onClick={startUpload}
            disabled={photos.length === 0}
            style={{ backgroundColor: 'var(--theme-primary)' }}
            className="w-full sm:w-auto px-4 py-2.5 sm:py-2 text-sm font-bold text-white rounded-lg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          >
            Upload {photos.length} Photo{photos.length === 1 ? '' : 's'}
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }}
        />

        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFiles(e.dataTransfer.files); }}
          style={{
            borderColor: isDragging ? 'var(--theme-primary)' : 'var(--theme-border)',
            backgroundColor: isDragging ? 'var(--theme-bg)' : 'transparent',
          }}
          className="shrink-0 mb-4 border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors"
        >
          <div className="text-sm font-semibold opacity-70">+ Add Photos</div>
          <div className="text-xs opacity-50 mt-1">Click to browse, or drag and drop -- dates are read from each photo automatically</div>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 pr-1">
          {photos.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm italic opacity-50">
              No photos added yet.
            </div>
          ) : (
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
              {photos.map((photo) => (
                <div key={photo.id} style={{ backgroundColor: 'var(--theme-bg)', borderColor: 'var(--theme-border)' }} className="rounded-lg border overflow-hidden">
                  <div className="relative aspect-square" style={{ backgroundColor: 'var(--theme-card)' }}>
                    <img src={photo.previewUrl} alt="" className="w-full h-full object-cover" />
                    <button
                      onClick={() => removePhoto(photo.id)}
                      title="Remove"
                      className="absolute top-1 right-1 w-8 h-8 rounded-full bg-black/60 text-white text-lg flex items-center justify-center cursor-pointer hover:bg-black/80"
                    >
                      ×
                    </button>
                    {!photo.hasExif && (
                      <span className="absolute bottom-1 left-1 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-black/60 text-white/90">
                        No EXIF
                      </span>
                    )}
                  </div>
                  <div className="p-2 space-y-1.5">
                    <select
                      value={photo.projectKey}
                      onChange={(e) => updatePhotoProject(photo.id, e.target.value)}
                      style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)', color: 'var(--theme-text)' }}
                      className="w-full text-xs px-1.5 py-1 rounded border truncate"
                    >
                      {allProjects.map((p) => (
                        <option key={projectKeyOf(p)} value={projectKeyOf(p)}>{p.title}</option>
                      ))}
                    </select>
                    <input
                      type="date"
                      value={photo.date}
                      onChange={(e) => updatePhotoDate(photo.id, e.target.value)}
                      style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)', color: 'var(--theme-text)' }}
                      className="w-full text-xs px-1.5 py-1 rounded border"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
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
