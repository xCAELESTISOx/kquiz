/**
 * The real screen height for the Home Screen app on iPhone.
 *
 * In standalone mode iOS sometimes lays the page out against a viewport shorter than the screen
 * (on launch, after the keyboard, after coming back from the background): 100%, 100dvh and
 * `position: fixed; bottom: 0` all end short, and an empty strip stays under the tab bar and the
 * buttons. The app fills the whole screen there anyway, so its height is taken from the screen
 * itself as `--app-h`, and `html.app-h` pins the layout to it (theme.css).
 */

export function standaloneHeight(screenW: number, screenH: number, portrait: boolean): number {
  // iOS keeps screen.width/height in portrait terms whatever the orientation.
  const long = Math.max(screenW, screenH);
  const short = Math.min(screenW, screenH);
  return portrait ? long : short;
}

export function watchAppHeight() {
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (!standalone) return;
  const root = document.documentElement;
  const portrait = matchMedia("(orientation: portrait)");

  function update() {
    const height = standaloneHeight(screen.width, screen.height, portrait.matches);
    // Never shorter than what the browser itself reports, in case the screen numbers are off.
    root.style.setProperty("--app-h", `${Math.max(height, innerHeight)}px`);
    root.classList.add("app-h");
  }

  update();
  addEventListener("resize", update);
  addEventListener("pageshow", update);
  portrait.addEventListener("change", update);
  document.addEventListener("visibilitychange", update);
}
