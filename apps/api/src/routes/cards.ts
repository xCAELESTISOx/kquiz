import { Hono } from "hono";
import { z } from "zod";
import type { AuthVariables } from "../auth/sessions.js";
import { getCardAudio } from "../cardAudio.js";
import { cardCounts, cardFamily, createCards, deleteCard, getCard, listCards, listTags, updateCard } from "../cardStore.js";
import { newCardSchema, parseBulk } from "../cards.js";
import type { Db } from "../db/client.js";
import { introduceEarly } from "../newCards.js";
import { isExtraVoice } from "../voices.js";

export const MAX_BATCH = 50;

const idParam = z.coerce.number().int().positive();

const listQuery = z.object({
  q: z.string().trim().max(200).optional(),
  tag: z.string().trim().max(50).optional(),
  root: z.string().trim().max(4).optional(),
  notReady: z
    .enum(["1", "true"])
    .optional()
    .transform((v) => v !== undefined),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  before: z.coerce.number().int().positive().optional(),
  status: z.enum(["queued", "paused"]).optional(),
});

// Pausing is the owner's call, so `suspended` is only in the app's patch, not in Claude's.
const appPatchSchema = newCardSchema
  .extend({ tags: newCardSchema.shape.tags.unwrap(), suspended: z.boolean() })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, "nothing to update");

const bulkBody = z.union([
  z.object({ text: z.string().max(100_000) }),
  z.object({ cards: z.array(z.unknown()).min(1).max(MAX_BATCH) }),
]);

export function cardRoutes(db: Db, now: () => Date) {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.get("/", (c) => {
    const query = listQuery.safeParse(c.req.query());
    if (!query.success) return c.json({ error: "invalid_request", issues: query.error.issues }, 400);
    return c.json(listCards(db, c.get("user").id, query.data));
  });

  // For the filter chips of the cards screen.
  app.get("/summary", (c) => {
    const userId = c.get("user").id;
    return c.json({ counts: cardCounts(db, userId), tags: listTags(db, userId) });
  });

  app.post("/", async (c) => {
    const body = newCardSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_request", issues: body.error.issues }, 400);
    const { created, duplicates } = createCards(db, c.get("user").id, [body.data], "app", now());
    if (duplicates[0]) return c.json({ error: "duplicate", existingId: duplicates[0].existingId }, 409);
    return c.json({ card: created[0] }, 201);
  });

  app.post("/bulk/preview", async (c) => {
    const body = z.object({ text: z.string().max(100_000) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_request" }, 400);
    return c.json(parseBulk(body.data.text));
  });

  // Either pasted lines (`한국어 — перевод`) or ready card objects; at most MAX_BATCH cards.
  app.post("/bulk", async (c) => {
    const body = bulkBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_request", issues: body.error.issues }, 400);
    let valid: z.infer<typeof newCardSchema>[];
    let rejected: { input: unknown; reason: string }[];
    if ("text" in body.data) {
      const parsed = parseBulk(body.data.text);
      valid = parsed.cards;
      rejected = parsed.rejected.map((line) => ({ input: line, reason: "unparsed_line" }));
    } else {
      valid = [];
      rejected = [];
      for (const input of body.data.cards) {
        const card = newCardSchema.safeParse(input);
        if (card.success) valid.push(card.data);
        else rejected.push({ input, reason: card.error.issues[0]?.message ?? "invalid" });
      }
    }
    if (valid.length > MAX_BATCH) return c.json({ error: "too_many_cards", max: MAX_BATCH }, 400);
    const result = createCards(db, c.get("user").id, valid, "bulk", now());
    return c.json({ ...result, rejected });
  });

  app.get("/:id", (c) => {
    const id = idParam.safeParse(c.req.param("id"));
    const card = id.success ? getCard(db, c.get("user").id, id.data) : undefined;
    return card ? c.json({ card }) : c.json({ error: "not_found" }, 404);
  });

  // Other cards that share a root with this one, per root (cardStore.ts cardFamily).
  app.get("/:id/family", (c) => {
    const id = idParam.safeParse(c.req.param("id"));
    const families = id.success ? cardFamily(db, c.get("user").id, id.data) : undefined;
    return families ? c.json({ families }) : c.json({ error: "not_found" }, 404);
  });

  // Reference audio (cardAudio.ts), or with ?voice= the word in another voice (voices.ts). 404 until
  // the worker has made it; the app then uses the default voice or the phone's.
  app.get("/:id/audio", (c) => {
    const id = idParam.safeParse(c.req.param("id"));
    const voice = c.req.query("voice");
    if (voice !== undefined && !isExtraVoice(voice)) return c.json({ error: "not_found" }, 404);
    const audio = id.success ? getCardAudio(db, c.get("user").id, id.data, voice) : undefined;
    if (!audio) return c.json({ error: "not_found" }, 404);
    const headers = { "cache-control": "private, no-cache", etag: audio.etag };
    if (c.req.header("if-none-match") === audio.etag) return c.body(null, 304, headers);
    return c.body(audio.data as Uint8Array<ArrayBuffer>, 200, { ...headers, "content-type": audio.mime });
  });

  app.patch("/:id", async (c) => {
    const id = idParam.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "not_found" }, 404);
    const patch = appPatchSchema.safeParse(await c.req.json().catch(() => null));
    if (!patch.success) return c.json({ error: "invalid_request", issues: patch.error.issues }, 400);
    const result = updateCard(db, c.get("user").id, id.data, patch.data, now());
    if ("card" in result) return c.json(result);
    if (result.error === "duplicate") return c.json(result, 409);
    return c.json(result, 404);
  });

  // Pulls a card out of the new-card queue into reviews now, past the daily allowance.
  app.post("/:id/introduce", (c) => {
    const id = idParam.safeParse(c.req.param("id"));
    const userId = c.get("user").id;
    const result = id.success ? introduceEarly(db, userId, id.data, now()) : "not_found";
    if (result === "not_found") return c.json({ error: "not_found" }, 404);
    if (result === "not_queued") return c.json({ error: "not_queued" }, 409);
    return c.json({ card: getCard(db, userId, id.data!) });
  });

  // Only the app deletes cards; the MCP server for Claude has no delete (docs/PLAN.md §6).
  app.delete("/:id", (c) => {
    const id = idParam.safeParse(c.req.param("id"));
    if (!id.success || !deleteCard(db, c.get("user").id, id.data)) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  });

  return app;
}
