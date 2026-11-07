import { Hono } from "hono";
import { z } from "zod";
import type { AuthVariables } from "../auth/sessions.js";
import { getCardAudio } from "../cardAudio.js";
import { cardCounts, cardFamily, createCards, deleteCard, getCard, listCards, listTags, updateCard } from "../cardStore.js";
import { CARD_KINDS, newCardSchema, parseBulk } from "../cards.js";
import type { Db } from "../db/client.js";
import { answerLearning, introduceEarly, introduceLearned, learningWords } from "../newCards.js";
import { linkParts } from "../phrases.js";
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
  kind: z.enum(CARD_KINDS).optional(),
});

const learnedBody = z.object({
  cardIds: z.array(z.number().int().positive()).min(1).max(200),
  missed: z.array(z.number().int().positive()).max(200).default([]),
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

export function cardRoutes(db: Db, now: () => Date, timeZone: string) {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.get("/", (c) => {
    const query = listQuery.safeParse(c.req.query());
    if (!query.success) return c.json({ error: "invalid_request", issues: query.error.issues }, 400);
    return c.json(listCards(db, c.get("user").id, query.data));
  });

  // The new words for a session: due for their check, then being learned, filled up from the pool.
  app.get("/learning", (c) => c.json(learningWords(db, c.get("user").id, now())));

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
    const userId = c.get("user").id;
    const card = id.success ? getCard(db, userId, id.data) : undefined;
    if (!card) return c.json({ error: "not_found" }, 404);
    // A phrase's pieces come with the user's card for each word, to open it from the phrase.
    return c.json({ card: card.parts ? { ...card, parts: linkParts(db, userId, card.parts) } : card });
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

  // One answer for a word being learned: up the ladder, one step down, or into reviews (newCards.ts).
  app.post("/:id/learning", async (c) => {
    const id = idParam.safeParse(c.req.param("id"));
    const body = z.object({ ok: z.boolean() }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_request", issues: body.error.issues }, 400);
    const result = id.success ? answerLearning(db, c.get("user").id, id.data, body.data.ok, now(), timeZone) : { status: "not_found" as const };
    if (result.status === "not_found") return c.json({ error: "not_found" }, 404);
    if (result.status === "not_queued") return c.json({ error: "not_queued" }, 409);
    return c.json(result);
  });

  // Words just learned in "Учить" for a group enter reviews: tomorrow, or later today the ones missed on the way.
  // Cards already in reviews are left alone.
  app.post("/learned", async (c) => {
    const body = learnedBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_request", issues: body.error.issues }, 400);
    const ids = introduceLearned(db, c.get("user").id, body.data.cardIds, body.data.missed, now(), timeZone);
    return c.json({ introduced: ids });
  });

  // Pulls a card in from the new words into reviews now, unlearned.
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
