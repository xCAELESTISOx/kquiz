import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { beforeEach, describe, expect, it } from "vitest";
import { CLAUDE_REDIRECT_URIS, createMcpApp } from "./app.js";
import { MemoryOAuthStore } from "./oauth-store.js";
import { MemoryCardStore, MemoryDrillStore } from "./store.js";

const ORIGIN = "https://kquiz.test";
const REDIRECT = CLAUDE_REDIRECT_URIS[0]!;
const verifier = "v".repeat(50);
const challenge = createHash("sha256").update(verifier).digest("base64url");

let clock: number;
let session: { authenticatedAt: Date } | null;
let cards: MemoryCardStore;
let drills: MemoryDrillStore;
let oauth: MemoryOAuthStore;
let app: ReturnType<typeof createMcpApp>;

beforeEach(() => {
  clock = Date.parse("2026-10-19T10:00:00Z");
  session = { authenticatedAt: new Date(clock) };
  cards = new MemoryCardStore();
  drills = new MemoryDrillStore();
  oauth = new MemoryOAuthStore();
  app = createMcpApp({
    publicUrl: ORIGIN,
    cards,
    drills,
    oauth,
    owner: { session: async () => session, loginUrl: (r) => `/login?return_to=${encodeURIComponent(r)}` },
    maxClients: 3,
    now: () => clock,
  });
});

const call = (path: string, init?: RequestInit) => app.request(`${ORIGIN}${path}`, init);
const form = (fields: Record<string, string>) => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(fields).toString(),
});

async function register(extra: Record<string, unknown> = {}) {
  const res = await call("/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "Claude", redirect_uris: [REDIRECT], ...extra }),
  });
  return { res, body: (await res.json()) as { client_id: string; client_secret?: string; error?: string } };
}

function authorizeUrl(clientId: string) {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "xyz",
    resource: `${ORIGIN}/mcp`,
  });
  return `/oauth/authorize?${query}`;
}

async function approve(clientId: string) {
  const page = await call(authorizeUrl(clientId));
  expect(page.status).toBe(200);
  const ticket = (await page.text()).match(/name="ticket" value="([^"]+)"/)?.[1];
  const res = await call("/oauth/authorize", form({ ticket: ticket!, decision: "allow" }));
  expect(res.status).toBe(302);
  return new URL(res.headers.get("location")!);
}

async function exchange(clientId: string, code: string, extra: Record<string, string> = {}) {
  const res = await call(
    "/oauth/token",
    form({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: verifier, redirect_uri: REDIRECT, ...extra }),
  );
  return { res, body: (await res.json()) as { access_token: string; refresh_token: string; error?: string } };
}

async function connect() {
  const { body: client } = await register();
  const redirect = await approve(client.client_id);
  const { body: tokens } = await exchange(client.client_id, redirect.searchParams.get("code")!);
  return { clientId: client.client_id, ...tokens };
}

async function mcpClient(accessToken: string) {
  const client = new Client({ name: "test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${accessToken}` } },
    fetch: (url, init) => app.request(url.toString(), init),
  });
  await client.connect(transport);
  return client;
}

function parse(result: unknown) {
  const [first] = (result as { content: { text: string }[] }).content;
  return JSON.parse(first!.text);
}

describe("oauth", () => {
  it("publishes metadata that points Claude at our endpoints", async () => {
    const resource = await (await call("/.well-known/oauth-protected-resource/mcp")).json();
    expect(resource).toMatchObject({ resource: `${ORIGIN}/mcp`, authorization_servers: [ORIGIN] });
    const server = await (await call("/.well-known/oauth-authorization-server")).json();
    expect(server).toMatchObject({ registration_endpoint: `${ORIGIN}/oauth/register`, code_challenge_methods_supported: ["S256"] });
  });

  it("asks for a token on /mcp", async () => {
    const res = await call("/mcp", { method: "POST" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain(`${ORIGIN}/.well-known/oauth-protected-resource/mcp`);
  });

  it("registers only Claude's callbacks", async () => {
    const { res, body } = await register({ redirect_uris: ["https://evil.example/cb"] });
    expect(res.status).toBe(400);
    expect(body.error).toBe("invalid_redirect_uri");
  });

  it("evicts unapproved clients instead of growing past the cap", async () => {
    const first = await register();
    await approve(first.body.client_id);
    for (let i = 0; i < 5; i++) expect((await register()).res.status).toBe(201);
    expect(await oauth.countClients()).toBe(3);
    expect(await oauth.getClient(first.body.client_id)).not.toBeNull();
  });

  it("sends the owner to a passkey login when the session is missing or stale", async () => {
    const { body } = await register();
    session = null;
    let res = await call(authorizeUrl(body.client_id));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/^\/login\?return_to=%2Foauth%2Fauthorize/);

    session = { authenticatedAt: new Date(clock - 10 * 60_000) };
    res = await call(authorizeUrl(body.client_id));
    expect(res.headers.get("location")).toMatch(/^\/login/);
  });

  it("refuses to redirect to an unregistered URI", async () => {
    const { body } = await register();
    const res = await call(authorizeUrl(body.client_id).replace(encodeURIComponent(REDIRECT), "https%3A%2F%2Fevil.example"));
    expect(res.status).toBe(400);
  });

  it("issues tokens once per code and only with the right verifier", async () => {
    const { body: client } = await register();
    const redirect = await approve(client.client_id);
    expect(redirect.searchParams.get("state")).toBe("xyz");
    expect(redirect.searchParams.get("iss")).toBe(ORIGIN);
    const code = redirect.searchParams.get("code")!;

    const wrong = await exchange(client.client_id, code, { code_verifier: "w".repeat(50) });
    expect(wrong.body.error).toBe("invalid_grant");
    // The failed attempt used the code up.
    expect((await exchange(client.client_id, code)).body.error).toBe("invalid_grant");

    const fresh = (await approve(client.client_id)).searchParams.get("code")!;
    const ok = await exchange(client.client_id, fresh);
    expect(ok.res.status).toBe(200);
    expect(ok.body.access_token).toBeTruthy();
  });

  it("rejects expired codes", async () => {
    const { body: client } = await register();
    const code = (await approve(client.client_id)).searchParams.get("code")!;
    clock += 2 * 60_000;
    expect((await exchange(client.client_id, code)).body.error).toBe("invalid_grant");
  });

  it("returns access_denied when the owner declines", async () => {
    const { body: client } = await register();
    const page = await call(authorizeUrl(client.client_id));
    const ticket = (await page.text()).match(/name="ticket" value="([^"]+)"/)?.[1];
    const res = await call("/oauth/authorize", form({ ticket: ticket!, decision: "deny" }));
    expect(new URL(res.headers.get("location")!).searchParams.get("error")).toBe("access_denied");
  });

  it("requires the secret from confidential clients", async () => {
    const { body: client } = await register({ token_endpoint_auth_method: "client_secret_post" });
    expect(client.client_secret).toBeTruthy();
    const code = (await approve(client.client_id)).searchParams.get("code")!;
    expect((await exchange(client.client_id, code)).res.status).toBe(401);
    const code2 = (await approve(client.client_id)).searchParams.get("code")!;
    expect((await exchange(client.client_id, code2, { client_secret: client.client_secret! })).res.status).toBe(200);
  });

  it("rotates refresh tokens and revokes the grant when an old one is replayed", async () => {
    const tokens = await connect();
    const refresh = (token: string) =>
      call("/oauth/token", form({ grant_type: "refresh_token", client_id: tokens.clientId, refresh_token: token }));

    const first = await refresh(tokens.refresh_token);
    expect(first.status).toBe(200);
    const rotated = (await first.json()) as { access_token: string; refresh_token: string };

    expect((await refresh(tokens.refresh_token)).status).toBe(400);
    expect((await refresh(rotated.refresh_token)).status).toBe(400);
    expect(await oauth.listGrants()).toHaveLength(0);
  });

  it("expires access tokens and honours revocation", async () => {
    const tokens = await connect();
    const ping = () =>
      call("/mcp", {
        method: "POST",
        headers: { authorization: `Bearer ${tokens.access_token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      });
    expect((await ping()).status).toBe(200);

    await call("/oauth/revoke", form({ client_id: tokens.clientId, token: tokens.refresh_token }));
    expect((await ping()).status).toBe(401);

    const again = await connect();
    clock += 61 * 60_000;
    const res = await call("/mcp", { method: "POST", headers: { authorization: `Bearer ${again.access_token}` } });
    expect(res.status).toBe(401);
  });
});

const examples = [
  { ko: "책을 읽어요.", ru: "Я читаю книгу." },
  { ko: "신문을 읽었어요.", ru: "Я прочитал газету." },
  { ko: "천천히 읽어 주세요.", ru: "Прочитайте медленно, пожалуйста." },
];

describe("mcp tools", () => {
  it("lists the tools without a delete", async () => {
    const client = await mcpClient((await connect()).access_token);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "add_cards",
      "add_sound_drills",
      "find_cards",
      "get_stats",
      "get_weak_sounds",
      "list_sound_drills",
      "update_card",
    ]);
    expect(client.getInstructions()).toContain("Hangul");
  });

  it("adds cards and reports duplicates and rejects", async () => {
    const client = await mcpClient((await connect()).access_token);
    await client.callTool({ name: "add_cards", arguments: { cards: [{ korean: "물", meaning: "вода", examples }] } });
    const result = parse(
      await client.callTool({
        name: "add_cards",
        arguments: {
          cards: [
            { korean: "물 ", meaning: "вода", examples },
            { korean: "읽다", meaning: "читать", pronunciation: "[익따]", examples, tags: ["глаголы"] },
            { korean: "읽다", meaning: "читать", examples },
            { korean: "", meaning: "пусто", examples },
          ],
        },
      }),
    );
    expect(result.created).toEqual([{ id: expect.any(String), korean: "읽다", meaning: "читать", speakable: true }]);
    expect(result.duplicates.map((d: { korean: string }) => d.korean)).toEqual(["물"]);
    expect(result.rejected.map((r: { reason: string }) => r.reason)).toEqual(["repeated in this batch", expect.any(String)]);

    const stored = [...cards.cards.values()].find((c) => c.korean === "읽다")!;
    expect(stored).toMatchObject({ source: "claude", examples, tags: ["глаголы"] });
  });

  it("requires exactly three examples on every new card", async () => {
    const client = await mcpClient((await connect()).access_token);
    const none = await client.callTool({ name: "add_cards", arguments: { cards: [{ korean: "물", meaning: "вода" }] } });
    expect(none.isError).toBe(true);
    const two = await client.callTool({
      name: "add_cards",
      arguments: { cards: [{ korean: "물", meaning: "вода", examples: examples.slice(0, 2) }] },
    });
    expect(two.isError).toBe(true);
    const latin = parse(
      await client.callTool({
        name: "add_cards",
        arguments: { cards: [{ korean: "물", meaning: "вода", examples: [...examples.slice(0, 2), { ko: "water", ru: "вода" }] }] },
      }),
    );
    expect(latin.created).toEqual([]);
    expect(latin.rejected).toHaveLength(1);
    expect(cards.cards.size).toBe(0);
  });

  it("finds and updates cards without touching other fields", async () => {
    const client = await mcpClient((await connect()).access_token);
    await client.callTool({
      name: "add_cards",
      arguments: {
        cards: [
          { korean: "사과", meaning: "яблоко", tags: ["еда"], notes: "фрукт", examples },
          { korean: "하늘", meaning: "небо", examples },
        ],
      },
    });
    const found = parse(await client.callTool({ name: "find_cards", arguments: { tag: "еда" } }));
    expect(found.cards).toHaveLength(1);
    const id = found.cards[0].id;

    const noExamples = await client.callTool({ name: "update_card", arguments: { id, changes: { meaning: "яблоко (фрукт)" } } });
    expect(noExamples.isError).toBe(true);

    const newExamples = [
      { ko: "사과를 먹어요.", ru: "Я ем яблоко." },
      { ko: "사과가 빨개요.", ru: "Яблоко красное." },
      { ko: "사과 두 개 주세요.", ru: "Дайте два яблока." },
    ];
    const updated = parse(
      await client.callTool({
        name: "update_card",
        arguments: { id, changes: { meaning: "яблоко (фрукт)", notes: "", examples: newExamples } },
      }),
    );
    expect(updated.card).toMatchObject({ meaning: "яблоко (фрукт)", tags: ["еда"], examples: newExamples });
    expect(updated.card.notes ?? "").toBe("");

    const byText = parse(await client.callTool({ name: "find_cards", arguments: { query: "небо" } }));
    expect(byText.cards.map((c: { korean: string }) => c.korean)).toEqual(["하늘"]);

    const missing = await client.callTool({ name: "update_card", arguments: { id: "nope", changes: { meaning: "x", examples } } });
    expect(missing.isError).toBe(true);
  });

  it("caps a batch at 50 cards", async () => {
    const client = await mcpClient((await connect()).access_token);
    const many = Array.from({ length: 51 }, (_, i) => ({ korean: "가".repeat(i + 1), meaning: "x", examples }));
    const result = await client.callTool({ name: "add_cards", arguments: { cards: many } });
    expect(result.isError).toBe(true);
    expect(cards.cards.size).toBe(0);
  });

  it("reports stats", async () => {
    const client = await mcpClient((await connect()).access_token);
    await client.callTool({ name: "add_cards", arguments: { cards: [{ korean: "물", meaning: "вода", examples }] } });
    expect(parse(await client.callTool({ name: "get_stats", arguments: {} }))).toMatchObject({ cards: 1, dueMeaning: 1 });
  });

  it("adds sound drills, skipping repeats and malformed sets", async () => {
    const client = await mcpClient((await connect()).access_token);
    const result = parse(
      await client.callTool({
        name: "add_sound_drills",
        arguments: {
          drills: [
            { contrast: "ㅂ/ㅍ/ㅃ", words: [{ korean: "불", meaning: "огонь" }, { korean: "풀", meaning: "трава" }, { korean: "뿔" }] },
            { contrast: "ㅂ/ㅍ/ㅃ", words: [{ korean: "뿔" }, { korean: "불 " }, { korean: "풀" }] },
            { contrast: "ㄱ/ㅋ", words: [{ korean: "gal" }, { korean: "칼" }] },
            { contrast: "ㄱ/ㄱ", words: [{ korean: "달" }, { korean: "달" }] },
          ],
        },
      }),
    );
    expect(result.created).toEqual([{ id: 1, contrast: "ㅂ/ㅍ/ㅃ", words: ["불", "풀", "뿔"] }]);
    expect(result.duplicates).toEqual([{ contrast: "ㅂ/ㅍ/ㅃ", words: ["뿔", "불", "풀"], existingId: 1 }]);
    expect(result.rejected).toHaveLength(2);
    expect(parse(await client.callTool({ name: "list_sound_drills", arguments: {} })).drills).toHaveLength(1);
  });
});
