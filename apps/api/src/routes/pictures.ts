import { Hono } from "hono";
import { z } from "zod";
import type { AuthVariables } from "../auth/sessions.js";
import type { Db } from "../db/client.js";
import { getPicture, importLibrary, libraryEntrySchema, librarySize } from "../pictures.js";

/** Entries per import request: a batch stays under the 1 MB body limit. */
export const MAX_IMPORT_BATCH = 50;

const hashParam = z.string().regex(/^[0-9a-f]{32}$/);
const importSchema = z.object({ entries: z.array(libraryEntrySchema).min(1).max(MAX_IMPORT_BATCH) });

/** Pictures of words: served to anyone signed in, the library filled by the owner. */
export function pictureRoutes(db: Db, now: () => Date) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // A picture is named by the hash of its bytes, so it never changes under its URL: a new picture
  // for a word is a new URL, and the browser keeps each one as long as it likes.
  app.get("/:hash{[0-9a-f]{32}}", (c) => {
    const hash = hashParam.safeParse(c.req.param("hash"));
    const picture = hash.success ? getPicture(db, hash.data) : undefined;
    if (!picture) return c.json({ error: "not_found" }, 404);
    return c.body(picture.data as Uint8Array<ArrayBuffer>, 200, {
      "content-type": picture.mime,
      "cache-control": "private, max-age=31536000, immutable",
    });
  });

  app.get("/library", (c) => c.json({ total: librarySize(db) }));

  // A picture pack goes in a batch at a time (the app reads the pack and sends it in pieces).
  app.post("/library", async (c) => {
    if (c.get("user").role !== "owner") return c.json({ error: "forbidden" }, 403);
    const body = importSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_request", issues: body.error.issues }, 400);
    return c.json(await importLibrary(db, body.data.entries, now()));
  });

  return app;
}
