import { request } from "./api";
import type { QueueItem } from "./types";

/**
 * A log of what a session showed and what was answered, task by task, kept on the server so
 * Claude can read it (MCP get_session_log) when something in a session went wrong. Nothing of it
 * is shown in the app: a long press on the progress bar or the summary heading copies the
 * session's short id to paste to Claude.
 *
 * The screen running the session opens a log, says which task is on screen (`logShown`) and how it
 * ended (`logOutcome`); the cards themselves add what was given (`logAnswer`), since only they see it.
 * Cards used outside a session log nothing.
 */

export interface LoggedAnswer {
  /** What the user typed, picked, built or said; "" for "Don't know". */
  given?: string;
  expected?: string;
  options?: string[];
  ok?: boolean;
  /** Speech: the scorer's score and what it heard wrong. */
  score?: number;
  heard?: string;
  note?: string;
}

interface Task {
  n: number;
  at: string;
  phase: "main" | "fix";
  card: { id: number; korean: string; meaning: string };
  mode: string;
  task: string;
  learn?: string;
  prompt?: string;
  answers: LoggedAnswer[];
  result?: "right" | "wrong" | "skipped";
  rating?: string;
  ms?: number;
  server?: string;
}

interface Log {
  id: string;
  startedAt: string;
  screen: string;
  client: string;
  tasks: Task[];
  events: Record<string, unknown>[];
}

// No 0/O or 1/I/L, so it reads and types back without doubt (the server checks the same set).
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const SAVE_AFTER_MS = 1500;
const MAX_TASKS = 600;

let log: Log | undefined;
let current: { task: Task; key: number; shownAt: number } | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}

/** A new session log; returns its id. */
export function startLog(screen: string): string {
  void flushLog();
  log = { id: newId(), startedAt: new Date().toISOString(), screen, client: navigator.userAgent.slice(0, 300), tasks: [], events: [] };
  current = undefined;
  logEvent("start");
  return log.id;
}

/** The session's screen is gone: what is left goes out. */
export function endLog(): void {
  if (!log) return;
  if (current && !current.task.result) logOutcome({ result: "skipped", note: "on screen when the session was left" });
  logEvent("left");
  void flushLog();
  log = undefined;
  current = undefined;
}

export const currentLogId = (): string | undefined => log?.id;

/**
 * A task is on screen: how it is asked (`task`), from which item. `key` tells one showing from the
 * next (the screen's step), so the same showing told twice is one task.
 */
export function logShown(key: number, item: QueueItem, task: string, phase: "main" | "fix", prompt?: string): void {
  if (!log || current?.key === key) return;
  if (current && !current.task.result) logOutcome({ result: "skipped", note: "left without an answer" });
  const entry: Task = {
    n: log.tasks.length + 1,
    at: new Date().toISOString(),
    phase,
    card: { id: item.card.id, korean: item.card.korean, meaning: item.card.meaning },
    mode: item.mode,
    task,
    ...(item.learn ? { learn: item.learn.check ? "check" : item.learn.kind } : {}),
    ...(prompt ? { prompt } : {}),
    answers: [],
  };
  if (log.tasks.length < MAX_TASKS) log.tasks.push(entry);
  current = { task: entry, key, shownAt: performance.now() };
}

/** What the user gave on the task on screen; each try adds one. */
export function logAnswer(answer: LoggedAnswer): void {
  if (!log || !current) return;
  current.task.answers.push(Object.fromEntries(Object.entries(answer).filter(([, v]) => v !== undefined)));
}

/** How the task on screen ended; returns its number, for what the server says about it later. */
export function logOutcome(outcome: { result?: Task["result"]; ok?: boolean; rating?: string; note?: string }): number | undefined {
  if (!log || !current) return undefined;
  const { task } = current;
  task.result = outcome.result ?? (outcome.ok === false || outcome.rating === "again" ? "wrong" : "right");
  if (outcome.rating) task.rating = outcome.rating;
  if (outcome.note) task.answers.push({ note: outcome.note });
  task.ms = Math.round(performance.now() - current.shownAt);
  save();
  return task.n;
}

/** Where a new word stands after the answer to task `n`, as the server said. */
export function logServer(n: number | undefined, status: string): void {
  const task = n === undefined ? undefined : log?.tasks[n - 1];
  if (!task) return;
  task.server = task.server ? `${task.server}, ${status}` : status;
  save();
}

export function logEvent(what: string, detail?: Record<string, unknown>): void {
  if (!log) return;
  if (log.events.length < MAX_TASKS) log.events.push({ at: new Date().toISOString(), what, ...(detail ?? {}) });
  save();
}

function save(): void {
  clearTimeout(timer);
  timer = setTimeout(() => void flushLog(), SAVE_AFTER_MS);
}

/**
 * Sends the log as it stands now; a failure is let go, the next save sends it all again. A session
 * left before its first answer isn't kept, unless its id was just copied (`force`).
 */
export async function flushLog(force = false): Promise<void> {
  clearTimeout(timer);
  timer = undefined;
  if (!log || (!force && !log.tasks.some((t) => t.result))) return;
  const { id, ...body } = log;
  await request("PUT", `/session-logs/${id}`, { body, resend: true, fallback: () => ({ ok: true }) }).catch(() => undefined);
}

// Leaving the app is often the end of a session: what it has goes out before iOS freezes the page.
if (typeof document !== "undefined")
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && timer) void flushLog();
  });
