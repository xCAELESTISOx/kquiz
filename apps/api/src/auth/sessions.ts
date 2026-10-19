import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNull, lte, notInArray } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Db } from "../db/client.js";
import { authSessions, users } from "../db/schema.js";
import type { User } from "../users.js";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const CSRF_HEADER = "x-csrf-token";
// A few devices per person; older sessions are signed out past this.
export const MAX_SESSIONS = 20;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const randomToken = () => randomBytes(32).toString("base64url");

/** `__Host-` pins the cookie to this exact host over HTTPS; plain http dev can't use the prefix. */
export const cookieName = (secure: boolean) => (secure ? "__Host-kq_session" : "kq_session");

export type Session = {
  tokenHash: string;
  userId: number;
  csrfToken: string;
  credentialId: string | null;
  createdAt: Date;
  expiresAt: Date;
};

export function createSession(c: Context, db: Db, opts: { secure: boolean; userId: number; credentialId: string | null; now: Date }) {
  const token = randomToken();
  const csrfToken = randomToken();
  const expiresAt = new Date(opts.now.getTime() + SESSION_TTL_MS);
  db.delete(authSessions).where(lte(authSessions.expiresAt, opts.now)).run();
  db.insert(authSessions)
    .values({
      tokenHash: hash(token),
      userId: opts.userId,
      csrfToken,
      credentialId: opts.credentialId,
      createdAt: opts.now,
      expiresAt,
      userAgent: c.req.header("user-agent")?.slice(0, 200) ?? null,
    })
    .run();
  const mine = eq(authSessions.userId, opts.userId);
  const keep = db
    .select({ t: authSessions.tokenHash })
    .from(authSessions)
    .where(mine)
    .orderBy(desc(authSessions.createdAt))
    .limit(MAX_SESSIONS);
  db.delete(authSessions).where(and(mine, notInArray(authSessions.tokenHash, keep))).run();
  setCookie(c, cookieName(opts.secure), token, {
    httpOnly: true,
    secure: opts.secure,
    sameSite: "Strict",
    path: "/",
    expires: expiresAt,
  });
  return { csrfToken, expiresAt };
}

/** The session of this request and its user; none when the user was disabled. */
export function readSessionUser(c: Context, db: Db, secure: boolean, now: Date): { session: Session; user: User } | undefined {
  const token = getCookie(c, cookieName(secure));
  if (!token) return undefined;
  const row = db
    .select({ session: authSessions, user: users })
    .from(authSessions)
    .innerJoin(users, eq(users.id, authSessions.userId))
    .where(and(eq(authSessions.tokenHash, hash(token)), isNull(users.disabledAt)))
    .get();
  if (!row || row.session.expiresAt <= now) return undefined;
  return row;
}

export function readSession(c: Context, db: Db, secure: boolean, now: Date): Session | undefined {
  return readSessionUser(c, db, secure, now)?.session;
}

export function endSession(c: Context, db: Db, session: Session, secure: boolean) {
  db.delete(authSessions).where(eq(authSessions.tokenHash, session.tokenHash)).run();
  deleteCookie(c, cookieName(secure), { path: "/", secure });
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function csrfMatches(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type AuthVariables = { session: Session; user: User };

/** Requires a live session, and the session's CSRF token on every request that changes data. */
export function requireSession(db: Db, secure: boolean, now: () => Date): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const found = readSessionUser(c, db, secure, now());
    if (!found) return c.json({ error: "unauthorized" }, 401);
    if (!SAFE_METHODS.has(c.req.method) && !csrfMatches(c.req.header(CSRF_HEADER), found.session.csrfToken)) {
      return c.json({ error: "csrf" }, 403);
    }
    c.set("session", found.session);
    c.set("user", found.user);
    await next();
  };
}
