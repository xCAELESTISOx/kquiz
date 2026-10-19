import { describe, expect, it } from "vitest";
import { SETUP_CODE, signed, testApp } from "./testing.js";

describe("passkey auth", () => {
  it("reports setup before the first passkey", async () => {
    const { request } = testApp();
    expect((await request("/auth/status")).json).toEqual({ authenticated: false, setupRequired: true });
  });

  it("refuses registration without the setup code", async () => {
    const { request } = testApp();
    expect((await request("/auth/register/options", { body: {} })).status).toBe(403);
    expect((await request("/auth/register/options", { body: { setupCode: "wrong-code-0123456789" } })).status).toBe(403);
  });

  it("binds the first passkey with the setup code and signs in", async () => {
    const t = testApp();
    await t.signIn();
    const status = await t.request("/auth/status");
    expect(status.json).toMatchObject({ authenticated: true, setupRequired: false });
    expect(status.json.csrfToken).toBe(t.jar.csrf);
  });

  it("sets a host-only, httpOnly, strict cookie", async () => {
    const { request } = testApp();
    const options = await request("/auth/register/options", { body: { setupCode: SETUP_CODE } });
    const res = await request("/auth/register/verify", { body: { setupCode: SETUP_CODE, response: signed(options.json.challenge) } });
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^__Host-kq_session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Strict/);
  });

  it("closes the setup code once a passkey exists", async () => {
    const t = testApp();
    await t.signIn();
    t.jar.clear();
    expect((await t.request("/auth/register/options", { body: { setupCode: SETUP_CODE } })).status).toBe(403);
  });

  it("uses each challenge once and rejects unknown ones", async () => {
    const { request } = testApp();
    const options = await request("/auth/register/options", { body: { setupCode: SETUP_CODE } });
    const forged = await request("/auth/register/verify", { body: { setupCode: SETUP_CODE, response: signed("made-up") } });
    expect(forged.status).toBe(400);
    const bad = await request("/auth/register/verify", { body: { setupCode: SETUP_CODE, response: signed(options.json.challenge, "bad") } });
    expect(bad.json.error).toBe("verification_failed");
    const replay = await request("/auth/register/verify", { body: { setupCode: SETUP_CODE, response: signed(options.json.challenge) } });
    expect(replay.json.error).toBe("challenge_expired");
  });

  it("expires challenges after five minutes", async () => {
    const t = testApp();
    await t.signIn();
    t.jar.clear();
    const options = await t.request("/auth/login/options", { body: {} });
    t.clock.now = new Date(t.clock.now.getTime() + 6 * 60_000);
    expect((await t.request("/auth/login/verify", { body: { response: signed(options.json.challenge) } })).status).toBe(400);
  });

  it("logs in with a registered passkey only", async () => {
    const t = testApp();
    await t.signIn();
    t.jar.clear();
    const options = await t.request("/auth/login/options", { body: {} });
    const stranger = await t.request("/auth/login/verify", { body: { response: signed(options.json.challenge, "cred-2") } });
    expect(stranger.status).toBe(400);
    t.clock.now = new Date(t.clock.now.getTime() + 61_000);
    const again = await t.request("/auth/login/options", { body: {} });
    const res = await t.request("/auth/login/verify", { body: { response: signed(again.json.challenge) } });
    expect(res.status).toBe(200);
    expect((await t.request("/auth/status")).json.authenticated).toBe(true);
  });

  it("adds a second passkey only from a session with the CSRF token", async () => {
    const t = testApp();
    await t.signIn();
    expect((await t.request("/auth/register/options", { body: {}, headers: { "x-csrf-token": "nope" } })).status).toBe(403);
    const options = await t.request("/auth/register/options", { body: {} });
    expect(options.status).toBe(200);
    const res = await t.request("/auth/register/verify", { body: { name: "iPad", response: signed(options.json.challenge, "cred-2") } });
    expect(res.status).toBe(200);
    const list = await t.request("/auth/passkeys");
    expect(list.json.passkeys.map((p: { id: string }) => p.id).sort()).toEqual(["cred-1", "cred-2"]);
  });

  it("keeps the last passkey", async () => {
    const t = testApp();
    await t.signIn();
    expect((await t.request("/auth/passkeys/cred-1", { method: "DELETE" })).status).toBe(409);
  });

  it("logs out", async () => {
    const t = testApp();
    await t.signIn();
    expect((await t.request("/auth/logout", { method: "POST" })).status).toBe(200);
    expect((await t.request("/cards")).status).toBe(401);
  });

  it("limits login attempts to five a minute", async () => {
    const t = testApp();
    await t.signIn();
    t.jar.clear();
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await t.request("/auth/login/options", { body: {} })).status);
    // The two sign-in requests above count too.
    expect(statuses).toEqual([200, 200, 200, 429]);
    t.clock.now = new Date(t.clock.now.getTime() + 61_000);
    expect((await t.request("/auth/login/options", { body: {} })).status).toBe(200);
  });
});
