import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { app } from "./app.js";
import { createMcpApp } from "./mcp/app.js";
import { MemoryOAuthStore } from "./mcp/oauth-store.js";
import { MemoryCardStore } from "./mcp/store.js";

// TODO(stage 1): swap the memory stores and the owner stub for SQLite and the passkey session.
const mcp = createMcpApp({
  publicUrl: process.env.PUBLIC_URL ?? "http://localhost:8787",
  cards: new MemoryCardStore(),
  oauth: new MemoryOAuthStore(),
  owner: {
    // No passkey login yet, so nobody can approve Claude and /mcp stays closed.
    session: async () => null,
    loginUrl: (returnTo) => `/login?return_to=${encodeURIComponent(returnTo)}`,
  },
  redirectUris: process.env.MCP_REDIRECT_URIS?.split(",").map((uri) => uri.trim()),
});

const server = new Hono().route("/", app).route("/", mcp);

const port = Number(process.env.PORT ?? 8787);
// Bound to localhost: only Caddy on the same host may reach the API.
serve({ fetch: server.fetch, port, hostname: process.env.HOST ?? "127.0.0.1" }, (info) => {
  console.log(`api listening on http://${info.address}:${info.port}`);
});
