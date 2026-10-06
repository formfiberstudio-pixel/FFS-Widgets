import { Redis } from '@upstash/redis';
import { TIMER_TTL_SECONDS } from './timerState.js';

// Where the running timer (and the pictures added to it) are kept: the same
// Upstash Redis as tenantStore.js, under keys of their own. Same env vars --
// see tenantStore.js for why KV_REST_API_* is named directly.
const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const timerKey = (tenantId) => `activeTimer:${tenantId}`;
const photoKey = (tenantId, photoId) => `timerPhoto:${tenantId}:${photoId}`;
const savedKey = (tenantId, sessionKey) => `timerSaved:${tenantId}:${sessionKey}`;

export const getActiveTimer = (tenantId) => redis.get(timerKey(tenantId));

// Every change re-sets the expiry, so a timer in use never lapses.
export const saveActiveTimer = (tenantId, timer) => redis.set(timerKey(tenantId), timer, { ex: TIMER_TTL_SECONDS });

export const deleteActiveTimer = (tenantId) => redis.del(timerKey(tenantId));

// A picture added to the timer, as the data URL the client sent, kept as long
// as the timer itself could be.
export const putTimerPhotoData = (tenantId, photoId, dataUrl) => redis.set(photoKey(tenantId, photoId), dataUrl, { ex: TIMER_TTL_SECONDS });

export async function getTimerPhotoData(tenantId, photoId) {
  const value = await redis.get(photoKey(tenantId, photoId));
  return typeof value === 'string' ? value : null;
}

export async function deleteTimerPhotoData(tenantId, photoIds) {
  if (!photoIds?.length) return;
  await redis.del(...photoIds.map((id) => photoKey(tenantId, id)));
}

// Two devices can press Stop on the same timer at about the same moment. The
// first to claim the session (by its start time) saves it; the other is told
// it is already being, or has been, saved instead of making a second entry.
// The claim holds for an hour -- far longer than a save takes, and the timer
// itself is gone by then.
const SAVED_TTL_SECONDS = 60 * 60;

export async function claimSavedSession(tenantId, sessionKey) {
  const result = await redis.set(savedKey(tenantId, sessionKey), 'pending', { nx: true, ex: SAVED_TTL_SECONDS });
  return result === 'OK';
}

export const markSavedSession = (tenantId, sessionKey, pageId) => redis.set(savedKey(tenantId, sessionKey), pageId, { ex: SAVED_TTL_SECONDS });

export const releaseSavedSession = (tenantId, sessionKey) => redis.del(savedKey(tenantId, sessionKey));

// The page the session was saved as, or null while it is still 'pending'.
export async function getSavedSessionPageId(tenantId, sessionKey) {
  const value = await redis.get(savedKey(tenantId, sessionKey));
  return typeof value === 'string' && value !== 'pending' ? value : null;
}
