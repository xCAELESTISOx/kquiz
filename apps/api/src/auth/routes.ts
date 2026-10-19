import { randomBytes, timingSafeEqual } from "node:crypto";
import * as simpleWebAuthn from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
  WebAuthnCredential,
} from "@simplewebauthn/server";
import { and, count, desc, eq, gt, lte, notInArray } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { authChallenges, authCredentials, authSessions, users } from "../db/schema.js";
import { clientIp, limits, rateLimit } from "../security/rateLimit.js";
import { activeUser, getUser, OWNER_ID, type User } from "../users.js";
import { checkInvite, useInvite } from "./invites.js";
import {
  createSession,
  CSRF_HEADER,
  csrfMatches,
  endSession,
  readSessionUser,
  requireSession,
  type AuthVariables,
} from "./sessions.js";

/** The parts of @simplewebauthn/server we use; swapped for fakes in tests. */
export type WebAuthn = Pick<
  typeof simpleWebAuthn,
  | "generateRegistrationOptions"
  | "verifyRegistrationResponse"
  | "generateAuthenticationOptions"
  | "verifyAuthenticationResponse"
>;

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
// Bounds the table even if someone requests options in a loop.
const MAX_CHALLENGES = 20;

export type AuthDeps = {
  db: Db;
  config: Config;
  setupCode: string | undefined;
  webauthn?: WebAuthn;
  now?: () => Date;
};

const responseSchema = z.object({ id: z.string().min(1).max(1024), response: z.object({ clientDataJSON: z.string().max(4096) }).loose() }).loose();

export function authRoutes({ db, config, setupCode, webauthn = simpleWebAuthn, now = () => new Date() }: AuthDeps) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const secure = config.secureCookies;

  // Per client, and a global ceiling: a few people never need more, and a botnet can't spread out.
  const clock = () => now().getTime();
  const perClient = rateLimit({ ...limits.login, key: (c) => clientIp(c), now: clock });
  const overall = rateLimit({ limit: 30, windowMs: 60_000, key: () => "all", now: clock });
  for (const path of ["/login/*", "/register/*"]) app.use(path, perClient, overall);

  const hasCredentials = () => (db.select({ n: count() }).from(authCredentials).get()?.n ?? 0) > 0;

  const setupCodeValid = (given: unknown) => {
    if (!setupCode || typeof given !== "string" || hasCredentials()) return false;
    const a = Buffer.from(given);
    const b = Buffer.from(setupCode);
    return a.length === b.length && timingSafeEqual(a, b);
  };

  const storeChallenge = (challenge: string, kind: "register" | "login", userHandle: string | null = null) => {
    const t = now();
    db.delete(authChallenges).where(lte(authChallenges.expiresAt, t)).run();
    db.insert(authChallenges)
      .values({ id: randomBytes(16).toString("hex"), challenge, kind, userHandle, expiresAt: new Date(t.getTime() + CHALLENGE_TTL_MS) })
      .run();
    const total = db.select({ n: count() }).from(authChallenges).get()?.n ?? 0;
    if (total > MAX_CHALLENGES) {
      const newest = db
        .select({ id: authChallenges.id })
        .from(authChallenges)
        .orderBy(desc(authChallenges.expiresAt))
        .limit(MAX_CHALLENGES);
      db.delete(authChallenges).where(notInArray(authChallenges.id, newest)).run();
    }
  };

  /** Takes the challenge the browser signed out of the store: each one works once. */
  const consumeChallenge = (clientDataJSON: string, kind: "register" | "login") => {
    let challenge: unknown;
    try {
      challenge = JSON.parse(Buffer.from(clientDataJSON, "base64url").toString("utf8")).challenge;
    } catch {
      return undefined;
    }
    if (typeof challenge !== "string") return undefined;
    const where = and(eq(authChallenges.challenge, challenge), eq(authChallenges.kind, kind), gt(authChallenges.expiresAt, now()));
    const row = db.select().from(authChallenges).where(where).get();
    if (!row) return undefined;
    db.delete(authChallenges).where(eq(authChallenges.id, row.id)).run();
    return row;
  };

  const loadCredentials = (userId: number) => db.select().from(authCredentials).where(eq(authCredentials.userId, userId)).all();

  app.get("/status", (c) => {
    const found = readSessionUser(c, db, secure, now());
    return c.json({
      authenticated: Boolean(found),
      setupRequired: !hasCredentials(),
      ...(found
        ? { csrfToken: found.session.csrfToken, user: { id: found.user.id, name: found.user.name, role: found.user.role } }
        : {}),
    });
  });

  // Whether an invite link still works, so the invite screen can say so before asking for a passkey.
  app.get("/invite", (c) => c.json({ status: checkInvite(db, c.req.query("code"), now()) }));

  // Registration: the owner's first passkey needs the one-time setup code, a new member an invite
  // code, and another passkey for someone already in an open session.
  const registerBody = z.object({
    setupCode: z.string().max(200).optional(),
    invite: z.string().max(100).optional(),
    // The new member's name, shown in the passkey prompt and on the owner's access screen.
    userName: z.string().trim().min(1).max(40).optional(),
  });

  type Registrant =
    | { kind: "session"; user: User }
    | { kind: "setup"; user: User }
    | { kind: "invite"; code: string; userName: string };

  const registrant = (c: Context, body: z.infer<typeof registerBody>): Registrant | undefined => {
    // An invite wins over an open session: the friend may open the link on a phone someone is signed in on.
    if (body.invite !== undefined) {
      return body.userName && checkInvite(db, body.invite, now()) === "ok"
        ? { kind: "invite", code: body.invite, userName: body.userName }
        : undefined;
    }
    const found = readSessionUser(c, db, secure, now());
    if (found) {
      return csrfMatches(c.req.header(CSRF_HEADER), found.session.csrfToken) ? { kind: "session", user: found.user } : undefined;
    }
    const owner = getUser(db, OWNER_ID);
    return owner && setupCodeValid(body.setupCode) ? { kind: "setup", user: owner } : undefined;
  };

  app.post("/register/options", async (c) => {
    const body = registerBody.safeParse(await c.req.json().catch(() => ({})));
    const who = body.success ? registrant(c, body.data) : undefined;
    if (!who) return c.json({ error: "forbidden" }, 403);
    // A new member gets their handle now; verify stores the same one with the account.
    const handle = who.kind === "invite" ? randomBytes(16).toString("base64url") : who.user.webauthnId;
    const options = await webauthn.generateRegistrationOptions({
      rpName: config.rpName,
      rpID: config.rpId,
      userName: who.kind === "invite" ? who.userName : who.user.role === "owner" ? "owner" : who.user.name,
      userDisplayName: who.kind === "invite" ? `KQuiz · ${who.userName}` : "KQuiz",
      userID: Buffer.from(handle, "base64url"),
      attestationType: "none",
      excludeCredentials:
        who.kind === "invite"
          ? []
          : loadCredentials(who.user.id).map((cred) => ({ id: cred.id, transports: cred.transports ?? undefined })),
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    });
    storeChallenge(options.challenge, "register", handle);
    return c.json(options);
  });

  app.post("/register/verify", async (c) => {
    const raw = await c.req.json().catch(() => null);
    const body = registerBody
      .extend({ name: z.string().trim().max(60).optional(), response: responseSchema })
      .safeParse(raw);
    if (!body.success) return c.json({ error: "invalid_request" }, 400);
    const allowed = registrant(c, body.data);
    if (!allowed) return c.json({ error: "forbidden" }, 403);
    const response = body.data.response as unknown as RegistrationResponseJSON;
    const stored = consumeChallenge(response.response.clientDataJSON, "register");
    if (!stored) return c.json({ error: "challenge_expired" }, 400);
    const challenge = stored.challenge;

    const result = await webauthn
      .verifyRegistrationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: config.origin,
        expectedRPID: config.rpId,
        requireUserVerification: true,
      })
      .catch(() => ({ verified: false as const }));
    if (!result.verified) return c.json({ error: "verification_failed" }, 400);
    // Re-check: a second setup attempt could have finished while this one was verifying.
    if (allowed.kind === "setup" && hasCredentials()) return c.json({ error: "forbidden" }, 403);

    const { credential, credentialDeviceType, credentialBackedUp } = result.registrationInfo;
    const t = now();
    const userId = (() => {
      if (allowed.kind !== "invite") return allowed.user.id;
      // Checked again with the account made in one transaction: the link may have been used meanwhile.
      const handle = stored.userHandle;
      if (!handle) return undefined;
      return db.transaction((tx) => {
        if (checkInvite(tx, allowed.code, t) !== "ok") return undefined;
        const user = tx
          .insert(users)
          .values({ name: allowed.userName, role: "member", webauthnId: handle, createdAt: t })
          .returning({ id: users.id })
          .get();
        useInvite(tx, allowed.code, user.id, t);
        return user.id;
      });
    })();
    if (userId === undefined) return c.json({ error: "forbidden" }, 403);
    db.insert(authCredentials)
      .values({
        id: credential.id,
        userId,
        publicKey: Buffer.from(credential.publicKey).toString("base64url"),
        counter: credential.counter,
        transports: credential.transports ?? null,
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        name: body.data.name || null,
        createdAt: t,
      })
      .onConflictDoNothing()
      .run();
    if (allowed.kind === "session") return c.json({ ok: true });
    const { csrfToken } = createSession(c, db, { secure, userId, credentialId: credential.id, now: t });
    return c.json({ ok: true, csrfToken });
  });

  app.post("/login/options", async (c) => {
    if (!hasCredentials()) return c.json({ error: "setup_required" }, 409);
    // No credential list: passkeys are discoverable, the phone offers its own, and the list
    // would tell anyone who asks which accounts exist.
    const options = await webauthn.generateAuthenticationOptions({
      rpID: config.rpId,
      userVerification: "required",
    });
    storeChallenge(options.challenge, "login");
    return c.json(options);
  });

  app.post("/login/verify", async (c) => {
    const body = z.object({ response: responseSchema }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_request" }, 400);
    const response = body.data.response as unknown as AuthenticationResponseJSON;
    const challenge = consumeChallenge(response.response.clientDataJSON, "login")?.challenge;
    if (!challenge) return c.json({ error: "challenge_expired" }, 400);
    const stored = db.select().from(authCredentials).where(eq(authCredentials.id, response.id)).get();
    // A disabled member's passkey still verifies, but opens nothing.
    if (!stored || !activeUser(db, stored.userId)) return c.json({ error: "verification_failed" }, 400);

    const credential: WebAuthnCredential = {
      id: stored.id,
      publicKey: new Uint8Array(Buffer.from(stored.publicKey, "base64url")),
      counter: stored.counter,
      transports: stored.transports ?? undefined,
    };
    const result = await webauthn
      .verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: config.origin,
        expectedRPID: config.rpId,
        credential,
        requireUserVerification: true,
      })
      .catch(() => undefined);
    if (!result?.verified) return c.json({ error: "verification_failed" }, 400);

    const t = now();
    db.update(authCredentials)
      .set({ counter: result.authenticationInfo.newCounter, lastUsedAt: t })
      .where(eq(authCredentials.id, stored.id))
      .run();
    const { csrfToken } = createSession(c, db, { secure, userId: stored.userId, credentialId: stored.id, now: t });
    return c.json({ ok: true, csrfToken });
  });

  const authed = new Hono<{ Variables: AuthVariables }>();
  authed.use(requireSession(db, secure, now));

  authed.post("/logout", (c) => {
    endSession(c, db, c.get("session"), secure);
    return c.json({ ok: true });
  });

  authed.get("/passkeys", (c) =>
    c.json({
      passkeys: loadCredentials(c.get("user").id).map((cred) => ({
        id: cred.id,
        name: cred.name,
        createdAt: cred.createdAt.toISOString(),
        lastUsedAt: cred.lastUsedAt?.toISOString() ?? null,
      })),
    }),
  );

  // For a lost phone. The last passkey stays, otherwise its owner is locked out for good.
  authed.delete("/passkeys/:id", (c) => {
    const id = c.req.param("id");
    const creds = loadCredentials(c.get("user").id);
    if (!creds.some((cred) => cred.id === id)) return c.json({ error: "not_found" }, 404);
    if (creds.length === 1) return c.json({ error: "last_passkey" }, 409);
    db.delete(authCredentials).where(eq(authCredentials.id, id)).run();
    db.delete(authSessions).where(eq(authSessions.credentialId, id)).run();
    return c.json({ ok: true });
  });

  app.route("/", authed);
  return app;
}
