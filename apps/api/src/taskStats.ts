import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { cards, sessionLogs, taskAnswers } from "./db/schema.js";

const DAY = 86_400_000;
/** Skills are judged on this many recent days; the trend compares the last week with the rest of them. */
export const SKILL_DAYS = 30;
export const SKILL_TREND_DAYS = 7;
/** Words missed most often over this many days. */
export const TROUBLE_DAYS = 60;
export const TROUBLE_WORDS = 10;

/**
 * What each way of asking (a session log's `task`) trains. Picking the word is picking, whether it
 * is a new word's step or stands in for saying it aloud; recalling it through an example is recall.
 * Meeting a new word (intro) asks nothing, and a task not named here is left out.
 */
export const SKILL_OF: Record<string, Skill> = {
  recall: "recall",
  cloze: "recall",
  choose: "choose",
  choice: "choose",
  build: "build",
  write: "write",
  dictation: "dictation",
  say: "speak",
  aloud: "speak",
  listen: "listen",
};
export const SKILLS = ["recall", "choose", "build", "write", "dictation", "speak", "listen"] as const;
export type Skill = (typeof SKILLS)[number];

type Tally = { answers: number; missed: number };

export type TaskStats = {
  /** First-try results per skill over SKILL_DAYS, and over the last SKILL_TREND_DAYS of them. */
  skills: { skill: Skill; answers: number; missed: number; recent: Tally }[];
  /** The words missed most often over TROUBLE_DAYS, worst first, with the skills they were missed in. */
  trouble: { card: { id: number; korean: string; meaning: string }; answers: number; missed: number; skills: Skill[] }[];
};

type LoggedTask = {
  n?: unknown;
  at?: unknown;
  phase?: unknown;
  card?: { id?: unknown };
  task?: unknown;
  result?: unknown;
  answers?: unknown;
};

/**
 * The answered tasks of one session log, as rows for `task_answers`. Going over mistakes at the end
 * is practice on what was just shown, so it doesn't count; neither does a task left unanswered.
 * A task is missed when it ended wrong or its first try was wrong ("After a try" still counts).
 */
export function answeredTasks(tasks: unknown[]): { n: number; cardId: number; task: string; missed: boolean; answeredAt: Date }[] {
  return tasks.flatMap((raw) => {
    const t = raw as LoggedTask;
    if (t.phase !== "main" || (t.result !== "right" && t.result !== "wrong")) return [];
    if (typeof t.task !== "string" || !(t.task in SKILL_OF)) return [];
    const n = t.n, cardId = t.card?.id, at = typeof t.at === "string" ? new Date(t.at) : undefined;
    if (!Number.isInteger(n) || !Number.isInteger(cardId) || !at || Number.isNaN(at.getTime())) return [];
    const answers = Array.isArray(t.answers) ? (t.answers as { ok?: unknown }[]) : [];
    const firstTry = answers.find((a) => typeof a?.ok === "boolean");
    const missed = t.result === "wrong" || firstTry?.ok === false;
    return [{ n: n as number, cardId: cardId as number, task: t.task, missed, answeredAt: at }];
  });
}

/** Puts a session log's answers in `task_answers`, replacing what an earlier save of it put there. */
export function indexSessionTasks(db: Pick<Db, "select" | "insert" | "delete">, userId: number, logId: string, tasks: unknown[]): void {
  db.delete(taskAnswers).where(eq(taskAnswers.logId, logId)).run();
  const rows = answeredTasks(tasks);
  if (!rows.length) return;
  // A card deleted since, or not the user's, has nothing to show.
  const own = new Set(
    db
      .select({ id: cards.id })
      .from(cards)
      .where(and(eq(cards.userId, userId), inArray(cards.id, [...new Set(rows.map((r) => r.cardId))])))
      .all()
      .map((r) => r.id),
  );
  const values = rows.filter((r) => own.has(r.cardId)).map((r) => ({ ...r, logId, userId }));
  for (let i = 0; i < values.length; i += 200) db.insert(taskAnswers).values(values.slice(i, i + 200)).run();
}

/** Once, when `task_answers` is new: the sessions logged before it fill it in. */
export function backfillTaskAnswers(db: Db): number {
  if (db.select({ n: sql<number>`count(*)` }).from(taskAnswers).get()!.n > 0) return 0;
  const logs = db.select().from(sessionLogs).all();
  db.transaction((tx) => {
    for (const log of logs) indexSessionTasks(tx, log.userId, log.id, (log.data as { tasks?: unknown[] }).tasks ?? []);
  });
  return logs.length;
}

export function taskStats(db: Db, userId: number, now: Date): TaskStats {
  const since = new Date(now.getTime() - SKILL_DAYS * DAY);
  const recentFrom = now.getTime() - SKILL_TREND_DAYS * DAY;
  const missedCount = sql<number>`sum(${taskAnswers.missed})`;
  const rows = db
    .select({
      task: taskAnswers.task,
      recent: sql<number>`${taskAnswers.answeredAt} >= ${recentFrom}`,
      answers: sql<number>`count(*)`,
      missed: missedCount,
    })
    .from(taskAnswers)
    .where(and(eq(taskAnswers.userId, userId), gte(taskAnswers.answeredAt, since)))
    .groupBy(taskAnswers.task, sql`2`)
    .all();
  const bySkill = new Map<Skill, { answers: number; missed: number; recent: Tally }>();
  for (const row of rows) {
    const skill = SKILL_OF[row.task];
    if (!skill) continue;
    const entry = bySkill.get(skill) ?? { answers: 0, missed: 0, recent: { answers: 0, missed: 0 } };
    entry.answers += row.answers;
    entry.missed += row.missed;
    if (row.recent) {
      entry.recent.answers += row.answers;
      entry.recent.missed += row.missed;
    }
    bySkill.set(skill, entry);
  }
  const skills = SKILLS.flatMap((skill) => {
    const entry = bySkill.get(skill);
    return entry ? [{ skill, ...entry }] : [];
  });

  const words = db
    .select({
      id: cards.id,
      korean: cards.korean,
      meaning: cards.meaning,
      answers: sql<number>`count(*)`,
      missed: missedCount,
      tasks: sql<string>`group_concat(case when ${taskAnswers.missed} then ${taskAnswers.task} end)`,
    })
    .from(taskAnswers)
    .innerJoin(cards, eq(cards.id, taskAnswers.cardId))
    .where(
      and(
        eq(taskAnswers.userId, userId),
        eq(cards.suspended, false),
        gte(taskAnswers.answeredAt, new Date(now.getTime() - TROUBLE_DAYS * DAY)),
      ),
    )
    .groupBy(cards.id)
    .having(sql`${missedCount} > 0`)
    .orderBy(desc(missedCount), sql`1.0 * ${missedCount} / count(*) desc`, sql`max(case when ${taskAnswers.missed} then ${taskAnswers.answeredAt} end) desc`)
    .limit(TROUBLE_WORDS)
    .all();
  const trouble = words.map((w) => {
    const missedIn = new Set((w.tasks ?? "").split(",").map((t) => SKILL_OF[t]));
    return {
      card: { id: w.id, korean: w.korean, meaning: w.meaning },
      answers: w.answers,
      missed: w.missed,
      skills: SKILLS.filter((s) => missedIn.has(s)),
    };
  });
  return { skills, trouble };
}
