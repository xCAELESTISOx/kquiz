// The service worker (sw.js) keeps the app shell in a cache so the app opens at once. It is only
// for speed: data always comes from the server.
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  const sw = navigator.serviceWorker;

  // A new build took over. The open page still runs the old one: reload it where that loses
  // nothing (the Today screen), otherwise the next time the app goes to the background.
  if (sw.controller) {
    sw.addEventListener("controllerchange", () => {
      if (location.pathname === "/" && /^#?\/?$/.test(location.hash)) location.reload();
      else document.addEventListener("visibilitychange", () => document.hidden && location.reload());
    });
  }

  sw.register("/sw.js").then(
    (registration) => {
      // An installed PWA can stay alive in the background for days; check for a new build on return.
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) void registration.update().catch(() => {});
      });
    },
    (error: unknown) => console.warn("[kquiz] service worker not registered", error),
  );
}
