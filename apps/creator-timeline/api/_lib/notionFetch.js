// Notion enforces an average of ~3 requests/second per integration. A
// database with a few hundred rows firing one relation lookup and one
// block-children fetch per row -- all in a single unthrottled Promise.all --
// blows past that in the very first burst and 429s outright, which is what
// surfaces to the widget as "You have been rate limited." These two helpers
// keep the fan-out under that ceiling and give a stray 429 a chance to
// recover instead of failing the whole sync.

const NOTION_MAX_RETRIES = 3;
const NOTION_BASE_BACKOFF_MS = 500;

// Retries a Notion request on 429, honoring the Retry-After header Notion
// sends (seconds) when present, else backing off exponentially. Any other
// status (including other errors) is returned as-is for the caller to
// handle -- this only ever intervenes on rate limiting.
export async function notionFetch(url, options) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, options);
    if (response.status !== 429 || attempt >= NOTION_MAX_RETRIES) return response;

    const retryAfterHeader = response.headers.get('Retry-After');
    const waitMs = retryAfterHeader
      ? Number(retryAfterHeader) * 1000
      : NOTION_BASE_BACKOFF_MS * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

// Runs fn over items with at most `limit` in flight at once, rather than
// Promise.all's unbounded "every item at the same instant." Order of
// results matches the input order regardless of completion order.
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await fn(items[current], current);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
