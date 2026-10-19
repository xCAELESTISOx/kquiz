// Test helpers: an app over an in-memory database, a fake authenticator and a cookie jar.
import type { WebAuthn } from "./auth/routes.js";
import { createServer } from "./server.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db/client.js";

export const ORIGIN = "https://kquiz.test";
export const SETUP_CODE = "setup-code-0123456789";

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

/** A browser response that signed `challenge` with credential `id`. */
export const signed = (challenge: string, id = "cred-1") => ({
  id,
  rawId: id,
  type: "public-key",
  response: { clientDataJSON: b64({ challenge, type: "webauthn.get", origin: ORIGIN }) },
});

/** Stands in for @simplewebauthn/server: anything signed by a credential not named "bad" verifies. */
export function fakeWebAuthn(): WebAuthn {
  let n = 0;
  return {
    generateRegistrationOptions: (async () => ({ challenge: `reg-${++n}` })) as unknown as WebAuthn["generateRegistrationOptions"],
    generateAuthenticationOptions: (async () => ({ challenge: `login-${++n}` })) as unknown as WebAuthn["generateAuthenticationOptions"],
    verifyRegistrationResponse: (async ({ response }: { response: { id: string } }) =>
      response.id === "bad"
        ? { verified: false }
        : {
            verified: true,
            registrationInfo: {
              credential: { id: response.id, publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ["internal"] },
              credentialDeviceType: "multiDevice",
              credentialBackedUp: true,
            },
          }) as unknown as WebAuthn["verifyRegistrationResponse"],
    verifyAuthenticationResponse: (async ({ response, credential }: { response: { id: string }; credential: { counter: number } }) => ({
      verified: response.id !== "bad",
      authenticationInfo: { newCounter: credential.counter + 1 },
    })) as unknown as WebAuthn["verifyAuthenticationResponse"],
  };
}

export function testApp(env: Record<string, string> = {}) {
  const config = loadConfig({ ORIGIN, NODE_ENV: "test", ...env });
  const db = openDb(":memory:");
  const clock = { now: new Date("2026-10-19T10:00:00Z") };
  const app = createServer({ db, config, setupCode: SETUP_CODE, webauthn: fakeWebAuthn(), now: () => clock.now });

  let cookie = "";
  let csrfToken = "";
  /** Paths are under /api unless they start with "//", which marks a path from the site root. */
  async function request(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { origin: ORIGIN, ...init.headers };
    if (cookie) headers.cookie = cookie;
    if (csrfToken) headers["x-csrf-token"] ??= csrfToken;
    if (init.body !== undefined) headers["content-type"] = "application/json";
    const res = await app.request(path.startsWith("//") ? path.slice(1) : `/api${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0]!;
    const text = await res.text();
    let json: Record<string, any> | null = null;
    try {
      json = JSON.parse(text);
    } catch {}
    if (typeof json?.csrfToken === "string") csrfToken = json.csrfToken;
    return { status: res.status, headers: res.headers, json: json ?? {}, text };
  }

  /** Binds the first passkey with the setup code, which also signs in. */
  async function signIn() {
    const options = await request("/auth/register/options", { body: { setupCode: SETUP_CODE } });
    const res = await request("/auth/register/verify", { body: { setupCode: SETUP_CODE, response: signed(options.json.challenge) } });
    if (res.status !== 200) throw new Error(`sign in failed: ${JSON.stringify(res.json)}`);
  }

  const jar = {
    clear: () => {
      cookie = "";
      csrfToken = "";
    },
    get csrf() {
      return csrfToken;
    },
    get cookie() {
      return cookie;
    },
  };

  return { app, db, config, clock, request, signIn, jar };
}
