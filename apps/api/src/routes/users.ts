import { count, eq, max } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { cancelInvites, createInvite, inviteUrl, openInvites } from "../auth/invites.js";
import type { AuthVariables } from "../auth/sessions.js";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { authSessions, cards, oauthGrants, users } from "../db/schema.js";
import { countUsers, MAX_USERS, MEMBER_LIMITS } from "../users.js";

const idParam = z.coerce.number().int().positive();

/** The owner's access screen: invite people, see who uses the app, switch someone off. */
export function userRoutes(db: Db, config: Config, now: () => Date) {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.use(async (c, next) => {
    if (c.get("user").role !== "owner") return c.json({ error: "forbidden" }, 403);
    await next();
  });

  app.get("/", (c) => {
    const cardCounts = new Map(
      db
        .select({ userId: cards.userId, n: count() })
        .from(cards)
        .groupBy(cards.userId)
        .all()
        .map((r) => [r.userId, r.n]),
    );
    const lastSeen = new Map(
      db
        .select({ userId: authSessions.userId, at: max(authSessions.createdAt) })
        .from(authSessions)
        .groupBy(authSessions.userId)
        .all()
        .map((r) => [r.userId, r.at]),
    );
    return c.json({
      users: db
        .select()
        .from(users)
        .orderBy(users.id)
        .all()
        .map((u) => ({
          id: u.id,
          name: u.name,
          role: u.role,
          createdAt: u.createdAt.toISOString(),
          disabled: u.disabledAt !== null,
          cards: cardCounts.get(u.id) ?? 0,
          lastSignInAt: lastSeen.get(u.id)?.toISOString() ?? null,
        })),
      invites: openInvites(db, now()).map((i) => ({ createdAt: i.createdAt.toISOString(), expiresAt: i.expiresAt.toISOString() })),
      maxUsers: MAX_USERS,
      memberLimits: MEMBER_LIMITS,
    });
  });

  // The link is shown once; only its hash is kept.
  app.post("/invites", (c) => {
    if (countUsers(db) >= MAX_USERS) return c.json({ error: "too_many_users", max: MAX_USERS }, 409);
    const { code, expiresAt } = createInvite(db, c.get("user").id, now());
    return c.json({ url: inviteUrl(config.origin, code), expiresAt: expiresAt.toISOString() }, 201);
  });

  app.delete("/invites", (c) => c.json({ cancelled: cancelInvites(db) }));

  const member = (id: number) => db.select().from(users).where(eq(users.id, id)).get();

  // Signs them out everywhere and cuts off their Claude connector; their data stays.
  app.post("/:id/disable", (c) => {
    const id = idParam.safeParse(c.req.param("id"));
    const user = id.success ? member(id.data) : undefined;
    if (!user) return c.json({ error: "not_found" }, 404);
    if (user.role === "owner") return c.json({ error: "owner" }, 409);
    db.transaction((tx) => {
      tx.update(users).set({ disabledAt: now() }).where(eq(users.id, user.id)).run();
      tx.delete(authSessions).where(eq(authSessions.userId, user.id)).run();
      tx.delete(oauthGrants).where(eq(oauthGrants.userId, user.id)).run();
    });
    return c.json({ ok: true });
  });

  app.post("/:id/enable", (c) => {
    const id = idParam.safeParse(c.req.param("id"));
    const user = id.success ? member(id.data) : undefined;
    if (!user) return c.json({ error: "not_found" }, 404);
    db.update(users).set({ disabledAt: null }).where(eq(users.id, user.id)).run();
    return c.json({ ok: true });
  });

  // Only a disabled member, so a stray tap can't wipe someone who is still learning.
  app.delete("/:id", (c) => {
    const id = idParam.safeParse(c.req.param("id"));
    const user = id.success ? member(id.data) : undefined;
    if (!user) return c.json({ error: "not_found" }, 404);
    if (user.role === "owner" || !user.disabledAt) return c.json({ error: "disable_first" }, 409);
    // Foreign keys cascade from users to everything that is theirs.
    db.delete(users).where(eq(users.id, user.id)).run();
    return c.json({ ok: true });
  });

  return app;
}
