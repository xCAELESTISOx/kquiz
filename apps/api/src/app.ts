import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { parseBulk } from "./cards.js";

export const app = new Hono().basePath("/api");

app.use(secureHeaders());
app.use(bodyLimit({ maxSize: 1024 * 1024 }));

app.get("/health", (c) => c.json({ ok: true }));

// Preview only for now: storage and auth arrive in stage 1 (docs/PLAN.md §9).
app.post("/cards/bulk/preview", async (c) => {
  const { text } = await c.req.json<{ text?: string }>();
  if (typeof text !== "string") return c.json({ error: "text is required" }, 400);
  return c.json(parseBulk(text));
});
