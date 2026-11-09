import { and, desc, eq, notInArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "./db/client.js";
import { sessionLogs } from "./db/schema.js";

/** How many sessions are kept per user; older ones are dropped as new ones come in. */
export const KEEP_LOGS = 50;
/** Tasks kept per session; a session runs to about 40, so this only stops a runaway. */
export const MAX_TASKS = 600;

/** Short, unambiguous when read off a screen or typed: no 0/O, 1/I/L. */
export const LOG_ID = /^[2-9A-HJKMNP-Z]{6}$/;

// The app decides what goes in a task; the server keeps it as it came, within reason.
const loose = z.record(z.string(), z.unknown());

export const sessionLogSchema = z.object({
  startedAt: z.iso.datetime(),
  screen: z.string().max(40),
  client: z.string().max(300).optional(),
  tasks: z.array(loose).max(MAX_TASKS),
  events: z.array(loose).max(MAX_TASKS),
});

export type SessionLogInput = z.infer<typeof sessionLogSchema>;

export interface SessionLog extends SessionLogInput {
  id: string;
  updatedAt: string;
}

/**
 * Saves the whole log of a session, as it stands so far (the app sends it again as it grows).
 * False when the id is already someone else's.
 */
export function saveSessionLog(db: Db, userId: number, id: string, log: SessionLogInput, now: Date): boolean {
  return db.transaction((tx) => {
    const existing = tx.select({ userId: sessionLogs.userId }).from(sessionLogs).where(eq(sessionLogs.id, id)).get();
    if (existing && existing.userId !== userId) return false;
    const row = { startedAt: new Date(log.startedAt), updatedAt: now, data: log as unknown as Record<string, unknown> };
    tx.insert(sessionLogs)
      .values({ id, userId, ...row })
      .onConflictDoUpdate({ target: sessionLogs.id, set: row })
      .run();
    const keep = tx
      .select({ id: sessionLogs.id })
      .from(sessionLogs)
      .where(eq(sessionLogs.userId, userId))
      .orderBy(desc(sessionLogs.startedAt))
      .limit(KEEP_LOGS)
      .all()
      .map((r) => r.id);
    tx.delete(sessionLogs)
      .where(and(eq(sessionLogs.userId, userId), notInArray(sessionLogs.id, keep)))
      .run();
    return true;
  });
}

/** One of the user's sessions by its id, or their latest ones (`back` skips the most recent few). */
export function sessionLog(db: Db, userId: number, id: string): SessionLog | undefined {
  const row = db
    .select()
    .from(sessionLogs)
    .where(and(eq(sessionLogs.userId, userId), eq(sessionLogs.id, id.trim().toUpperCase())))
    .get();
  return row && toLog(row);
}

export function recentSessionLogs(db: Db, userId: number, limit: number, back = 0): SessionLog[] {
  return db
    .select()
    .from(sessionLogs)
    .where(eq(sessionLogs.userId, userId))
    .orderBy(desc(sessionLogs.startedAt))
    .limit(limit)
    .offset(back)
    .all()
    .map(toLog);
}

/** Session ids with their start and size, newest first, for picking one. */
export function listSessionLogs(db: Db, userId: number, limit: number) {
  return recentSessionLogs(db, userId, limit).map(({ id, startedAt, updatedAt, screen, tasks }) => ({
    id,
    startedAt,
    updatedAt,
    screen,
    tasks: tasks.length,
    mistakes: tasks.filter((t) => t.result === "wrong").length,
  }));
}

function toLog(row: typeof sessionLogs.$inferSelect): SessionLog {
  const data = row.data as unknown as SessionLogInput;
  return { id: row.id, ...data, startedAt: row.startedAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

