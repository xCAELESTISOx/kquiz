import { Hono } from "hono";
import { z } from "zod";
import type { AuthVariables } from "../auth/sessions.js";
import { createCards, deleteCard, getCard, listCards, updateCard } from "../cardStore.js";
import { cardPatchSchema, newCardSchema, parseBulk } from "../cards.js";
import type { Db } from "../db/client.js";

export const MAX_BATCH = 50;

const idParam = z.coerce.number().int().positive();

const listQuery = z.object({
  q: z.string().trim().max(200).optional(),
  tag: z.string().trim().max(50).optional(),
  notReady: z
    .enum(["1", "true"])
    .optional()
    .transform((v) => v !== undefined),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  before: z.coerce.number().int().positive().optional(),
});

const bulkBody = z.union([
  z.object({ text: z.string().max(100_000) }),
  z.object({ cards: z.array(z.unknown()).min(1).max(MAX_BATCH) }),
]);

export function cardRoutes(db: Db, now: () => Date) {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.get("/", (c) => {
    const query = listQuery.safeParse(c.req.query());
    if (!query.success) return c.json({ error: "invalid_request", issues: query.error.issues }, 400);
    return c.json(listCards(db, query.data));
  });

  app.post("/", async (c) => {
    const body = newCardSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_request", issues: body.error.issues }, 400);
    const { created, duplicates } = createCards(db, [body.data], "app", now());
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
    const result = createCards(db, valid, "bulk", now());
    return c.json({ ...result, rejected });
  });

  app.get("/:id", (c) => {
    const id = idParam.safeParse(c.req.param("id"));
    const card = id.success ? getCard(db, id.data) : undefined;
    return card ? c.json({ card }) : c.json({ error: "not_found" }, 404);
  });

  app.patch("/:id", async (c) => {
    const id = idParam.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "not_found" }, 404);
    const patch = cardPatchSchema.safeParse(await c.req.json().catch(() => null));
    if (!patch.success) return c.json({ error: "invalid_request", issues: patch.error.issues }, 400);
    const result = updateCard(db, id.data, patch.data, now());
    if ("card" in result) return c.json(result);
    if (result.error === "duplicate") return c.json(result, 409);
    return c.json(result, 404);
  });

  // Only the app deletes cards; the MCP server for Claude has no delete (docs/PLAN.md §6).
  app.delete("/:id", (c) => {
    const id = idParam.safeParse(c.req.param("id"));
    if (!id.success || !deleteCard(db, id.data)) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  });

  return app;
}
