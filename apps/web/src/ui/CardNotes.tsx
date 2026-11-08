import { cardNotes, koreanRuns, labelOf, markFor, NOTE_MARKS, type NoteKind } from "../lib/notes";
import type { Card } from "../lib/types";
import "./notes.css";

/** Russian with its Korean words standing out. */
export function RichText({ text }: { text: string }) {
  return (
    <>
      {koreanRuns(text).map((run, i) =>
        run.ko ? (
          <span key={i} lang="ko" className="notes-ko">
            {run.text}
          </span>
        ) : (
          run.text
        ),
      )}
    </>
  );
}

const TONE: Record<NoteKind, string> = {
  similar: "notes-tone-similar",
  opposite: "notes-tone-opposite",
  near: "notes-tone-near",
  phrase: "notes-tone-phrase",
  literal: "notes-tone-literal",
  warn: "notes-tone-warn",
};

/**
 * A card's notes laid out by what they are: a plain remark first, then the words not to mix it up
 * with (the linked similar words among them), its opposite, near words, expressions, the literal
 * meaning and what to watch out for. The markup is in lib/notes.ts.
 */
export function CardNotes({ card }: { card: Pick<Card, "notes" | "similar"> }) {
  const { remarks, groups } = cardNotes(card.notes, card.similar);
  if (!remarks.length && !groups.length) return null;
  return (
    <section className="notes" aria-label="Notes">
      {remarks.length > 0 && (
        <div className="notes-remarks">
          {remarks.map((remark, i) => (
            <p key={i} className="notes-remark">
              <RichText text={remark} />
            </p>
          ))}
        </div>
      )}
      {groups.map((group) => (
        <div key={group.kind} className={`notes-group ${TONE[group.kind]}`}>
          <p className="notes-label">
            <span className="notes-mark" aria-hidden="true">
              {markFor(group.kind)}
            </span>
            {labelOf(group.kind)}
          </p>
          <ul className="notes-items">
            {group.items.map((item, i) => (
              <li key={i} className="notes-item">
                {item.head && (
                  <span lang="ko" className="notes-head">
                    {item.head}
                  </span>
                )}
                {item.linked && <span className="notes-meaning">{item.linked.meaning}</span>}
                {item.text && (
                  <span className={item.linked || !item.head ? "notes-text notes-text-block" : "notes-text"}>
                    <RichText text={item.text} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/** The notes field of the add and card screens: the marks to start a line with, and how it will look. */
export function NotesField({
  label,
  value,
  onChange,
  similar,
  marks = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  similar?: Card["similar"];
  marks?: boolean;
}) {
  const parsed = cardNotes(value, similar);
  const structured = parsed.groups.length > 0;
  return (
    <div className="notes-field">
      <label className="field">
        <span className="field-label">{label}</span>
        <textarea className="input textarea" rows={structured ? 5 : 2} value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
      {marks && (
        <p className="notes-legend muted small" aria-label="Marks at the start of a line">
          {NOTE_MARKS.map((m) => (
            <span key={m.mark} className={`notes-legend-item ${TONE[m.kind]}`}>
              <span className="notes-mark" aria-hidden="true">
                {m.mark}
              </span>
              {m.label.toLowerCase()}
            </span>
          ))}
        </p>
      )}
      {marks && structured && <CardNotes card={{ notes: value, similar }} />}
    </div>
  );
}
