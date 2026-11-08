/**
 * Keeps the focused field above the on-screen keyboard.
 *
 * iOS Safari doesn't shrink the layout (or 100dvh) when the keyboard opens: only the visual viewport
 * gets shorter, and a full-height task screen keeps its answer field behind the keyboard until it is
 * closed and opened again. So while the keyboard is up, the visible height goes to `--vvh` and
 * `html.kb-open` is set: the app's scroller (#root) and a task screen (`.review`) shrink to it, the
 * pan iOS made is undone, and on a scrolling page the field is scrolled into the visible part.
 */

const OPEN_AT = 120; // px of height lost before it counts as the keyboard rather than browser bars
const GAP = 16;

function editable(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLTextAreaElement || el.isContentEditable) return true;
  return el instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit", "range", "file"].includes(el.type);
}

export function keyboardInset(layoutHeight: number, visibleHeight: number, scale: number): number {
  // A pinch-zoom also shortens the visual viewport; that is not the keyboard.
  if (scale > 1.01) return 0;
  return Math.max(0, layoutHeight - visibleHeight);
}

export function watchKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  let frame = 0;
  let moved = false; // the keyboard or focus changed, not just a scroll by the user

  function reveal(el: HTMLElement) {
    if (!vv) return;
    // The app now fits the visible part exactly; undo the pan iOS made to find the field.
    if (window.scrollY !== 0) window.scrollTo(0, 0);
    // A page the user scrolls themselves is left alone; only a new keyboard or field is chased.
    const scroller = document.getElementById("root");
    if (!moved || !scroller || el.closest(".review")) return;
    const rect = el.getBoundingClientRect();
    const top = GAP;
    const bottom = vv.height - GAP;
    if (rect.bottom > bottom) scroller.scrollBy(0, rect.bottom - bottom);
    else if (rect.top < top) scroller.scrollBy(0, rect.top - top);
  }

  function update() {
    frame = 0;
    if (!vv) return;
    const focused = document.activeElement;
    const open = editable(focused) && keyboardInset(root.clientHeight, vv.height, vv.scale) > OPEN_AT;
    root.style.setProperty("--vvh", `${Math.round(vv.height)}px`);
    root.classList.toggle("kb-open", open);
    if (open) reveal(focused);
    moved = false;
  }

  const schedule = (change: boolean) => {
    moved ||= change;
    if (!frame) frame = requestAnimationFrame(update);
  };

  vv.addEventListener("resize", () => schedule(true));
  vv.addEventListener("scroll", () => schedule(false));
  // The keyboard may already be up when focus moves to another field, so no resize comes then.
  addEventListener("focusin", () => schedule(true));
  addEventListener("focusout", () => setTimeout(() => schedule(false), 50));
}
