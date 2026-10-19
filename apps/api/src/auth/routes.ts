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
import { authChallenges, authCredentials, authSessions } from "../db/schema.js";
import { clientIp, limits, rateLimit } from "../security/rateLimit.js";
import {
  createSession,
  CSRF_HEADER,
  csrfMatches,
  endSession,
  readSession,
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
// The only user. WebAuthn needs a stable user handle, not a real account.
const OWNER_ID = new TextEncoder().encode("kquiz-owner");

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

  // Per client, and a global ceiling: one owner never needs more, and a botnet can't spread out.
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

  const storeChallenge = (challenge: string, kind: "register" | "login") => {
    const t = now();
    db.delete(authChallenges).where(lte(authChallenges.expiresAt, t)).run();
    db.insert(authChallenges)
      .values({ id: randomBytes(16).toString("hex"), challenge, kind, expiresAt: new Date(t.getTime() + CHALLENGE_TTL_MS) })
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
  const consumeChallenge = (clientDataJSON: string, kind: "register" | "login"): string | undefined => {
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
    return row.challenge;
  };

  const loadCredentials = () => db.select().from(authCredentials).all();

  app.get("/status", (c) => {
    const session = readSession(c, db, secure, now());
    return c.json({
      authenticated: Boolean(session),
      setupRequired: !hasCredentials(),
      ...(session ? { csrfToken: session.csrfToken } : {}),
    });
  });

  // Registration: the first passkey needs the one-time setup code, later ones an open session.
  const registerBody = z.object({ setupCode: z.string().max(200).optional() });

  const mayRegister = (c: Context, code: string | undefined) => {
    const session = readSession(c, db, secure, now());
    if (session) {
      return csrfMatches(c.req.header(CSRF_HEADER), session.csrfToken) ? { session } : undefined;
    }
    return setupCodeValid(code) ? { session: undefined } : undefined;
  };

  app.post("/register/options", async (c) => {
    const body = registerBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success || !mayRegister(c, body.data.setupCode)) return c.json({ error: "forbidden" }, 403);
    const options = await webauthn.generateRegistrationOptions({
      rpName: config.rpName,
      rpID: config.rpId,
      userName: "owner",
      userDisplayName: "KQuiz",
      userID: OWNER_ID,
      attestationType: "none",
      excludeCredentials: loadCredentials().map((cred) => ({ id: cred.id, transports: cred.transports ?? undefined })),
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    });
    storeChallenge(options.challenge, "register");
    return c.json(options);
  });

  app.post("/register/verify", async (c) => {
    const raw = await c.req.json().catch(() => null);
    const body = z
      .object({ setupCode: z.string().max(200).optional(), name: z.string().trim().max(60).optional(), response: responseSchema })
      .safeParse(raw);
    if (!body.success) return c.json({ error: "invalid_request" }, 400);
    const allowed = mayRegister(c, body.data.setupCode);
    if (!allowed) return c.json({ error: "forbidden" }, 403);
    const response = body.data.response as unknown as RegistrationResponseJSON;
    const challenge = consumeChallenge(response.response.clientDataJSON, "register");
    if (!challenge) return c.json({ error: "challenge_expired" }, 400);

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
    if (!allowed.session && hasCredentials()) return c.json({ error: "forbidden" }, 403);

    const { credential, credentialDeviceType, credentialBackedUp } = result.registrationInfo;
    const t = now();
    db.insert(authCredentials)
      .values({
        id: credential.id,
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
    if (allowed.session) return c.json({ ok: true });
    const { csrfToken } = createSession(c, db, { secure, credentialId: credential.id, now: t });
    return c.json({ ok: true, csrfToken });
  });

  app.post("/login/options", async (c) => {
    const creds = loadCredentials();
    if (creds.length === 0) return c.json({ error: "setup_required" }, 409);
    const options = await webauthn.generateAuthenticationOptions({
      rpID: config.rpId,
      allowCredentials: creds.map((cred) => ({ id: cred.id, transports: (cred.transports ?? undefined) as never })),
      userVerification: "required",
    });
    storeChallenge(options.challenge, "login");
    return c.json(options);
  });

  app.post("/login/verify", async (c) => {
    const body = z.object({ response: responseSchema }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_request" }, 400);
    const response = body.data.response as unknown as AuthenticationResponseJSON;
    const challenge = consumeChallenge(response.response.clientDataJSON, "login");
    if (!challenge) return c.json({ error: "challenge_expired" }, 400);
    const stored = db.select().from(authCredentials).where(eq(authCredentials.id, response.id)).get();
    if (!stored) return c.json({ error: "verification_failed" }, 400);

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
    const { csrfToken } = createSession(c, db, { secure, credentialId: stored.id, now: t });
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
      passkeys: loadCredentials().map((cred) => ({
        id: cred.id,
        name: cred.name,
        createdAt: cred.createdAt.toISOString(),
        lastUsedAt: cred.lastUsedAt?.toISOString() ?? null,
      })),
    }),
  );

  // For a lost phone. The last passkey stays, otherwise the owner is locked out for good.
  authed.delete("/passkeys/:id", (c) => {
    const id = c.req.param("id");
    const creds = loadCredentials();
    if (!creds.some((cred) => cred.id === id)) return c.json({ error: "not_found" }, 404);
    if (creds.length === 1) return c.json({ error: "last_passkey" }, 409);
    db.delete(authCredentials).where(eq(authCredentials.id, id)).run();
    db.delete(authSessions).where(eq(authSessions.credentialId, id)).run();
    return c.json({ ok: true });
  });

  app.route("/", authed);
  return app;
}
