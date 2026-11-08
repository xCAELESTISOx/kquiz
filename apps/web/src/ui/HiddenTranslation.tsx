import { useState } from "react";

/** An example's translation, blurred until tapped, so the Korean is read first. */
export function HiddenTranslation({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      className={`hidden-translation${open ? " is-open" : ""}`}
      aria-expanded={open}
      aria-label={open ? undefined : "Show translation"}
      onClick={(e) => {
        e.stopPropagation();
        setOpen((o) => !o);
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span aria-hidden={!open}>{text}</span>
    </button>
  );
}
