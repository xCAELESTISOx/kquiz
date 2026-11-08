import type { SimilarWord } from "./types";

/**
 * Card notes in a light markup, one point per line. A line opening with a mark goes to that mark's
 * group; any other line is a plain remark. Claude writes notes this way (apps/api/src/mcp/tools.ts),
 * and older notes without marks still read as plain remarks.
 *
 *   ≠ 밑 — прямо под, вплотную      not to mix up with
 *   ↔ 위 — верх                      opposite
 *   ≈ 영화관 — тоже «кинотеатр»       near in meaning, synonyms
 *   + 아래층 — нижний этаж            set expressions and collocations
 *   = «сто товаров»                  literally
 *   ! 안 перед глаголом — «не»       watch out: homonyms, exceptions
 */
export type NoteKind = "similar" | "opposite" | "near" | "phrase" | "literal" | "warn";

export interface NoteItem {
  /** The Korean word or expression the point is about, when it opens with one. */
  head?: string;
  /** What is said about it, or the whole point when there is no head. */
  text: string;
  /** For a similar word linked to this card: its id and meaning. */
  linked?: SimilarWord;
}

export interface NoteGroup {
  kind: NoteKind;
  items: NoteItem[];
}

export interface ParsedNotes {
  remarks: string[];
  groups: NoteGroup[];
}

export const NOTE_MARKS: { mark: string; kind: NoteKind; label: string }[] = [
  { mark: "≠", kind: "similar", label: "Не путать" },
  { mark: "↔", kind: "opposite", label: "Противоположность" },
  { mark: "≈", kind: "near", label: "Близкие по смыслу" },
  { mark: "+", kind: "phrase", label: "Выражения" },
  { mark: "=", kind: "literal", label: "Дословно" },
  { mark: "!", kind: "warn", label: "Внимание" },
];

// Written by hand too: <> and the ASCII arrows for ↔, ~ for ≈, • and - for a list item.
const ALIASES: Record<string, NoteKind> = { "<>": "opposite", "<->": "opposite", "~": "near", "•": "phrase", "-": "phrase", "—": "phrase" };

const ORDER: NoteKind[] = ["similar", "opposite", "near", "phrase", "literal", "warn"];

const HANGUL = /\p{Script=Hangul}/u;
// A Korean head: Hangul words (with the odd ~ or … of a pattern like ~에 있다), then a separator.
const HEAD = /^((?:[~…]?\p{Script=Hangul}[\p{Script=Hangul}~…?!]*)(?:\s+[~…]?\p{Script=Hangul}[\p{Script=Hangul}~…?!]*)*)\s*(?:[—–:.,]\s*|-\s+|$)/u;

function markOf(line: string): { kind: NoteKind; rest: string } | undefined {
  for (const { mark, kind } of NOTE_MARKS) {
    if (line.startsWith(mark)) return { kind, rest: line.slice(mark.length) };
  }
  for (const [alias, kind] of Object.entries(ALIASES).sort((a, b) => b[0].length - a[0].length)) {
    // A list dash needs a space after it, so "-ㄴ/은" or a word with a hyphen stays a remark.
    if (line.startsWith(alias + " ")) return { kind, rest: line.slice(alias.length) };
  }
  return undefined;
}

function itemOf(kind: NoteKind, rest: string): NoteItem {
  const body = rest.trim();
  if (kind !== "literal" && kind !== "warn") {
    const head = HEAD.exec(body);
    if (head) {
      const text = body.slice(head[0].length).trim();
      return { head: head[1], text };
    }
  }
  return { text: body };
}

export function parseNotes(notes: string | null | undefined): ParsedNotes {
  const remarks: string[] = [];
  const byKind = new Map<NoteKind, NoteItem[]>();
  for (const raw of (notes ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const marked = markOf(line);
    if (!marked) {
      remarks.push(line);
      continue;
    }
    const item = itemOf(marked.kind, marked.rest);
    if (!item.head && !item.text) continue;
    byKind.set(marked.kind, [...(byKind.get(marked.kind) ?? []), item]);
  }
  return { remarks, groups: ORDER.filter((k) => byKind.has(k)).map((kind) => ({ kind, items: byKind.get(kind)! })) };
}

/**
 * Notes with the card's linked similar words folded into «Не путать»: a ≠ line about a linked word
 * becomes that word's entry, so the pair is shown once: its meaning, then the line's words or, without
 * a line, the pair's note.
 */
export function cardNotes(notes: string | null | undefined, similar: SimilarWord[] | undefined): ParsedNotes {
  const parsed = parseNotes(notes);
  if (!similar?.length) return parsed;
  const written = parsed.groups.find((g) => g.kind === "similar")?.items ?? [];
  const linked: NoteItem[] = similar.map((word) => {
    // The card's own line says it for this card; the pair's note is the fallback.
    const line = written.find((i) => i.head === word.korean);
    return { head: word.korean, text: line?.text || word.note || "", linked: word };
  });
  const rest = written.filter((i) => !similar.some((w) => w.korean === i.head));
  const groups = parsed.groups.filter((g) => g.kind !== "similar");
  return { remarks: parsed.remarks, groups: [{ kind: "similar", items: [...linked, ...rest] }, ...groups] };
}

export const labelOf = (kind: NoteKind) => NOTE_MARKS.find((m) => m.kind === kind)!.label;
export const markFor = (kind: NoteKind) => NOTE_MARKS.find((m) => m.kind === kind)!.mark;

/** Text split into plain and Korean runs, so the Korean can stand out inside a Russian sentence. */
export function koreanRuns(text: string): { text: string; ko: boolean }[] {
  const runs: { text: string; ko: boolean }[] = [];
  const re = /\p{Script=Hangul}+(?:[ ~…]+\p{Script=Hangul}+)*/gu;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index), ko: false });
    runs.push({ text: m[0], ko: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), ko: false });
  return runs;
}

export const hasHangul = (text: string) => HANGUL.test(text);
