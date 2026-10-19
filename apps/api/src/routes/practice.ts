import { Hono } from "hono";
import { z } from "zod";
import type { AuthVariables } from "../auth/sessions.js";
import type { Db } from "../db/client.js";
import { deleteDrill, getSpeechAudio, listDrills, recordDrillAnswer, shadowingItems } from "../practice.js";

const idParam = z.coerce.number().int().positive();

/** Shadowing and sound drills (practice.ts). Nothing here touches the review schedule. */
export function practiceRoutes(db: Db, now: () => Date) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // Reference audio of an example sentence or a drill word; 404 until the worker has made it.
  app.get("/audio", (c) => {
    const text = z.string().min(1).max(300).safeParse(c.req.query("text"));
    const audio = text.success ? getSpeechAudio(db, text.data) : undefined;
    if (!audio) return c.json({ error: "not_found" }, 404);
    const headers = { "cache-control": "private, max-age=86400", etag: audio.etag };
    if (c.req.header("if-none-match") === audio.etag) return c.body(null, 304, headers);
    return c.body(audio.data as Uint8Array<ArrayBuffer>, 200, { ...headers, "content-type": audio.mime });
  });

  app.get("/shadowing", (c) => {
    const limit = z.coerce.number().int().min(1).max(50).default(10).safeParse(c.req.query("limit"));
    if (!limit.success) return c.json({ error: "invalid_request" }, 400);
    return c.json({ items: shadowingItems(db, limit.data) });
  });

  app.get("/drills", (c) => c.json({ drills: listDrills(db) }));

  app.post("/drills/:id/answers", async (c) => {
    const id = idParam.safeParse(c.req.param("id"));
    const body = z.object({ correct: z.boolean() }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_request" }, 400);
    if (!id.success || !recordDrillAnswer(db, id.data, body.data.correct, now())) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  });

  // Only the app deletes drills; Claude can add them but not remove them.
  app.delete("/drills/:id", (c) => {
    const id = idParam.safeParse(c.req.param("id"));
    if (!id.success || !deleteDrill(db, id.data)) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  });

  return app;
}
