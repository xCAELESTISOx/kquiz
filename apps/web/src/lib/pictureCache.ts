// Word pictures are fetched when a session starts, for every word its queue holds and the next words
// from the pool, so a picture is already on the phone when its card comes up. The service worker
// (sw.js) keeps them in a cache of their own and drops the ones not shown for two weeks.

/** Fetches at once, so the session's own requests (choices, audio) don't wait behind pictures. */
const AT_ONCE = 3;

/** Pictures already asked for while this page is open. */
const asked = new Set<string>();

/** Fetches these pictures in the background; the service worker or the browser cache keeps them. */
export function prefetchPictures(urls: readonly (string | undefined | null)[], fetchImpl: typeof fetch = fetch): Promise<void> {
  const todo = [...new Set(urls.filter((u): u is string => !!u && !asked.has(u)))];
  for (const url of todo) asked.add(url);
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const url = todo[next++]!;
      // A picture not fetched now is fetched when shown; nothing to tell the user.
      try {
        const res = await fetchImpl(url, { credentials: "same-origin" });
        if (res.ok) await res.arrayBuffer();
        else asked.delete(url);
      } catch {
        asked.delete(url);
      }
    }
  };
  return Promise.all(Array.from({ length: Math.min(AT_ONCE, todo.length) }, worker)).then(() => {});
}

/** Forgets what was fetched, for tests. */
export function resetPrefetched() {
  asked.clear();
}
