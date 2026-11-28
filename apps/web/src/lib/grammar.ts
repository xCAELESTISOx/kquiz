// Grammar mode, in the app: what a session asks and how each task is built. Forms come from the
// conjugation rules (@kquiz/korean), so any sentence can be asked in any task, and wrong options
// are mistakes a learner really makes (듣어야, 들아야), not stored strings.
import { build, check, conjClass, mistakes, rule, type Final, type Pos } from "@kquiz/korean";

export interface GrammarSlot {
  lemma: string;
  pos: Pos;
  cls?: string;
  pattern: string;
  final: Final;
}

export interface GrammarSentence {
  id: number;
  before: string;
  after: string;
  slot: GrammarSlot | null;
  translation: string;
}

export type GrammarStatus = "pool" | "learning" | "checking" | "learned";

export interface GrammarPoint {
  id: number;
  pattern: string;
  meaning: string;
  goal: "use" | "recognize";
  explanation: string | null;
  trap: string | null;
  tags: string[];
  status: GrammarStatus;
  learnStep: number;
  ladder: number;
  checkAt: string | null;
  due: string | null;
  reps: number;
  lapses: number;
  sentences: GrammarSentence[];
  similar: { id: number; pattern: string; note: string | null }[];
  createdAt: string;
}

export type GrammarTaskKind = "understand" | "choose" | "build" | "type";
export type GrammarPhase = "learn" | "check" | "review" | "fix";
export type Outcome = "right" | "soft" | "wrong";

export interface GrammarTask {
  point: GrammarPoint;
  /** "intro" meets a construction before its ladder. */
  kind: GrammarTaskKind | "intro";
  sentence: GrammarSentence;
  phase: GrammarPhase;
}

/** The ladder, as the server counts it (apps/api grammar.ts LADDER_USE / LADDER_RECOGNIZE). */
export const LADDER: Record<GrammarPoint["goal"], GrammarTaskKind[]> = {
  use: ["understand", "choose", "build", "type"],
  recognize: ["understand", "choose"],
};
/** Constructions on the ladder at once (apps/api ACTIVE_POINTS). */
export const ACTIVE_POINTS = 2;
export const SESSION_TASKS = 15;

const needsSlot = (kind: GrammarTask["kind"]) => kind === "choose" || kind === "build" || kind === "type";

/** The finished form for a slot. */
export function formOf(slot: GrammarSlot) {
  return build({ lemma: slot.lemma, pos: slot.pos, ...(slot.cls ? { cls: slot.cls as never } : {}) }, slot.pattern, slot.final);
}

/** The sentence as text, and the form in it to mark. */
export function sentenceParts(s: GrammarSentence): { before: string; form: string; after: string } {
  return s.slot ? { before: s.before, form: formOf(s.slot).form, after: s.after } : { before: s.before, form: "", after: s.after };
}

export const sentenceText = (s: GrammarSentence) => {
  const p = sentenceParts(s);
  return p.before + p.form + p.after;
};

/** The word's conjugation class, for stats on where the user slips. */
export function classOf(slot: GrammarSlot | null): string | undefined {
  if (!slot || slot.pos === "noun" || slot.pos === "copula") return undefined;
  try {
    return slot.cls ?? conjClass(slot.lemma);
  } catch {
    return undefined;
  }
}

type Random = () => number;

function shuffle<T>(items: T[], random: Random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Points to take from the pool onto the ladder before the session starts. */
export function pointsToStart(points: GrammarPoint[]): GrammarPoint[] {
  const active = points.filter((p) => p.status === "learning").length;
  return points.filter((p) => p.status === "pool").slice(0, Math.max(ACTIVE_POINTS - active, 0));
}

/**
 * A session: checks that are due, reviews that are due, then the constructions on the ladder
 * (each met first, then its tasks from the step it is on), spread so one construction never
 * comes twice in a row when another can go between, and no sentence is used twice.
 */
export function planSession(points: GrammarPoint[], now = new Date(), random: Random = Math.random, limit = SESSION_TASKS): GrammarTask[] {
  const used = new Set<number>();
  const pick = (p: GrammarPoint, kind: GrammarTask["kind"]): GrammarSentence | undefined => {
    const fits = p.sentences.filter((s) => !used.has(s.id) && (!needsSlot(kind) || s.slot));
    const s = fits.length ? fits[Math.floor(random() * fits.length)] : p.sentences.find((x) => !needsSlot(kind) || x.slot);
    if (s) used.add(s.id);
    return s;
  };
  const queues: GrammarTask[][] = [];
  const add = (p: GrammarPoint, kinds: GrammarTask["kind"][], phase: GrammarPhase) => {
    const q: GrammarTask[] = [];
    for (const kind of kinds) {
      const sentence = pick(p, kind);
      if (sentence) q.push({ point: p, kind, sentence, phase });
    }
    if (q.length) queues.push(q);
  };
  const t = now.getTime();
  for (const p of points.filter((x) => x.status === "checking" && x.checkAt && Date.parse(x.checkAt) <= t)) {
    add(p, [p.goal === "use" ? "type" : "understand"], "check");
  }
  const due = points.filter((x) => x.status === "learned" && x.due && Date.parse(x.due) <= t).sort((a, b) => Date.parse(a.due!) - Date.parse(b.due!));
  for (const p of due) {
    const kinds = p.goal === "use" ? (["choose", "type", "build", "understand"] as const) : (["understand", "choose"] as const);
    add(p, [kinds[p.reps % kinds.length]!], "review");
  }
  for (const p of points.filter((x) => x.status === "learning")) {
    const ladder = LADDER[p.goal];
    const rest = ladder.slice(Math.min(p.learnStep, ladder.length));
    add(p, p.learnStep === 0 ? ["intro", ...rest] : rest, "learn");
  }
  // Round robin over the queues, never the same construction twice in a row when it can be helped.
  const out: GrammarTask[] = [];
  let last: number | undefined;
  while (out.length < limit && queues.some((q) => q.length)) {
    const ready = queues.filter((q) => q.length);
    const q = ready.find((x) => x[0]!.point.id !== last) ?? ready[0]!;
    const task = q.shift()!;
    out.push(task);
    last = task.point.id;
    // A finished queue drops out; a queue that went goes to the back.
    queues.splice(queues.indexOf(q), 1);
    if (q.length) queues.push(q);
  }
  return out;
}

/** Options for "pick the form": the right one, likely mistakes, and a neighbouring construction. */
export function chooseOptions(sentence: GrammarSentence, point: GrammarPoint, others: GrammarPoint[], random: Random = Math.random): { form: string; right: boolean; why?: string }[] {
  const slot = sentence.slot!;
  const right = formOf(slot);
  const taken = new Set([right.form, ...right.alts, ...right.spacing]);
  const wrong: { form: string; why?: string }[] = [];
  const word = { lemma: slot.lemma, pos: slot.pos, ...(slot.cls ? { cls: slot.cls as never } : {}) };
  for (const m of mistakes(word, slot.pattern, slot.final)) {
    if (!taken.has(m.form)) wrong.push({ form: m.form, why: m.kind });
    taken.add(m.form);
  }
  // Another construction on the same word: a similar one first, any other if none.
  const similar = new Set(point.similar.map((s) => s.id));
  const neighbours = shuffle(others.filter((o) => o.id !== point.id && o.goal === "use" && o.sentences.some((s) => s.slot && s.slot.pos === slot.pos)), random).sort(
    (a, b) => Number(similar.has(b.id)) - Number(similar.has(a.id)),
  );
  for (const n of neighbours) {
    if (wrong.length >= 4) break;
    try {
      const f = build(word, n.pattern, slot.final).form;
      if (!taken.has(f)) {
        wrong.push({ form: f, why: "other" });
        taken.add(f);
        break;
      }
    } catch {
      // Some constructions don't fit every word; try the next.
    }
  }
  const options = [{ form: right.form, right: true }, ...shuffle(wrong, random).slice(0, 3).map((w) => ({ ...w, right: false }))];
  return shuffle(options, random);
}

/** Meanings for "what does it say": this construction's and two others', similar ones first. */
export function understandOptions(point: GrammarPoint, others: GrammarPoint[], random: Random = Math.random): { meaning: string; right: boolean }[] {
  const similar = new Set(point.similar.map((s) => s.id));
  const pool = shuffle(others.filter((o) => o.id !== point.id && o.meaning !== point.meaning), random).sort((a, b) => Number(similar.has(b.id)) - Number(similar.has(a.id)));
  const meanings = [...new Set(pool.map((o) => o.meaning))].slice(0, 2);
  return shuffle([{ meaning: point.meaning, right: true }, ...meanings.map((m) => ({ meaning: m, right: false }))], random);
}

/** Tiles to build the sentence from: its words in a shuffled bank, plus wrong forms of the slot. */
export function buildTiles(sentence: GrammarSentence, random: Random = Math.random): { answer: string[]; bank: string[] } {
  const answer = sentenceText(sentence).split(/\s+/).filter(Boolean);
  const extra: string[] = [];
  if (sentence.slot) {
    const slot = sentence.slot;
    for (const m of mistakes({ lemma: slot.lemma, pos: slot.pos, ...(slot.cls ? { cls: slot.cls as never } : {}) }, slot.pattern, slot.final)) {
      const words = (sentence.before + m.form + sentence.after).split(/\s+/).filter(Boolean);
      for (const w of words) if (!answer.includes(w) && !extra.includes(w)) extra.push(w);
      if (extra.length >= 2) break;
    }
  }
  return { answer, bank: shuffle([...answer, ...extra.slice(0, 2)], random) };
}

export type TypeResult = "right" | "spacing" | "style" | "wrong";

/** Checks a typed form: right, right but for the spaces, right in another style, or wrong. */
export function checkTyped(answer: string, slot: GrammarSlot): TypeResult {
  const result = check(answer, formOf(slot));
  if (result !== "wrong") return result;
  const style = slot.final.style ?? "formal";
  for (const other of (["formal", "polite", "plain"] as const).filter((s) => s !== style)) {
    if (check(answer, formOf({ ...slot, final: { ...slot.final, style: other } })) !== "wrong") return "style";
  }
  return "wrong";
}

/** One line on what went wrong with a picked or typed form, when it is a known kind of mistake. */
export function whyWrong(slot: GrammarSlot, given: string): string | undefined {
  const word = { lemma: slot.lemma, pos: slot.pos, ...(slot.cls ? { cls: slot.cls as never } : {}) };
  const kind = mistakes(word, slot.pattern, slot.final).find((m) => m.form === given.trim())?.kind;
  const how = rule(word);
  switch (kind) {
    case "irregular":
      return how ? `Irregular. ${how}` : undefined;
    case "not-irregular":
      return `${slot.lemma} is regular: it keeps its stem`;
    case "harmony":
      return "아 after ㅏ and ㅗ, 어 after other vowels";
    case "eu":
      return "After a consonant the ending takes 으";
    case "l":
      return how ?? undefined;
    case "particle":
      return "The particle follows the last sound of the noun: 을/이/은 after a consonant, 를/가/는 after a vowel";
    default:
      return how ?? undefined;
  }
}

/** A few of the point's own words with their forms, for the intro: irregular ones first, then regular. */
export function formationRows(point: GrammarPoint, max = 4): { lemma: string; form: string; rule: string | null }[] {
  const rows: { lemma: string; form: string; rule: string | null; cls: string }[] = [];
  const seen = new Set<string>();
  for (const s of point.sentences) {
    if (!s.slot || seen.has(s.slot.lemma)) continue;
    seen.add(s.slot.lemma);
    const slot = { ...s.slot, pattern: point.pattern, final: { style: "formal" as const } };
    try {
      const cls = classOf(slot) ?? slot.pos;
      const word = { lemma: slot.lemma, pos: slot.pos, ...(slot.cls ? { cls: slot.cls as never } : {}) };
      rows.push({ lemma: slot.lemma, form: formOf(slot).form, rule: slot.pos === "noun" ? null : rule(word), cls });
    } catch {
      // A sentence-specific pattern may not apply to the point's own; skip it.
    }
  }
  // Different classes first, so the table shows what changes and what doesn't.
  const out: typeof rows = [];
  const classes = new Set<string>();
  for (const r of [...rows.filter((r) => r.rule), ...rows.filter((r) => !r.rule)]) {
    if (out.length >= max) break;
    if (!classes.has(r.cls)) {
      classes.add(r.cls);
      out.push(r);
    }
  }
  for (const r of rows) if (out.length < max && !out.includes(r)) out.push(r);
  return out.map(({ lemma, form, rule }) => ({ lemma, form, rule }));
}
