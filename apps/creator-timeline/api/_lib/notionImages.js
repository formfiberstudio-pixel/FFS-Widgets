import { notionFetch } from './notionFetch.js';
import { getCachedImageUrl } from './notionCache.js';
import { isThumbnailableUrl } from './notionImageHosts.js';

// Finding a log's photo in Notion, shared by the sync (get-notion-logs.js) and
// the thumbnail proxy (image-thumb.js).

// Block types that can hold their own children where a photo commonly
// ends up tucked away (a "Photos" toggle, a two-column layout, a callout)
// -- worth descending into. Left out: things like paragraphs/headings,
// which can technically have children (a sub-bullet) but are never where
// someone drops an image.
const CONTAINER_BLOCK_TYPES = new Set([
  'toggle', 'column_list', 'column', 'synced_block', 'callout', 'quote',
  'bulleted_list_item', 'numbered_list_item', 'to_do', 'template',
]);

// Most journal-style entries put a photo at most a level or two deep --
// bounding recursion keeps a pathological page from costing one Notion
// request per nested block for no benefit.
const MAX_BLOCK_SEARCH_DEPTH = 3;

// The Notion blocks endpoint only ever returns a block's DIRECT children,
// capped at one page of results -- a photo pasted inside a toggle, column,
// or callout (all common ways to keep a log entry tidy) is invisible to a
// single flat page_size=25 call. This walks every page of a block's
// children (following has_more/next_cursor) and recurses into any child
// that can itself hold content, stopping as soon as both an image and a
// text excerpt have been found.
export async function findImageAndTextInBlocks(blockId, headers, depth = 0) {
  let rawImageUrl = null;
  let pageContent = '';
  let pageContentBlockId = null;
  let pageContentBlockType = null;
  const childIdsToDescend = [];

  let cursor;
  let hasMore = true;
  while (hasMore) {
    const res = await notionFetch(
      `https://api.notion.com/v1/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`,
      { method: 'GET', headers }
    );
    if (!res.ok) return { rawImageUrl, pageContent, pageContentBlockId, pageContentBlockType, ok: false, status: res.status };
    const data = await res.json();

    for (const b of data.results) {
      if (!rawImageUrl && b.type === 'image') {
        rawImageUrl = b.image.type === 'external' ? b.image.external.url : b.image.file.url;
      }
      if (!pageContent) {
        const blockTypeData = b[b.type];
        if (blockTypeData?.rich_text?.length) {
          pageContent = blockTypeData.rich_text.map(t => t.plain_text).join('');
          // The id/type are what let an edit be written back to this exact
          // block later (see api/backlog-photo.js's updateNote action) --
          // captured here since this is the only place that ever resolves
          // which block a log's note text actually lives in.
          pageContentBlockId = b.id;
          pageContentBlockType = b.type;
        }
      }
      if (b.has_children && depth < MAX_BLOCK_SEARCH_DEPTH && CONTAINER_BLOCK_TYPES.has(b.type)) {
        childIdsToDescend.push(b.id);
      }
    }
    hasMore = data.has_more;
    cursor = data.next_cursor;
  }

  for (const childId of childIdsToDescend) {
    if (rawImageUrl && pageContent) break;
    const nested = await findImageAndTextInBlocks(childId, headers, depth + 1);
    if (!nested.ok) return { rawImageUrl, pageContent, pageContentBlockId, pageContentBlockType, ok: false, status: nested.status };
    if (!rawImageUrl) rawImageUrl = nested.rawImageUrl;
    if (!pageContent) {
      pageContent = nested.pageContent;
      pageContentBlockId = nested.pageContentBlockId;
      pageContentBlockType = nested.pageContentBlockType;
    }
  }

  return { rawImageUrl, pageContent, pageContentBlockId, pageContentBlockType, ok: true };
}

// A photo can reach a Notion page two ways that never touch the page BODY
// (and so are invisible to the blocks/children fetch above): attached via
// a "Files & media" property on the row itself, or set as the page's
// cover. Both are already present in the database-query response we have
// in hand -- no extra Notion request -- so they're checked as a free
// fallback for sources (e.g. a project tracker) that attach photos this
// way instead of pasting an inline image into the body.
export function extractPagePropertyImage(props) {
  const filesProp = Object.values(props).find(p => p.type === 'files' && p.files?.length > 0);
  if (!filesProp) return null;
  const file = filesProp.files[0];
  return file.file?.url || file.external?.url || null;
}

export function getPageCoverUrl(page) {
  if (!page.cover) return null;
  return page.cover.file?.url || page.cover.external?.url || null;
}

// ---------------------------------------------------------------------------
// The thumbnail's own address.
//
// Notion's file URLs are signed and lapse within the hour, so a thumbnail
// address built on one changes every time the sync re-reads the page -- the
// browser (and the CDN) sees a new picture each time and downloads it again.
// A page's photo is instead addressed by WHICH PAGE it is and WHICH EDIT of it
// (the page's last_edited_time): the same address for as long as the page is
// untouched, a new one the moment it is edited. The proxy (image-thumb.js)
// finds a fresh Notion link when a thumbnail is actually asked for, and the
// result can be kept by the browser, the phone's web view and the CDN for good.

// 'b' = the photo is in the page body, 'pg' = it is a Files & media property
// or the page cover (read from the page itself).
export const IMAGE_SOURCE_BODY = 'b';
export const IMAGE_SOURCE_PAGE = 'pg';
export const THUMBNAIL_WIDTH = 640;

export function stableThumbnailUrl({ tenantId, pageId, source, editedAt, width = THUMBNAIL_WIDTH }) {
  const edit = Date.parse(editedAt);
  const params = new URLSearchParams({
    t: tenantId,
    p: pageId,
    s: source,
    v: String(Number.isFinite(edit) ? edit : 0),
    w: String(width),
  });
  return `/api/image-thumb?${params}`;
}

// What the calendar is given as a log's picture: the stable thumbnail address
// for a photo Notion hosts. Anything else (an externally hosted image pasted
// into Notion) is passed through unchanged, rather than pointed at a proxy
// that would reject its host -- it doesn't lapse either.
export function thumbnailUrlFor({ rawUrl, source, page, tenantId }) {
  if (!rawUrl) return null;
  if (!isThumbnailableUrl(rawUrl)) return rawUrl;
  return stableThumbnailUrl({ tenantId, pageId: page.id, source, editedAt: page.last_edited_time });
}

// A fresh Notion link for a page's photo, or null when it has none now.
// `editMs` is the edit the thumbnail's address names: the body photo link the
// sync cached for that exact edit is used while it is still good; otherwise
// the page is read again.
export async function resolveNotionImageUrl({ pageId, source, editMs }, headers) {
  if (source === IMAGE_SOURCE_PAGE) {
    const res = await notionFetch(`https://api.notion.com/v1/pages/${pageId}`, { method: 'GET', headers });
    if (!res.ok) return null;
    const page = await res.json();
    return extractPagePropertyImage(page.properties || {}) || getPageCoverUrl(page);
  }

  const cached = await getCachedImageUrl(pageId, editMs);
  if (cached) return cached;
  const found = await findImageAndTextInBlocks(pageId, headers);
  return found.ok ? found.rawImageUrl : null;
}
