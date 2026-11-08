/**
 * The strip iOS leaves under a Home Screen app.
 *
 * iOS 26 sizes a standalone web app with `black-translucent` + `viewport-fit=cover` a status bar's
 * height short of the screen (59 pt with a Dynamic Island) and paints nothing fixed below that, so
 * the tab bar and the buttons stop above an empty band. Nothing can be drawn there; what can be done
 * is not to leave the home-indicator inset on top of it. A fixed probe pinned top and bottom shows
 * where iOS thinks the bottom is, the screen shows the real one, and the difference goes to
 * `--vp-gap` with `html.vp-gap` (theme.css). It is re-measured on resize, since iOS sometimes
 * corrects itself (after a scroll, a rotation, coming back from the background).
 *
 * See https://github.com/campeterson/ultrapilot/pull/12 and https://github.com/jessemorley/Invoice/pull/109.
 */

const MAX_GAP = 80;

export function viewportGap(screenW: number, screenH: number, portrait: boolean, laidOut: number): number {
  // iOS keeps screen.width/height in portrait terms whatever the orientation.
  const real = portrait ? Math.max(screenW, screenH) : Math.min(screenW, screenH);
  const gap = Math.round(real - laidOut);
  return gap > 0 && gap <= MAX_GAP ? gap : 0;
}

export function watchViewportGap() {
  if ((navigator as Navigator & { standalone?: boolean }).standalone !== true) return;
  const root = document.documentElement;
  const portrait = matchMedia("(orientation: portrait)");
  const probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = "position:fixed;top:0;bottom:0;left:0;width:0;visibility:hidden;pointer-events:none";
  document.body.append(probe);

  function update() {
    const gap = viewportGap(screen.width, screen.height, portrait.matches, probe.getBoundingClientRect().height);
    root.style.setProperty("--vp-gap", `${gap}px`);
    root.classList.toggle("vp-gap", gap > 0);
  }

  update();
  addEventListener("resize", update);
  addEventListener("pageshow", update);
  portrait.addEventListener("change", update);
  document.addEventListener("visibilitychange", update);
  window.visualViewport?.addEventListener("resize", update);
}
