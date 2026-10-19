import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";
import { CLAUDE_REDIRECT_URIS } from "./mcp/app.js";
import { ORIGIN, testApp } from "./testing.js";

const REDIRECT = CLAUDE_REDIRECT_URIS[0]!;

const verifier = "v".repeat(43);
const challenge = createHash("sha256").update(verifier).digest("base64url");

describe("server", () => {
  it("keeps MCP and OAuth behind the Cloudflare check", async () => {
    const secret = "s".repeat(40);
    const { request } = testApp({ ORIGIN_SECRET: secret });
    expect((await request("/health")).status).toBe(200);
    expect((await request("//mcp", { body: {} })).status).toBe(403);
    expect((await request("//.well-known/oauth-authorization-server")).status).toBe(403);
    const cf = { "x-kquiz-origin": secret, "cf-connecting-ip": "203.0.113.1" };
    expect((await request("//.well-known/oauth-authorization-server", { headers: cf })).status).toBe(200);
  });

  it("asks for a passkey before consent, then shows consent after a fresh login", async () => {
    const t = testApp();
    const reg = await t.request("//oauth/register", {
      body: { redirect_uris: [REDIRECT], client_name: "Claude" },
    });
    expect(reg.status).toBe(201);
    const query = new URLSearchParams({
      response_type: "code",
      client_id: reg.json.client_id,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    const before = await t.request(`//oauth/authorize?${query}`);
    expect(before.status).toBe(302);
    expect(before.headers.get("location")).toMatch(/^\/login\?fresh=1&return_to=%2Foauth%2Fauthorize/);

    await t.signIn();
    const after = await t.request(`//oauth/authorize?${query}`);
    expect(after.status).toBe(200);
    expect(after.text).toContain("Claude");

    // Five minutes later the same session no longer counts as a fresh passkey check.
    t.clock.now = new Date(t.clock.now.getTime() + 6 * 60_000);
    expect((await t.request(`//oauth/authorize?${query}`)).status).toBe(302);
  });

  it("lets Claude read and add cards in SQLite after the owner approves", async () => {
    const t = testApp();
    await t.signIn();
    await t.request("/cards", { body: { korean: "물", meaning: "вода" } });
    const call = (path: string, init: RequestInit = {}) =>
      t.app.request(`${ORIGIN}${path}`, { ...init, headers: { cookie: t.jar.cookie, ...(init.headers as Record<string, string>) } });
    const form = (fields: Record<string, string>) => ({
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN },
      body: new URLSearchParams(fields).toString(),
    });

    const reg = await t.request("//oauth/register", { body: { redirect_uris: [REDIRECT], client_name: "Claude" } });
    const clientId = reg.json.client_id as string;
    const query = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    const page = await (await call(`/oauth/authorize?${query}`)).text();
    const ticket = page.match(/name="ticket" value="([^"]+)"/)?.[1];
    const approved = await call("/oauth/authorize", form({ ticket: ticket!, decision: "allow" }));
    const code = new URL(approved.headers.get("location")!).searchParams.get("code")!;
    const tokens = (await (
      await call("/oauth/token", form({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: verifier, redirect_uri: REDIRECT }))
    ).json()) as { access_token: string };

    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${tokens.access_token}` } },
        fetch: (url, init) => t.app.request(url.toString(), init),
      }),
    );
    const text = (result: unknown) => JSON.parse((result as { content: { text: string }[] }).content[0]!.text);
    const examples = [
      { ko: "불이 났어요.", ru: "Случился пожар." },
      { ko: "불을 켜 주세요.", ru: "Включите свет, пожалуйста." },
      { ko: "불이 뜨거워요.", ru: "Огонь горячий." },
    ];
    const added = text(
      await client.callTool({
        name: "add_cards",
        arguments: { cards: [{ korean: "물!", meaning: "вода", examples }, { korean: "불", meaning: "огонь", examples }] },
      }),
    );
    expect(added.created.map((c: { korean: string }) => c.korean)).toEqual(["불"]);
    expect(added.duplicates.map((c: { korean: string }) => c.korean)).toEqual(["물"]);
    expect((await t.request("/cards")).json.cards.map((c: { korean: string; source: string }) => [c.korean, c.source])).toEqual([
      ["불", "claude"],
      ["물", "app"],
    ]);
    expect((await t.request("/cards")).json.cards[0].examples).toEqual(examples);
  });
});
