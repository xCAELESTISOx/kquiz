import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { desc, eq, lte, notInArray } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Db } from "../db/client.js";
import { authSessions } from "../db/schema.js";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const CSRF_HEADER = "x-csrf-token";
// One owner with a few devices; older sessions are signed out past this.
export const MAX_SESSIONS = 20;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const randomToken = () => randomBytes(32).toString("base64url");

/** `__Host-` pins the cookie to this exact host over HTTPS; plain http dev can't use the prefix. */
export const cookieName = (secure: boolean) => (secure ? "__Host-kq_session" : "kq_session");

export type Session = { tokenHash: string; csrfToken: string; credentialId: string | null; createdAt: Date; expiresAt: Date };

export function createSession(c: Context, db: Db, opts: { secure: boolean; credentialId: string | null; now: Date }) {
  const token = randomToken();
  const csrfToken = randomToken();
  const expiresAt = new Date(opts.now.getTime() + SESSION_TTL_MS);
  db.delete(authSessions).where(lte(authSessions.expiresAt, opts.now)).run();
  db.insert(authSessions)
    .values({
      tokenHash: hash(token),
      csrfToken,
      credentialId: opts.credentialId,
      createdAt: opts.now,
      expiresAt,
      userAgent: c.req.header("user-agent")?.slice(0, 200) ?? null,
    })
    .run();
  const keep = db.select({ t: authSessions.tokenHash }).from(authSessions).orderBy(desc(authSessions.createdAt)).limit(MAX_SESSIONS);
  db.delete(authSessions).where(notInArray(authSessions.tokenHash, keep)).run();
  setCookie(c, cookieName(opts.secure), token, {
    httpOnly: true,
    secure: opts.secure,
    sameSite: "Strict",
    path: "/",
    expires: expiresAt,
  });
  return { csrfToken, expiresAt };
}

export function readSession(c: Context, db: Db, secure: boolean, now: Date): Session | undefined {
  const token = getCookie(c, cookieName(secure));
  if (!token) return undefined;
  const row = db.select().from(authSessions).where(eq(authSessions.tokenHash, hash(token))).get();
  if (!row || row.expiresAt <= now) return undefined;
  return row;
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

export type AuthVariables = { session: Session };

/** Requires a live session, and the session's CSRF token on every request that changes data. */
export function requireSession(db: Db, secure: boolean, now: () => Date): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const session = readSession(c, db, secure, now());
    if (!session) return c.json({ error: "unauthorized" }, 401);
    if (!SAFE_METHODS.has(c.req.method) && !csrfMatches(c.req.header(CSRF_HEADER), session.csrfToken)) {
      return c.json({ error: "csrf" }, 403);
    }
    c.set("session", session);
    await next();
  };
}
