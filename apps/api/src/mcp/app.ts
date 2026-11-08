import { timingSafeEqual } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { html } from "hono/html";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import { randomToken, sha256, type Grant, type OAuthClient, type OAuthStore } from "./oauth-store.js";
import { rateLimit } from "./rate-limit.js";
import type { CardStore, DrillStore } from "./store.js";
import { createMcpServer } from "./tools.js";

/** The app's passkey login, provided by the API's auth module. */
export interface OwnerAuth {
  /** The signed-in user's session for this request, or null when not signed in. */
  session(c: Context): Promise<{ authenticatedAt: Date; userId: number } | null>;
  /** Page that signs the user in with a passkey and then sends the browser to `returnTo`. */
  loginUrl(returnTo: string): string;
}

/** One user's cards and drills; null when that user can no longer use the connector (disabled). */
export type UserStores = (userId: number) => { cards: CardStore; drills?: DrillStore } | null;

export interface McpAppOptions {
  /** Public origin Claude reaches us at, e.g. https://kquiz.example.com */
  publicUrl: string;
  /** Each grant works on the cards of the person who approved it; without drills Claude gets no drill tools. */
  stores: UserStores;
  oauth: OAuthStore;
  owner: OwnerAuth;
  /** Redirect URIs a registering client may use. Defaults to Claude's OAuth callbacks. */
  redirectUris?: string[];
  maxClients?: number;
  now?: () => number;
}

export const CLAUDE_REDIRECT_URIS = [
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
];

const SCOPE = "cards";
const CODE_TTL = 60_000;
const CONSENT_TTL = 10 * 60_000;
const ACCESS_TTL = 60 * 60_000;
const REFRESH_TTL = 30 * 24 * 60 * 60_000;
// Consent counts as confirmed by passkey only if the user signed in with it just now.
const FRESH_LOGIN = 5 * 60_000;

const authorizeParams = z.object({
  response_type: z.literal("code"),
  client_id: z.string().min(1).max(200),
  redirect_uri: z.string().min(1).max(2000),
  code_challenge: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
  code_challenge_method: z.literal("S256"),
  state: z.string().max(2000).optional(),
  scope: z.string().max(200).optional(),
  resource: z.string().max(2000).optional(),
});

type AuthorizeParams = z.infer<typeof authorizeParams>;

const registration = z.object({
  redirect_uris: z.array(z.string().max(2000)).min(1).max(5),
  client_name: z.string().trim().max(100).optional(),
  token_endpoint_auth_method: z.enum(["none", "client_secret_post", "client_secret_basic"]).default("none"),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
});

function sameSecret(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function oauthError(c: Context, error: string, description: string, status: 400 | 401 = 400) {
  return c.json({ error, error_description: description }, status);
}

export function createMcpApp(options: McpAppOptions) {
  const { stores, oauth, owner, maxClients = 20, now = Date.now } = options;
  const issuer = options.publicUrl.replace(/\/+$/, "");
  const resource = `${issuer}/mcp`;
  const resourceMetadataUrl = `${issuer}/.well-known/oauth-protected-resource/mcp`;
  const allowedRedirects = new Set(options.redirectUris ?? CLAUDE_REDIRECT_URIS);
  // Pending consent screens; short-lived, so memory is enough even across restarts.
  const consents = new Map<string, { params: AuthorizeParams; expiresAt: number }>();

  const app = new Hono<{ Variables: { grant: Grant; token: string } }>();
  app.use(
    secureHeaders({
      contentSecurityPolicy: { defaultSrc: ["'none'"], styleSrc: ["'unsafe-inline'"], frameAncestors: ["'none'"] },
    }),
  );
  app.use(bodyLimit({ maxSize: 256 * 1024 }));

  const validResource = (value: string | undefined) =>
    value === undefined || value.replace(/\/+$/, "") === resource;

  // Metadata (RFC 9728, RFC 8414). Served on both paths because clients differ in which they try.
  const protectedResource = {
    resource,
    authorization_servers: [issuer],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
  };
  app.get("/.well-known/oauth-protected-resource", (c) => c.json(protectedResource));
  app.get("/.well-known/oauth-protected-resource/mcp", (c) => c.json(protectedResource));
  app.get("/.well-known/oauth-authorization-server", (c) =>
    c.json({
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      registration_endpoint: `${issuer}/oauth/register`,
      revocation_endpoint: `${issuer}/oauth/revoke`,
      scopes_supported: [SCOPE],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
      authorization_response_iss_parameter_supported: true,
    }),
  );

  // Dynamic Client Registration (RFC 7591). Only Claude's callbacks are accepted and the number
  // of clients is capped, so registering cannot grow the database or point codes elsewhere.
  app.post("/oauth/register", rateLimit(10, 60 * 60_000, now), async (c) => {
    const parsed = registration.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return oauthError(c, "invalid_client_metadata", z.prettifyError(parsed.error));
    const meta = parsed.data;
    const bad = meta.redirect_uris.find((uri) => !allowedRedirects.has(uri));
    if (bad) return oauthError(c, "invalid_redirect_uri", `Redirect URI not allowed: ${bad}`);

    if ((await oauth.countClients()) >= maxClients && !(await oauth.evictOldestUnapprovedClient())) {
      return oauthError(c, "invalid_client_metadata", "Client limit reached");
    }
    const client: OAuthClient = {
      clientId: randomToken(16),
      name: meta.client_name || "MCP client",
      redirectUris: meta.redirect_uris,
      createdAt: now(),
    };
    const secret = meta.token_endpoint_auth_method === "none" ? undefined : randomToken();
    if (secret) client.secretHash = sha256(secret);
    await oauth.saveClient(client);
    return c.json(
      {
        client_id: client.clientId,
        ...(secret && { client_secret: secret, client_secret_expires_at: 0 }),
        client_id_issued_at: Math.floor(client.createdAt / 1000),
        client_name: client.name,
        redirect_uris: client.redirectUris,
        token_endpoint_auth_method: meta.token_endpoint_auth_method,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      },
      201,
    );
  });

  app.get("/oauth/authorize", async (c) => {
    const query = c.req.query();
    // Without a known client and its exact redirect URI we must not redirect anywhere.
    const client = query.client_id ? await oauth.getClient(query.client_id) : null;
    if (!client) return c.text("Unknown client", 400);
    if (!query.redirect_uri || !client.redirectUris.includes(query.redirect_uri)) {
      return c.text("Redirect URI does not match the registered one", 400);
    }
    const parsed = authorizeParams.safeParse(query);
    if (!parsed.success || !validResource(parsed.data.resource)) {
      return redirectWithError(c, query.redirect_uri, query.state, "invalid_request");
    }
    const params = parsed.data;

    const session = await owner.session(c);
    if (!session || now() - session.authenticatedAt.getTime() > FRESH_LOGIN) {
      const url = new URL(c.req.url);
      return c.redirect(owner.loginUrl(url.pathname + url.search));
    }

    for (const [id, consent] of consents) if (consent.expiresAt < now()) consents.delete(id);
    const ticket = randomToken();
    consents.set(ticket, { params, expiresAt: now() + CONSENT_TTL });
    return c.html(consentPage(client.name, ticket));
  });

  app.post("/oauth/authorize", async (c) => {
    const body = await c.req.parseBody();
    const ticket = typeof body.ticket === "string" ? body.ticket : "";
    const consent = consents.get(ticket);
    consents.delete(ticket);
    if (!consent || consent.expiresAt < now()) return c.text("This request has expired, start again from Claude", 400);
    const session = await owner.session(c);
    if (!session) return c.text("Sign in first", 401);

    const { params } = consent;
    if (body.decision !== "allow") return redirectWithError(c, params.redirect_uri, params.state, "access_denied");

    const code = randomToken();
    await oauth.saveCode({
      codeHash: sha256(code),
      userId: session.userId,
      clientId: params.client_id,
      redirectUri: params.redirect_uri,
      codeChallenge: params.code_challenge,
      scope: SCOPE,
      expiresAt: now() + CODE_TTL,
    });
    await oauth.markClientApproved(params.client_id, now());
    const target = new URL(params.redirect_uri);
    target.searchParams.set("code", code);
    if (params.state !== undefined) target.searchParams.set("state", params.state);
    target.searchParams.set("iss", issuer);
    return c.redirect(target.toString(), 302);
  });

  function redirectWithError(c: Context, redirectUri: string, state: string | undefined, error: string) {
    const target = new URL(redirectUri);
    target.searchParams.set("error", error);
    if (state !== undefined) target.searchParams.set("state", state);
    target.searchParams.set("iss", issuer);
    return c.redirect(target.toString(), 302);
  }

  /** Authenticates the client on the token and revocation endpoints. */
  async function authenticateClient(c: Context, body: Record<string, unknown>) {
    let clientId = typeof body.client_id === "string" ? body.client_id : undefined;
    let secret = typeof body.client_secret === "string" ? body.client_secret : undefined;
    const basic = c.req.header("authorization")?.match(/^Basic\s+(.+)$/i);
    if (basic?.[1]) {
      const [id, pass] = Buffer.from(basic[1], "base64").toString().split(":");
      clientId = decodeURIComponent(id ?? "");
      secret = decodeURIComponent(pass ?? "");
    }
    const client = clientId ? await oauth.getClient(clientId) : null;
    if (!client) return null;
    if (client.secretHash && !(secret && sameSecret(sha256(secret), client.secretHash))) return null;
    return client;
  }

  async function issueTokens(c: Context, grant: { id: string; userId: number; clientId: string; createdAt: number }, previous: string[]) {
    const accessToken = randomToken();
    const refreshToken = randomToken();
    const t = now();
    await oauth.saveGrant({
      ...grant,
      scope: SCOPE,
      lastUsedAt: t,
      accessHash: sha256(accessToken),
      accessExpiresAt: t + ACCESS_TTL,
      refreshHash: sha256(refreshToken),
      refreshExpiresAt: t + REFRESH_TTL,
      usedRefreshHashes: previous,
    });
    c.header("Cache-Control", "no-store");
    return c.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TTL / 1000,
      refresh_token: refreshToken,
      scope: SCOPE,
    });
  }

  app.post("/oauth/token", rateLimit(30, 60_000, now), async (c) => {
    const body = await c.req.parseBody();
    const client = await authenticateClient(c, body);
    if (!client) return oauthError(c, "invalid_client", "Unknown client or wrong secret", 401);
    if (typeof body.resource === "string" && !validResource(body.resource)) {
      return oauthError(c, "invalid_target", "Unknown resource");
    }

    if (body.grant_type === "authorization_code") {
      const code = typeof body.code === "string" ? await oauth.takeCode(sha256(body.code)) : null;
      const verifier = typeof body.code_verifier === "string" ? body.code_verifier : "";
      if (
        !code ||
        code.expiresAt < now() ||
        code.clientId !== client.clientId ||
        code.redirectUri !== body.redirect_uri ||
        !sameSecret(sha256(verifier), code.codeChallenge)
      ) {
        return oauthError(c, "invalid_grant", "Invalid or expired authorization code");
      }
      return issueTokens(c, { id: randomToken(12), userId: code.userId, clientId: client.clientId, createdAt: now() }, []);
    }

    if (body.grant_type === "refresh_token") {
      const presented = typeof body.refresh_token === "string" ? sha256(body.refresh_token) : "";
      const grant = presented ? await oauth.findGrantByRefresh(presented) : null;
      if (!grant || grant.clientId !== client.clientId) return oauthError(c, "invalid_grant", "Invalid refresh token");
      if (grant.refreshHash !== presented) {
        // A rotated token came back: someone else holds a copy, so cut the whole grant off.
        await oauth.deleteGrant(grant.id);
        return oauthError(c, "invalid_grant", "Refresh token was already used");
      }
      if (grant.refreshExpiresAt < now()) {
        await oauth.deleteGrant(grant.id);
        return oauthError(c, "invalid_grant", "Refresh token expired");
      }
      return issueTokens(c, grant, [...grant.usedRefreshHashes, grant.refreshHash].slice(-20));
    }

    return oauthError(c, "unsupported_grant_type", "Use authorization_code or refresh_token");
  });

  // RFC 7009: always 200, whether or not the token existed.
  app.post("/oauth/revoke", async (c) => {
    const body = await c.req.parseBody();
    const client = await authenticateClient(c, body);
    if (!client) return oauthError(c, "invalid_client", "Unknown client or wrong secret", 401);
    if (typeof body.token === "string") {
      const hash = sha256(body.token);
      const grant = (await oauth.findGrantByAccess(hash)) ?? (await oauth.findGrantByRefresh(hash));
      if (grant && grant.clientId === client.clientId) await oauth.deleteGrant(grant.id);
    }
    return c.body(null, 200);
  });

  // Token check comes before the limit, so strangers cannot use up anyone's quota; one limit per
  // person, so a friend's busy Claude doesn't use up the owner's.
  const mcpLimits = new Map<number, ReturnType<typeof rateLimit>>();
  const mcpLimit: MiddlewareHandler<{ Variables: { grant: Grant } }> = (c, next) => {
    const userId = c.get("grant").userId;
    let limit = mcpLimits.get(userId);
    if (!limit) mcpLimits.set(userId, (limit = rateLimit(60, 60_000, now)));
    return limit(c, next);
  };
  app.use("/mcp", async (c, next) => {
    const token = c.req.header("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
    const grant = token ? await oauth.findGrantByAccess(sha256(token)) : null;
    if (!token || !grant || grant.accessExpiresAt < now()) {
      c.header(
        "WWW-Authenticate",
        `Bearer error="invalid_token", resource_metadata="${resourceMetadataUrl}", scope="${SCOPE}"`,
      );
      return c.json({ error: "invalid_token" }, 401);
    }
    c.set("grant", grant);
    c.set("token", token);
    await next();
  });

  app.all("/mcp", mcpLimit, async (c) => {
    const grant = c.get("grant");
    const token = c.get("token");
    await oauth.touchGrant(grant.id, now());

    const mine = stores(grant.userId);
    if (!mine) return c.json({ error: "invalid_token" }, 401);
    // Stateless: a fresh server per request, no sessions to keep or leak.
    const server = createMcpServer(mine.cards, mine.drills);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw, {
        authInfo: {
          token,
          clientId: grant.clientId,
          scopes: [grant.scope],
          expiresAt: Math.floor(grant.accessExpiresAt / 1000),
          resource: new URL(resource),
        },
      });
    } finally {
      await server.close();
    }
  });

  return app;
}

function consentPage(clientName: string, ticket: string) {
  return html`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="color-scheme" content="dark" />
    <title>KQuiz · access for ${clientName}</title>
    <style>
      body { margin: 0; min-height: 100dvh; display: grid; place-items: center; background: #0b0d12; color: #e8eaf0;
        font: 16px/1.5 Pretendard, -apple-system, system-ui, sans-serif; padding: 16px; box-sizing: border-box; }
      main { width: 100%; max-width: 380px; background: #151922; border-radius: 20px; padding: 28px 24px; }
      h1 { font-size: 22px; margin: 0 0 8px; }
      p { color: #a3a9b8; margin: 0 0 24px; }
      ul { color: #a3a9b8; margin: 0 0 28px; padding-left: 20px; }
      button { width: 100%; min-height: 48px; border: 0; border-radius: 12px; font: inherit; font-weight: 600; cursor: pointer; }
      .allow { background: #6c8cff; color: #0b0d12; margin-bottom: 12px; }
      .deny { background: transparent; color: #a3a9b8; }
    </style>
  </head>
  <body>
    <main>
      <h1>Give “${clientName}” access?</h1>
      <p>It will be able to work with your KQuiz cards.</p>
      <ul>
        <li>add and edit cards</li>
        <li>search cards and see your stats</li>
        <li>it can't delete cards</li>
      </ul>
      <form method="post" action="/oauth/authorize">
        <input type="hidden" name="ticket" value="${ticket}" />
        <button class="allow" name="decision" value="allow">Allow</button>
        <button class="deny" name="decision" value="deny">Deny</button>
      </form>
    </main>
  </body>
</html>`;
}
