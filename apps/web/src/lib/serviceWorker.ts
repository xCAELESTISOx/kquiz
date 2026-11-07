import { lastAbsenceMs } from "./resume";

// The service worker (sw.js) keeps the app shell in a cache so the app opens at once. It is only
// for speed: data always comes from the server.

/** Away this long, coming back feels like opening the app anew, so a new build may load then. */
const STALE_AFTER_MS = 30 * 60_000;

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  const sw = navigator.serviceWorker;

  // A new build took over, but the open page still runs the old one. Reloading it on the spot
  // flashed the screen (and the loading splash) right as the app came back, and lost an open
  // session. So the old build keeps running (its files stay in the cache) until the app returns
  // after a long break; a fresh launch picks up the new one anyway.
  let stale = false;
  if (sw.controller) sw.addEventListener("controllerchange", () => (stale = true));

  sw.register("/sw.js").then(
    (registration) => {
      // An installed PWA can stay alive in the background for days; check for a new build on return.
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) return;
        if (stale && lastAbsenceMs() >= STALE_AFTER_MS) location.reload();
        else void registration.update().catch(() => {});
      });
    },
    (error: unknown) => console.warn("[kquiz] service worker not registered", error),
  );
}
