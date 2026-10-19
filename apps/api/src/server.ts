import { Hono } from "hono";
import { createApp, type AppDeps } from "./app.js";
import { createMcpApp } from "./mcp/app.js";
import { requireCloudflare } from "./security/origin.js";
import { ownerAuth, SqliteOAuthStore, sqliteStores } from "./storage/mcp.js";

/** The whole HTTP surface: the app's /api plus the MCP endpoint and its OAuth routes. */
export function createServer(deps: AppDeps & { mcpRedirectUris?: string[] }) {
  const { db, config, now = () => new Date() } = deps;
  const mcp = createMcpApp({
    // One domain for the app, the API and the MCP endpoint (docs/PLAN.md §3).
    publicUrl: config.origin,
    stores: sqliteStores(db, config.timeZone),
    oauth: new SqliteOAuthStore(db),
    owner: ownerAuth(db, config, now),
    redirectUris: deps.mcpRedirectUris,
    now: () => now().getTime(),
  });
  const cloudflare = requireCloudflare(config.originSecret);
  return (
    new Hono()
      // /mcp, /oauth and /.well-known live outside /api, so the Cloudflare check guards them here too.
      .use((c, next) => (c.req.path === "/api/health" ? next() : cloudflare(c, next)))
      .route("/", createApp(deps))
      .route("/", mcp)
  );
}
