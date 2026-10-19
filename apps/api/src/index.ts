import { serve } from "@hono/node-server";
import { app } from "./app.js";

const port = Number(process.env.PORT ?? 8787);
// Bound to localhost: only Caddy on the same host may reach the API.
serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? "127.0.0.1" }, (info) => {
  console.log(`api listening on http://${info.address}:${info.port}`);
});
