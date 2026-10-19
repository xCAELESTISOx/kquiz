// The splash in index.html covers the gap until the first screen has something to show.
// Today waits for its numbers (so it never opens on a skeleton); every other screen lifts it on mount.

/** Never hold the app hostage to a slow server: after this the screen's own loading state takes over. */
const MAX_WAIT_MS = 2500;

let hidden = false;

export function hideSplash() {
  if (hidden) return;
  hidden = true;
  const splash = document.getElementById("splash");
  if (!splash) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  splash.classList.add("is-leaving");
  if (reduce) splash.remove();
  else splash.addEventListener("transitionend", () => splash.remove(), { once: true });
}

export function scheduleSplashTimeout() {
  setTimeout(hideSplash, MAX_WAIT_MS);
}
