import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { serve } from "@hono/node-server";
import { count } from "drizzle-orm";
import { audioWorker, httpSpeaker } from "./cardAudio.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db/client.js";
import { optimizerWorker } from "./fsrsOptimizer.js";
import { authCredentials } from "./db/schema.js";
import { createServer } from "./server.js";

const config = loadConfig();
if (config.databasePath !== ":memory:") mkdirSync(dirname(config.databasePath), { recursive: true });
const db = openDb(config.databasePath);

// Until the first passkey is bound, anyone holding this code can bind one. It is printed
// only to the server log, which only the owner can read.
const needsSetup = (db.select({ n: count() }).from(authCredentials).get()?.n ?? 0) === 0;
const setupCode = needsSetup ? (config.setupCode ?? randomBytes(18).toString("base64url")) : undefined;
if (setupCode && !config.setupCode) console.log(`No passkey yet. One-time setup code: ${setupCode}`);

const server = createServer({
  db,
  config,
  setupCode,
  mcpRedirectUris: process.env.MCP_REDIRECT_URIS?.split(",").map((uri) => uri.trim()),
  mcpAllowLoopback: process.env.MCP_ALLOW_LOOPBACK !== "0",
});

// Reference audio for new and changed cards, made by the scorer in the background.
audioWorker(db, httpSpeaker(config.scorerUrl)).start();
// Personal FSRS weights once a mode has enough reviews; FSRS defaults until then.
optimizerWorker(db, config.timeZone).start();

const port = Number(process.env.PORT ?? 8787);
// Bound to localhost: only Caddy on the same host may reach the API.
serve({ fetch: server.fetch, port, hostname: process.env.HOST ?? "127.0.0.1" }, (info) => {
  console.log(`api listening on http://${info.address}:${info.port}`);
});
