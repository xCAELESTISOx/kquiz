import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

export function prefersReducedMotion(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Counts from 0 up to `value` with an ease-out curve. Purely visual: the real value is in aria-labels. */
export function useCountUp(value: number, duration = 700): number {
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? value : 0));
  useEffect(() => {
    if (prefersReducedMotion()) return setShown(value);
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      setShown(Math.round(value * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);
  return shown;
}

/**
 * FLIP: when `dep` changes and the element moves in the layout, it glides from its old spot
 * instead of jumping. Transform only, so it never triggers layout work of its own.
 */
export function useGlide<T extends HTMLElement>(ref: RefObject<T | null>, dep: unknown) {
  const last = useRef<number>(undefined);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // offsetTop is layout-only, so a transform still running on the element or its card doesn't skew it.
    const top = el.offsetTop;
    const before = last.current;
    last.current = top;
    if (before === undefined || before === top || prefersReducedMotion()) return;
    el.style.transition = "none";
    el.style.transform = `translateY(${before - top}px)`;
    void el.offsetHeight;
    el.style.transition = "transform 380ms var(--ease-spring)";
    el.style.transform = "";
  }, [dep]);
}
