// iOS freezes a home-screen app as soon as it leaves the screen and cuts its open connections, so a
// request in flight at that moment fails with "Load failed" though nothing is wrong. Such a request
// is simply tried again once the app is back.

let hiddenAt = typeof document !== "undefined" && document.hidden ? Date.now() : 0;
let shownAt = 0;
const waiting: (() => void)[] = [];

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      return;
    }
    shownAt = Date.now();
    for (const resolve of waiting.splice(0)) resolve();
  });
}

/** Resolves at once while the app is on screen, otherwise when it comes back. */
export function whenVisible(): Promise<void> {
  if (typeof document === "undefined" || !document.hidden) return Promise.resolve();
  return new Promise((resolve) => waiting.push(resolve));
}

/** Whether the app left the screen at any point since `since` (a Date.now() value), or is off it now. */
export function wasHiddenSince(since: number): boolean {
  if (typeof document !== "undefined" && document.hidden) return true;
  return hiddenAt >= since || shownAt >= since;
}

/** How long the app was off screen before it last came back; 0 while it has never left. */
export function lastAbsenceMs(): number {
  return shownAt > hiddenAt && hiddenAt > 0 ? shownAt - hiddenAt : 0;
}
