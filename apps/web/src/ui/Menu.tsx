import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { MoreIcon } from "./icons";

/**
 * The "⋯" button and the list it opens, for actions that don't need a place of their own on screen.
 * Closes on a pick, a tap elsewhere or Escape. Items are MenuItem links or buttons.
 */
export function Menu({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    addEventListener("pointerdown", onPointer);
    addEventListener("keydown", onKey);
    // The first item takes the focus, so the keyboard goes on from there.
    root.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => {
      removeEventListener("pointerdown", onPointer);
      removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="menu" ref={root}>
      <button
        type="button"
        className="icon-button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreIcon />
      </button>
      {open && (
        <div className="menu-list" id={id} role="menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ href, icon, hint, children }: { href: string; icon?: ReactNode; hint?: string; children: ReactNode }) {
  return (
    <a className="menu-item" role="menuitem" href={href}>
      {icon}
      <span className="menu-item-text">
        <span>{children}</span>
        {hint && <span className="muted small">{hint}</span>}
      </span>
    </a>
  );
}
