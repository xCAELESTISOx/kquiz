import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { newCardSchema, normalizeKorean, type NewCard } from "../cards.js";
import type { CardStore } from "./store.js";

export const MAX_CARDS_PER_CALL = 50;

// Told to Claude once per connection, so cards from chat match the ones made in the app.
const instructions = `KQuiz is the owner's personal Korean flashcard deck. Cards are reviewed for meaning and, when speakable, for pronunciation.
- korean: the word or phrase in Hangul only (no hanja, Latin letters or brackets). Use dictionary form for verbs and adjectives unless the owner asks otherwise.
- meaning: a short Russian translation, the most common sense first.
- pronunciation (optional): how it is actually said, in Hangul, only when it differs from the spelling (e.g. 읽다 → [익따]).
- example_ko / example_meaning (optional): one short natural sentence and its Russian translation.
- tags: lowercase topics such as "еда" or "глаголы".
Call find_cards before adding words the owner may already have; add_cards also reports duplicates. Cards cannot be deleted from here.`;

const cardInput = z.object({
  korean: z.string(),
  meaning: z.string(),
  pronunciation: z.string().optional(),
  romanization: z.string().optional(),
  example_ko: z.string().optional(),
  example_meaning: z.string().optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

type CardInput = z.infer<typeof cardInput>;

function toNewCard({ example_ko, example_meaning, ...rest }: CardInput) {
  return newCardSchema.safeParse({ ...rest, exampleKo: example_ko, exampleMeaning: example_meaning });
}

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function error(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

export function createMcpServer(store: CardStore): McpServer {
  const server = new McpServer({ name: "kquiz", version: "0.1.0" }, { instructions });

  server.registerTool(
    "add_cards",
    {
      title: "Add cards",
      description: `Adds up to ${MAX_CARDS_PER_CALL} Korean flashcards. Returns created cards, duplicates of existing cards and rejected ones with the reason.`,
      inputSchema: { cards: z.array(cardInput).min(1).max(MAX_CARDS_PER_CALL) },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ cards }) => {
      const rejected: { korean: string; reason: string }[] = [];
      const valid = new Map<string, NewCard>();
      for (const input of cards) {
        const parsed = toNewCard(input);
        if (!parsed.success) {
          rejected.push({ korean: input.korean, reason: z.prettifyError(parsed.error) });
          continue;
        }
        const key = normalizeKorean(parsed.data.korean);
        if (valid.has(key)) rejected.push({ korean: input.korean, reason: "repeated in this batch" });
        else valid.set(key, parsed.data);
      }

      const existing = await store.findByKorean([...valid.keys()]);
      const fresh = [...valid].filter(([key]) => !existing.has(key)).map(([, card]) => card);
      const created = await store.insert(fresh, "claude");
      return json({
        created: created.map(({ id, korean, meaning, speakable }) => ({ id, korean, meaning, speakable })),
        duplicates: [...existing.values()].map(({ id, korean, meaning }) => ({ id, korean, meaning })),
        rejected,
      });
    },
  );

  server.registerTool(
    "find_cards",
    {
      title: "Find cards",
      description: "Searches cards by Korean text, translation or tag. With no filters, returns the most recent cards.",
      inputSchema: {
        query: z.string().trim().max(200).optional().describe("Substring of korean, meaning, pronunciation or romanization"),
        tag: z.string().trim().max(50).optional(),
        limit: z.number().int().min(1).max(100).default(20),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, tag, limit }) => json({ cards: await store.find({ text: query || undefined, tag: tag || undefined, limit }) }),
  );

  server.registerTool(
    "update_card",
    {
      title: "Update card",
      description: "Changes fields of one card found with find_cards. Only the given fields change.",
      inputSchema: {
        id: z.string().min(1),
        changes: cardInput.partial().extend({ speakable: z.boolean().optional() }),
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ id, changes: { example_ko, example_meaning, speakable, ...rest } }) => {
      const parsed = newCardSchema
        .partial()
        .safeParse({ ...rest, exampleKo: example_ko, exampleMeaning: example_meaning });
      if (!parsed.success) return error(z.prettifyError(parsed.error));
      // partial() keeps the tags default, which would wipe tags on every update.
      const patch = Object.fromEntries(
        Object.entries({ ...parsed.data, tags: rest.tags && parsed.data.tags, speakable }).filter(([, v]) => v !== undefined),
      );
      if (Object.keys(patch).length === 0) return error("Nothing to change");
      const card = await store.update(id, patch);
      return card ? json({ card }) : error(`Card ${id} not found`);
    },
  );

  server.registerTool(
    "get_weak_sounds",
    {
      title: "Get weak sounds",
      description: "Sounds the owner mispronounces most often, to pick practice words for them.",
      inputSchema: { limit: z.number().int().min(1).max(30).default(10) },
      annotations: { readOnlyHint: true },
    },
    async ({ limit }) => json({ sounds: await store.weakSounds(limit) }),
  );

  server.registerTool(
    "get_stats",
    {
      title: "Get stats",
      description: "Number of cards, cards due for review in each mode, and the current streak in days.",
      annotations: { readOnlyHint: true },
    },
    async () => json(await store.stats(new Date())),
  );

  return server;
}
