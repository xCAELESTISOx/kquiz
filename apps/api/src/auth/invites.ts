// One-time invite links: the owner makes one in the app, the friend opens it on their phone and
// binds a passkey, which creates their account. A link works once, for a day, and only while
// there is room for another user.
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, lte } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { invites } from "../db/schema.js";
import { countUsers, MAX_USERS } from "../users.js";

export const INVITE_TTL_MS = 24 * 60 * 60 * 1000;
// Unused links at once; making another drops the oldest.
const MAX_OPEN_INVITES = 3;

const hash = (code: string) => createHash("sha256").update(code).digest("hex");

/** The app's screen that takes the code; a hash route, so the code never reaches a server log. */
export const inviteUrl = (origin: string, code: string) => `${origin}/#/invite/${code}`;

export function createInvite(db: Db, createdBy: number, now: Date): { code: string; expiresAt: Date } {
  const code = randomBytes(18).toString("base64url");
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
  db.transaction((tx) => {
    tx.delete(invites).where(and(isNull(invites.usedAt), lte(invites.expiresAt, now))).run();
    const open = tx
      .select({ codeHash: invites.codeHash })
      .from(invites)
      .where(isNull(invites.usedAt))
      .orderBy(desc(invites.createdAt))
      .all();
    for (const old of open.slice(MAX_OPEN_INVITES - 1)) tx.delete(invites).where(eq(invites.codeHash, old.codeHash)).run();
    tx.insert(invites).values({ codeHash: hash(code), createdBy, createdAt: now, expiresAt }).run();
  });
  return { code, expiresAt };
}

/** Links not yet used or expired, newest first, for the access screen. */
export function openInvites(db: Pick<Db, "select">, now: Date) {
  return db
    .select({ createdAt: invites.createdAt, expiresAt: invites.expiresAt })
    .from(invites)
    .where(and(isNull(invites.usedAt), gt(invites.expiresAt, now)))
    .orderBy(desc(invites.createdAt))
    .all();
}

/** Drops every link not yet used. */
export function cancelInvites(db: Db): number {
  return db.delete(invites).where(isNull(invites.usedAt)).run().changes;
}

export type InviteCheck = "ok" | "invalid" | "full";

export function checkInvite(db: Pick<Db, "select">, code: unknown, now: Date): InviteCheck {
  if (typeof code !== "string" || code.length > 100) return "invalid";
  const row = db
    .select({ codeHash: invites.codeHash })
    .from(invites)
    .where(and(eq(invites.codeHash, hash(code)), isNull(invites.usedAt), gt(invites.expiresAt, now)))
    .get();
  if (!row) return "invalid";
  return countUsers(db) >= MAX_USERS ? "full" : "ok";
}

/** Marks the link used by the new user; false if someone else got there first. */
export function useInvite(db: Pick<Db, "update">, code: string, userId: number, now: Date): boolean {
  return (
    db
      .update(invites)
      .set({ usedAt: now, usedBy: userId })
      .where(and(eq(invites.codeHash, hash(code)), isNull(invites.usedAt), gt(invites.expiresAt, now)))
      .run().changes > 0
  );
}
