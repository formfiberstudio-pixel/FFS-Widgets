// One-off bridge: reads a Mandalart MandalartSnapshot JSON (pulled from the
// Android app's DataStore) and pushes each day's photo log entries into one
// or more Notion databases, using the same page/property shape as
// apps/creator-timeline/api/add-notion-log.js.
//
// Which sub-goals feed which database is configured in a routes file (see
// sync-routes.example.json) rather than hardcoded — a photo tagged to a
// sub-goal listed in a route's subGoalIds gets synced to that route's
// database. A sub-goal can appear in more than one route (it'll sync to
// each), and a route can list any number of sub-goals.
//
// Mandalart's DailyLogEntry only has a date key, free text, and a list of
// DailyPhotoEntry (each optionally tagged to a pillar/sub-goal). There's no
// lat/lon captured yet (that's still on Mandalart's roadmap), so the Notion
// "Place" property is left unset here. Entries with no real photo, or whose
// photos aren't tagged to any sub-goal listed in a route, are skipped and
// reported, since add-notion-log.js's page-create path requires an image.
//
// Usage:
//   node sync-mandalart-to-creator-timeline.js --snapshot <path> --photos-dir <dir> [--routes <path>] [--live]
//   node sync-mandalart-to-creator-timeline.js --snapshot <path> --list-subgoals
//
// Without --live, this only prints what it would create — nothing is sent to
// Notion. Requires NOTION_TOKEN in .env (see .env.example) before --live
// will do anything. --list-subgoals prints every pillar/sub-goal in the
// snapshot with its id, so you can build the routes file.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

const NOTION_VERSION = '2026-03-11';
const DEFAULT_ROUTES_PATH = fileURLToPath(new URL('./sync-routes.json', import.meta.url));

function parseArgs(argv) {
  const args = { live: false, listSubGoals: false, routes: DEFAULT_ROUTES_PATH };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--snapshot') args.snapshot = argv[++i];
    else if (argv[i] === '--photos-dir') args.photosDir = argv[++i];
    else if (argv[i] === '--routes') args.routes = argv[++i];
    else if (argv[i] === '--live') args.live = true;
    else if (argv[i] === '--list-subgoals') args.listSubGoals = true;
  }
  if (!args.snapshot || (!args.listSubGoals && !args.photosDir)) {
    console.error(
      'Usage:\n' +
      '  node sync-mandalart-to-creator-timeline.js --snapshot <path> --photos-dir <dir> [--routes <path>] [--live]\n' +
      '  node sync-mandalart-to-creator-timeline.js --snapshot <path> --list-subgoals'
    );
    process.exit(1);
  }
  return args;
}

function buildPillarLookup(pillars) {
  const lookup = new Map();
  for (const pillar of pillars || []) {
    for (const subGoal of pillar.subGoals || []) {
      lookup.set(subGoal.id, { pillarName: pillar.name, subGoalName: subGoal.name });
    }
  }
  return lookup;
}

function printSubGoalList(snapshot) {
  console.log('\nPillars & Sub-Goals in this snapshot:\n');
  for (const pillar of snapshot.pillars || []) {
    console.log(pillar.name);
    for (const subGoal of pillar.subGoals || []) {
      console.log(`  ${subGoal.name.padEnd(24)} ${subGoal.id}`);
    }
    console.log('');
  }
  console.log('Copy sub-goal ids into a route\'s "subGoalIds" array in sync-routes.json.');
}

async function loadRoutes(routesPath) {
  let raw;
  try {
    raw = await readFile(routesPath, 'utf-8');
  } catch (err) {
    throw new Error(`Couldn't read routes file at ${routesPath} — copy sync-routes.example.json to sync-routes.json and fill it in. (${err.message})`);
  }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.routes) || parsed.routes.length === 0) {
    throw new Error(`${routesPath} has no routes defined.`);
  }
  for (const route of parsed.routes) {
    if (!route.databaseId || !Array.isArray(route.subGoalIds) || route.subGoalIds.length === 0) {
      throw new Error(`Route "${route.label || '(unlabeled)'}" needs a databaseId and a non-empty subGoalIds array.`);
    }
  }
  return parsed.routes;
}

function titleFor(pillarLookup, subGoalId) {
  const found = pillarLookup.get(subGoalId);
  return found ? `${found.pillarName} · ${found.subGoalName}` : 'Mandalart Log';
}

async function uploadImageToNotion(filePath, notionToken) {
  const buffer = await readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = ext === '.png' ? 'image/png' : 'image/jpeg';
  const fileName = path.basename(filePath);

  const headers = {
    Authorization: `Bearer ${notionToken}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };

  const createRes = await fetch('https://api.notion.com/v1/file_uploads', {
    method: 'POST',
    headers,
    body: JSON.stringify({ filename: fileName, content_type: contentType }),
  });
  const createData = await createRes.json();
  if (!createData.id) throw new Error(`file_uploads create failed: ${createData.message || JSON.stringify(createData)}`);

  const targetUrl = createData.upload_url || `https://api.notion.com/v1/file_uploads/${createData.id}/send`;
  const blob = new Blob([buffer], { type: contentType });
  const formData = new FormData();
  formData.append('file', blob, fileName);

  const uploadRes = await fetch(targetUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${notionToken}`, 'Notion-Version': NOTION_VERSION },
    body: formData,
  });
  if (!uploadRes.ok) throw new Error(`file upload send failed: ${await uploadRes.text()}`);

  return createData.id;
}

async function createPage({ notionToken, databaseId, title, isoDate, noteText, firstImageFileId }) {
  const headers = {
    Authorization: `Bearer ${notionToken}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };

  const children = [
    { object: 'block', type: 'image', image: { type: 'file_upload', file_upload: { id: firstImageFileId } } },
  ];
  if (noteText && noteText.trim() !== '') {
    children.push({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: noteText.trim() } }] },
    });
  }

  const payload = {
    parent: { database_id: databaseId },
    properties: {
      Name: { title: [{ text: { content: title } }] },
      'Post-Date': { date: { start: isoDate } },
    },
    children,
    cover: { type: 'file_upload', file_upload: { id: firstImageFileId } },
  };

  const res = await fetch('https://api.notion.com/v1/pages', { method: 'POST', headers, body: JSON.stringify(payload) });
  const data = await res.json();
  if (data.object === 'error') throw new Error(`page create failed: ${data.message}`);
  return data.id;
}

async function appendImageToPage({ notionToken, pageId, fileId }) {
  const headers = {
    Authorization: `Bearer ${notionToken}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
  const res = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ children: [{ object: 'block', type: 'image', image: { type: 'file_upload', file_upload: { id: fileId } } }] }),
  });
  const data = await res.json();
  if (data.object === 'error') throw new Error(`append image failed: ${data.message}`);
}

/** For one day's real photos, work out which route(s) each photo belongs to
 *  (by subGoalId membership), and group into one sync job per route that has
 *  at least one matching photo. A photo whose sub-goal is listed in two
 *  routes ends up in both jobs. Photos with no sub-goal, or a sub-goal not
 *  listed in any route, come back separately as "unmapped". */
function planDay(date, entry, realPhotos, routes, pillarLookup, photosDir) {
  const jobsByRoute = new Map();
  const unmapped = [];

  for (const photo of realPhotos) {
    const matchingRoutes = photo.subGoalId
      ? routes.filter((r) => r.subGoalIds.includes(photo.subGoalId))
      : [];

    if (matchingRoutes.length === 0) {
      unmapped.push(photo);
      continue;
    }

    for (const route of matchingRoutes) {
      if (!jobsByRoute.has(route)) {
        jobsByRoute.set(route, { route, photos: [] });
      }
      jobsByRoute.get(route).photos.push(photo);
    }
  }

  const jobs = [...jobsByRoute.values()].map(({ route, photos }) => {
    const first = photos[0];
    const title = titleFor(pillarLookup, first.subGoalId);
    const noteText = [entry.text, ...photos.map((p) => p.note)].filter(Boolean).join(' — ');
    const localFiles = photos.map((p) => path.join(photosDir, path.basename(p.photoPath)));
    return { date, route, title, noteText, photoCount: photos.length, localFiles };
  });

  return { jobs, unmapped };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const snapshot = JSON.parse(await readFile(args.snapshot, 'utf-8'));

  if (args.listSubGoals) {
    printSubGoalList(snapshot);
    return;
  }

  const routes = await loadRoutes(args.routes);
  const pillarLookup = buildPillarLookup(snapshot.pillars);

  const dates = Object.keys(snapshot.dailyLogEntries || {}).sort();
  const skippedNoPhoto = [];
  const allJobs = [];
  const allUnmapped = [];

  for (const date of dates) {
    const entry = snapshot.dailyLogEntries[date];
    const realPhotos = (entry.photos || []).filter((p) => p.photoPath);
    if (realPhotos.length === 0) {
      skippedNoPhoto.push({ date, reason: entry.photos?.length ? 'only doodles, no real image' : 'text-only, no photos' });
      continue;
    }
    const { jobs, unmapped } = planDay(date, entry, realPhotos, routes, pillarLookup, args.photosDir);
    allJobs.push(...jobs);
    if (unmapped.length > 0) allUnmapped.push({ date, count: unmapped.length });
  }

  console.log(`\nMandalart snapshot: ${dates.length} day(s) logged.`);
  console.log(`  ${allJobs.length} page(s) will sync across ${routes.length} configured route(s).`);
  console.log(`  ${skippedNoPhoto.length} day(s) skipped (no real photo).`);
  console.log(`  ${allUnmapped.reduce((n, u) => n + u.count, 0)} photo(s) skipped (not tagged to any routed sub-goal).\n`);

  for (const s of skippedNoPhoto) console.log(`  SKIP  ${s.date} — ${s.reason}`);
  for (const u of allUnmapped) console.log(`  SKIP  ${u.date} — ${u.count} photo(s) tagged to a sub-goal with no matching route`);
  for (const j of allJobs) {
    console.log(`  SYNC  ${j.date} — "${j.title}" → ${j.route.label} (${j.photoCount} photo${j.photoCount > 1 ? 's' : ''})`);
    console.log(`          note: ${j.noteText || '(none)'}`);
    console.log(`          files: ${j.localFiles.join(', ')}`);
  }

  if (!args.live) {
    console.log('\nDry run only — nothing was sent to Notion. Pass --live to actually create these pages.');
    return;
  }

  const notionToken = process.env.NOTION_TOKEN;
  if (!notionToken) {
    console.error('\nMissing NOTION_TOKEN — set it in .env (see .env.example) before using --live.');
    process.exit(1);
  }

  console.log('\nLive mode — writing to Notion...\n');
  for (const j of allJobs) {
    try {
      const [firstFile, ...restFiles] = j.localFiles;
      const firstImageFileId = await uploadImageToNotion(firstFile, notionToken);
      const pageId = await createPage({
        notionToken,
        databaseId: j.route.databaseId,
        title: j.title,
        isoDate: new Date(j.date + 'T12:00:00').toISOString(),
        noteText: j.noteText,
        firstImageFileId,
      });
      for (const extra of restFiles) {
        const fileId = await uploadImageToNotion(extra, notionToken);
        await appendImageToPage({ notionToken, pageId, fileId });
      }
      console.log(`  OK    ${j.date} → ${j.route.label} — page ${pageId}`);
    } catch (err) {
      console.error(`  FAIL  ${j.date} → ${j.route.label} — ${err.message}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
