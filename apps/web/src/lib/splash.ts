// The splash in index.html covers the app until the first screen is complete: its data, and the
// font its text is set in (Pretendard's subsets load only as glyphs appear, and a late swap reflows
// every line). While it is up, <html> carries .booting, which holds the screens' entrance animations
// at their first frame; they play as the splash fades, so everything arrives once, in order.
// Today waits for all its numbers; every other screen lifts the splash on mount.

/** Never hold the app hostage to a slow server: after this Today shows what it has. */
export const MAX_WAIT_MS = 6000;
/** A font subset that hasn't arrived by then can swap in later; better than waiting on it. */
const FONT_WAIT_MS = 1200;
/** The content starts rising a beat after the splash starts fading, so the two don't blur together. */
const REVEAL_LAG_MS = 90;

let hidden = false;

/** True while the first screen is still behind the splash. */
export function splashShown(): boolean {
  return !hidden && !!document.getElementById("splash");
}

const deadline = new Promise<void>((resolve) => setTimeout(resolve, MAX_WAIT_MS));

/** Resolves when the splash has waited long enough for the first screen's data. */
export function bootDeadline(): Promise<void> {
  return deadline;
}

/** Loads the font faces the rendered text needs (only those subsets), giving up after a moment. */
function fontsFor(root: HTMLElement | null): Promise<unknown> {
  const fonts = document.fonts;
  const text = root?.textContent?.replace(/\s+/g, "") ?? "";
  if (!fonts || !text) return Promise.resolve();
  const loads = ["400", "500", "600", "700"].map((w) => fonts.load(`${w} 16px "Pretendard Variable"`, text).catch(() => {}));
  return Promise.race([Promise.all(loads).then(() => fonts.ready), new Promise((r) => setTimeout(r, FONT_WAIT_MS))]);
}

export function hideSplash() {
  if (hidden) return;
  hidden = true;
  const splash = document.getElementById("splash");
  const html = document.documentElement;
  if (!splash) {
    html.classList.remove("booting");
    return;
  }
  // After React has painted the screen under the splash, so its text is there to measure.
  requestAnimationFrame(() => {
    void fontsFor(document.getElementById("root")).then(() => {
      const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
      splash.classList.add("is-leaving");
      if (reduce) {
        splash.remove();
        html.classList.remove("booting");
        return;
      }
      setTimeout(() => html.classList.remove("booting"), REVEAL_LAG_MS);
      splash.addEventListener("transitionend", () => splash.remove(), { once: true });
      // In case the transition never runs (a hidden tab), don't leave it covering the app.
      setTimeout(() => splash.remove(), 1000);
    });
  });
}

/** The last resort, if no screen lifts the splash itself. */
export function scheduleSplashTimeout() {
  setTimeout(hideSplash, MAX_WAIT_MS + 1500);
}
