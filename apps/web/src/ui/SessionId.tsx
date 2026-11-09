import { useEffect, useRef, useState, type PointerEvent } from "react";
import { currentLogId, flushLog } from "../lib/sessionLog";
import { CloseIcon } from "./icons";
import "./today.css";

const HOLD_MS = 700;

export type LongPress = ReturnType<typeof useLongPress>;

/** Handlers for an element that does `onLong` when held still for a moment; nothing on a tap. */
export function useLongPress(onLong: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const start = useRef<{ x: number; y: number }>(undefined);
  const cancel = () => {
    clearTimeout(timer.current);
    start.current = undefined;
  };
  useEffect(() => cancel, []);
  return {
    onPointerDown(e: PointerEvent<HTMLElement>) {
      cancel();
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        start.current = undefined;
        navigator.vibrate?.(15);
        onLong();
      }, HOLD_MS);
    },
    onPointerMove(e: PointerEvent<HTMLElement>) {
      if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onContextMenu(e: { preventDefault: () => void }) {
      e.preventDefault();
    },
  };
}

/**
 * The hidden way to send a session to Claude: its short id, to copy and paste into a chat, where
 * Claude reads the log through the KQuiz connector (get_session_log).
 */
export function SessionId({ onClose }: { onClose: () => void }) {
  const id = currentLogId();
  const [copied, setCopied] = useState(false);
  const text = `KQuiz session ${id}`;

  useEffect(() => {
    // So the log is there by the time Claude asks for it.
    void flushLog(true);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // No clipboard: the id is selectable instead.
      const range = document.createRange();
      const el = document.querySelector(".session-id-code");
      if (el) {
        range.selectNodeContents(el);
        getSelection()?.removeAllRanges();
        getSelection()?.addRange(range);
      }
    }
  }

  if (!id) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet session-id" role="dialog" aria-modal="true" aria-label="Session log" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-header">
          <p className="sheet-title">Session log</p>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <p className="muted session-id-text">Send this id to Claude: it can read what happened in this session, task by task.</p>
        <p className="session-id-code">{id}</p>
        <button type="button" className="button primary" onClick={() => void copy()} autoFocus>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
