import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CARD_KINDS, EXAMPLES_PER_CARD, MAX_PARTS, MAX_ROOTS, newCardSchema, normalizeKorean, phrasePartSchema, REGISTERS, rootSchema, type NewCard, type Root } from "../cards.js";
import { MAX_DRILLS_PER_CALL, newDrillSchema } from "../practice.js";
import { MAX_SIMILAR, similarNoteSchema } from "../similar.js";
import type { CardStore, DrillStore, NewDrill, SharingStore, SimilarPair } from "./store.js";

export const MAX_CARDS_PER_CALL = 50;

// Told to Claude once per connection, so cards from chat match the ones made in the app.
const instructions = `KQuiz is the user's personal Korean flashcard deck; each person who connects it sees only their own cards. Cards are reviewed for meaning and, when speakable, for pronunciation.
- korean: the word or phrase in Hangul only (no hanja, Latin letters or brackets). Use dictionary form for verbs and adjectives unless the user asks otherwise.
- meaning: a short Russian translation, the most common sense first.
- pronunciation (optional): how it is actually said, in Hangul without brackets (the app adds them), only when it differs from the spelling (e.g. 읽다 → 익따). Leave it out when it sounds as written.
- examples (required, exactly ${EXAMPLES_PER_CARD}): short natural Korean sentences that use the word, each with its Russian translation, as {"ko", "ru"}. Vary the forms and situations, keep them at the user's level. Every add_cards card and every update_card call must carry all ${EXAMPLES_PER_CARD}; when editing, send the card's current examples again if they stay as they are.
- notes (optional), in Russian, one point per line. The app lays them out by kind: a line opening with a mark goes under that mark's heading, any other line is a plain remark shown first. Marks: "≠" a word not to mix up with (Не путать), "↔" the opposite (Противоположность), "≈" a word near in meaning or a synonym (Близкие по смыслу), "+" a set expression or collocation with the word (Выражения), "=" the literal meaning (Дословно), "!" a trap: a homonym, an exception (Внимание). After ≠ ↔ ≈ + put the Korean first, then " — " and a short Russian gloss: "≠ 밑 — прямо под, вплотную", "↔ 위 — верх", "+ 아래층 — нижний этаж". Keep each line short; usage advice goes in a plain line. Example for 아래:
Просто «ниже», пара к 위. Часто взаимозаменяемо с 밑.
≠ 밑 — прямо под, вплотную; ещё «дно»
↔ 위 — верх
+ 아래층 — нижний этаж
+ 아래요 — «ниже» (на кассе)
A word linked with similar is already shown under Не путать with its note, so a ≠ line for it is only for what the pair's note doesn't say.
- tags: lowercase topics such as "еда" or "глаголы".
- roots: the Sino-Korean roots of the word, one per syllable that comes from hanja, as {"ko", "hanja", "meaning"}: the syllable, its character and a short Russian gloss of the character, e.g. 학교 → [{"ko":"학","hanja":"學","meaning":"учёба"},{"ko":"교","hanja":"校","meaning":"школа"}]. Use the traditional character the word is really written with, and the same gloss for the same character across cards, so the app can link a word to others with that root (its word family). A native Korean word (사랑, 먹다) or a loanword gets []. For a mixed word list only the hanja syllables (공부하다 → 공 工, 부 夫). Give roots for every card you add.
- similar (optional): the user's other words easy to mix up with this one, as {"korean", "note"}: two words for near things (휴지통 / 쓰레기통, 아래 / 밑, 안 / 속, 책장 / 선반) or two words for one thing (공책 / 노트). note says in Russian how the two differ, the same note for both words of the pair, e.g. "휴지통 — корзина для бумаг у стола; 쓰레기통 — мусорное ведро на кухне или улице". A link goes both ways, so give it on one card of the pair. The app shows the pair on both cards, puts the other word among the options when the user picks the Korean for the Russian, and when the user answers with the other word it says which word that was and asks for the right one instead of counting a mistake. So keep each word's meaning distinct, and link the pair even when it is distinct. Whenever you add a word with such a neighbour, link them; to link or unlink words already in the deck, or change a note, use link_similar.
Cards added here don't enter reviews at once: they wait in a pool of new words and the app teaches them a few at a time, in the order added; a word enters reviews only once the user has learned it. So adding many words at once is fine.
Call find_cards before adding words the user may already have; add_cards also reports duplicates. To fix a card, use update_card instead of adding a new one: any field can be changed, and an empty string clears pronunciation, romanization or notes. Cards cannot be deleted from here.
When the user asks to fix hard cards, call get_leeches and rework each with update_card: a clearer meaning, a mnemonic or the confusing neighbour in notes (and link it with link_similar when it is a similar word), ${EXAMPLES_PER_CARD} fresh examples. A card that mixes two senses can be split: narrow it with update_card and add the other sense with add_cards. If a card should go, tell the user; only they can delete it in the app.
Older cards may have no roots yet: when the user asks to fill them in, page through find_cards with without_roots and send them with set_roots, 50 at a time, until none are left.
When the user asks for practice on sounds they confuse (ㄱ/ㅋ/ㄲ, ㅓ/ㅗ…), add listening drills with add_sound_drills.
Set phrases learned whole (안녕히 가세요, 잘 먹겠습니다, 화장실이 어디예요?) go in with add_phrases, not add_cards. A phrase has no examples: instead parts breaks it into its pieces in order, exactly as written in the phrase, each with its dictionary form (base) when that differs and a short Russian gloss, e.g. 어떻게 지내요? → [{"ko":"어떻게","meaning":"как"},{"ko":"지내요","base":"지내다","meaning":"поживать"}]. The app links each piece to the user's card for that word and builds the phrase from these pieces, mixed with wrong ones, in reviews (Russian → Korean, and by ear). register is how polite it is: formal (합쇼체), polite (해요체) or casual (반말); notes say when it is said and the reply it usually gets. Keep the phrase in the form it is really said, not the dictionary form. When editing a phrase with update_card, send parts instead of examples.`;

const cardInput = z.object({
  korean: z.string(),
  meaning: z.string(),
  pronunciation: z.string().optional(),
  romanization: z.string().optional(),
  notes: z.string().optional().describe("Russian, one point per line; ≠ ↔ ≈ + = ! marks as in the server instructions"),
  tags: z.array(z.string()).optional(),
  roots: z
    .array(
      z.object({
        ko: z.string().describe("One Hangul syllable of the word"),
        hanja: z.string().describe("Its hanja character"),
        meaning: z.string().describe("Short Russian gloss of the character"),
      }),
    )
    .max(MAX_ROOTS)
    .optional()
    .describe("Sino-Korean roots; [] for a native word or loanword"),
});

// Claude has to write examples for every card it adds or edits, so a word is never learned out of context.
const examplesInput = z
  .array(
    z.object({
      ko: z.string().describe("Korean sentence that uses the word"),
      ru: z.string().describe("Its Russian translation"),
    }),
  )
  .length(EXAMPLES_PER_CARD)
  .describe(`Exactly ${EXAMPLES_PER_CARD} example sentences`);

const similarInput = z
  .array(
    z.object({
      korean: z.string().describe("The other word, as on its card; it can be added in the same call"),
      note: z.string().optional().describe("How the two differ, in Russian; the same note shows on both cards"),
    }),
  )
  .max(MAX_SIMILAR)
  .describe("Words of the user's easy to mix up with this one; linked both ways");

const newCardInput = cardInput.extend({ examples: examplesInput, similar: similarInput.optional() });

const similarPairInput = z.object({
  korean: z.string().describe("One word of the pair, as on its card"),
  other: z.string().describe("The other word, as on its card"),
  note: z.string().optional().describe("How the two differ, in Russian; left out keeps the old note, empty clears it"),
  remove: z.boolean().optional().describe("true takes the link off"),
});

const partsInput = z
  .array(
    z.object({
      ko: z.string().describe("The piece exactly as written in the phrase"),
      base: z.string().optional().describe("Its dictionary form, when it differs (가세요 → 가다)"),
      meaning: z.string().describe("Short Russian gloss"),
    }),
  )
  .min(1)
  .max(MAX_PARTS)
  .describe("The phrase's pieces in order; together they spell the phrase");

const registerInput = z.enum(REGISTERS).describe("formal: 합쇼체, polite: 해요체, casual: 반말");

const newPhraseInput = z.object({
  korean: z.string().describe("The phrase in Hangul, as it is said"),
  meaning: z.string().describe("Russian translation"),
  parts: partsInput,
  register: registerInput.optional(),
  notes: z.string().optional().describe("When it is said, the usual reply, anything worth remembering"),
  tags: z.array(z.string()).optional(),
});

const phraseSchema = newCardSchema
  .pick({ korean: true, meaning: true, notes: true, tags: true, register: true })
  .extend({ parts: z.array(phrasePartSchema).min(1).max(MAX_PARTS) });

const requiredExamples = newCardSchema.extend({ examples: newCardSchema.shape.examples.unwrap().length(EXAMPLES_PER_CARD) });

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function error(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

/** Validates, drops repeats and existing cards, stores the rest as new words, waiting to be learned. */
async function addAll<T extends { korean: string; similar?: { korean: string; note?: string }[] }>(
  store: CardStore,
  inputs: T[],
  parse: (input: T) => { success: true; data: NewCard } | { success: false; error: z.ZodError },
) {
  const rejected: { korean: string; reason: string }[] = [];
  const valid = new Map<string, NewCard>();
  const similarOf = new Map<NewCard, { korean: string; note?: string }[]>();
  for (const input of inputs) {
    const parsed = parse(input);
    const note = input.similar?.find((s) => !similarNoteSchema.safeParse(s.note ?? "").success);
    if (!parsed.success || note) {
      rejected.push({ korean: input.korean, reason: parsed.success ? "similar note: at most 300 characters" : z.prettifyError(parsed.error) });
      continue;
    }
    if (input.similar?.length) similarOf.set(parsed.data, input.similar);
    const key = normalizeKorean(parsed.data.korean);
    if (valid.has(key)) rejected.push({ korean: input.korean, reason: "repeated in this batch" });
    else valid.set(key, parsed.data);
  }

  const existing = await store.findByKorean([...valid.keys()]);
  const fresh = [...valid].filter(([key]) => !existing.has(key)).map(([, card]) => card);
  const created = await store.insert(fresh, "claude");
  // Links once every card of the batch is in, so a pair added together links too.
  const pairs = [...valid.values()].flatMap((card) => (similarOf.get(card) ?? []).map((s) => ({ korean: card.korean, other: s.korean, note: s.note })));
  const similar = pairs.length ? await store.linkSimilar(pairs) : undefined;
  return json({
    created: created.map(({ id, korean, meaning, speakable, queued }) => ({ id, korean, meaning, speakable, queued })),
    duplicates: [...existing.values()].map(({ id, korean, meaning }) => ({ id, korean, meaning })),
    rejected,
    ...(similar ? { similar } : {}),
  });
}

export function createMcpServer(store: CardStore, drills?: DrillStore, sharing?: SharingStore): McpServer {
  const server = new McpServer({ name: "kquiz", version: "0.1.0" }, { instructions });

  server.registerTool(
    "add_cards",
    {
      title: "Add cards",
      description: `Adds up to ${MAX_CARDS_PER_CALL} Korean flashcards to the pool of new words: the app teaches them a few at a time, in the order added, and they enter reviews once learned. Every card needs exactly ${EXAMPLES_PER_CARD} examples. similar links a card to the user's words easy to mix up with it (already in the deck or in this call). Returns created cards, duplicates of existing cards, rejected ones with the reason, and how the similar links went.`,
      inputSchema: { cards: z.array(newCardInput).min(1).max(MAX_CARDS_PER_CALL) },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ cards }) => addAll(store, cards, (input) => requiredExamples.safeParse(input)),
  );

  server.registerTool(
    "add_phrases",
    {
      title: "Add phrases",
      description: `Adds up to ${MAX_CARDS_PER_CALL} set Korean phrases, learned whole, to the new-card queue. Each needs parts, its breakdown into pieces (no examples). In reviews the user builds the phrase from those pieces mixed with wrong ones, from the Russian and by ear. Returns created phrases, duplicates of existing cards and rejected ones with the reason.`,
      inputSchema: { phrases: z.array(newPhraseInput).min(1).max(MAX_CARDS_PER_CALL) },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ phrases }) =>
      addAll(store, phrases, (input) => {
        const parsed = phraseSchema.safeParse(input);
        return parsed.success ? { success: true as const, data: { ...parsed.data, kind: "phrase" as const } } : parsed;
      }),
  );

  server.registerTool(
    "find_cards",
    {
      title: "Find cards",
      description: "Searches cards by Korean text, translation or tag; each card comes with its similar words, if any. With no filters, returns the most recent cards.",
      inputSchema: {
        query: z.string().trim().max(200).optional().describe("Substring of korean, meaning, pronunciation or romanization"),
        kind: z.enum(CARD_KINDS).optional().describe("Only words, or only phrases"),
        tag: z.string().trim().max(50).optional(),
        root: z.string().trim().max(4).optional().describe("A hanja character: cards with this root, i.e. its word family"),
        without_roots: z.boolean().optional().describe("Only cards whose roots were never filled in"),
        limit: z.number().int().min(1).max(100).default(20),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, kind, tag, root, without_roots, limit }) =>
      json({
        cards: await store.find({ text: query || undefined, kind, tag: tag || undefined, root: root || undefined, withoutRoots: without_roots, limit }),
      }),
  );

  server.registerTool(
    "set_roots",
    {
      title: "Set roots",
      description: `Sets the Sino-Korean roots of up to ${MAX_CARDS_PER_CALL} cards at once, without touching anything else on them (for filling in older cards; see find_cards without_roots). [] marks a native word or loanword. Returns the ids saved, and the ids not found or rejected with the reason.`,
      inputSchema: {
        cards: z
          .array(z.object({ id: z.string().min(1), roots: cardInput.shape.roots.unwrap() }))
          .min(1)
          .max(MAX_CARDS_PER_CALL),
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ cards }) => {
      const rejected: { id: string; reason: string }[] = [];
      const valid: { id: string; roots: Root[] }[] = [];
      for (const input of cards) {
        const parsed = z.array(rootSchema).safeParse(input.roots);
        if (parsed.success) valid.push({ id: input.id, roots: parsed.data });
        else rejected.push({ id: input.id, reason: z.prettifyError(parsed.error) });
      }
      const { saved, notFound } = await store.setRoots(valid);
      return json({ saved, notFound, rejected });
    },
  );

  server.registerTool(
    "link_similar",
    {
      title: "Link similar words",
      description: `Links pairs of the user's cards as similar words, easy to mix up (휴지통 / 쓰레기통, 아래 / 밑, 공책 / 노트), with a Russian note on how the two differ; or changes the note, or with remove takes a link off. Each word is named by its Korean text as on its card, and both must already be cards. A link goes both ways; a card can have at most ${MAX_SIMILAR}. It is not an edit of either card. Returns the pairs linked, unlinked and rejected with the reason. find_cards shows each card's similar words.`,
      inputSchema: { pairs: z.array(similarPairInput).min(1).max(MAX_CARDS_PER_CALL) },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ pairs }) => {
      const rejected: { korean: string; other: string; reason: string }[] = [];
      const valid: SimilarPair[] = [];
      for (const pair of pairs) {
        if (!similarNoteSchema.safeParse(pair.note ?? "").success) rejected.push({ korean: pair.korean, other: pair.other, reason: "note: at most 300 characters" });
        else valid.push(pair);
      }
      const result = valid.length ? await store.linkSimilar(valid) : { linked: [], unlinked: [], rejected: [] };
      return json({ ...result, rejected: [...rejected, ...result.rejected] });
    },
  );

  server.registerTool(
    "update_card",
    {
      title: "Update card",
      description: `Edits one card found with find_cards: Korean, meaning, pronunciation, romanization, notes, tags, examples or speakable, and for a phrase parts and register. Only the given fields change; tags replace the old list; an empty string clears pronunciation, romanization or notes. Every call on a word must include exactly ${EXAMPLES_PER_CARD} examples (resend the current ones if they stay); a phrase takes no examples. Similar words are linked with link_similar, not here.`,
      inputSchema: {
        id: z.string().min(1),
        changes: cardInput
          .partial()
          .extend({
            examples: examplesInput.optional().describe(`Exactly ${EXAMPLES_PER_CARD} example sentences; required for a word, not for a phrase`),
            parts: partsInput.optional().describe("A phrase's pieces in order"),
            register: registerInput.optional(),
            speakable: z.boolean().optional(),
          }),
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ id, changes: { speakable, ...rest } }) => {
      const current = await store.get(id);
      if (!current) return error(`Card ${id} not found`);
      const phrase = current.kind === "phrase";
      if (phrase && rest.examples) return error("A phrase has no examples; send parts instead");
      if (!phrase && (rest.parts || rest.register)) return error("parts and register are for phrases only");
      const schema = phrase ? newCardSchema.partial() : requiredExamples.partial().required({ examples: true });
      const parsed = schema.safeParse(rest);
      if (!parsed.success) return error(z.prettifyError(parsed.error));
      // partial() keeps the tags default, which would wipe tags on every update.
      const patch = Object.fromEntries(
        Object.entries({ ...parsed.data, tags: rest.tags && parsed.data.tags, speakable }).filter(([, v]) => v !== undefined),
      );
      const card = await store.update(id, patch);
      return card ? json({ card }) : error(`Card ${id} not found`);
    },
  );

  server.registerTool(
    "get_weak_sounds",
    {
      title: "Get weak sounds",
      description: "Sounds the user mispronounces most often, to pick practice words for them.",
      inputSchema: { limit: z.number().int().min(1).max(30).default(10) },
      annotations: { readOnlyHint: true },
    },
    async ({ limit }) => json({ sounds: await store.weakSounds(limit) }),
  );

  server.registerTool(
    "get_leeches",
    {
      title: "Get hard cards",
      description:
        "Cards the user keeps forgetting (leeches): forgotten on several different days since the card was last edited, per mode (meaning: recalling the translation; speech: saying it in Korean; listening: understanding it by ear). Rework them with update_card; an edit gives a card a fresh start and takes it off this list.",
      inputSchema: { limit: z.number().int().min(1).max(50).default(20) },
      annotations: { readOnlyHint: true },
    },
    async ({ limit }) => json({ cards: await store.hardCards(limit) }),
  );

  server.registerTool(
    "get_stats",
    {
      title: "Get stats",
      description:
        "Number of cards, cards due now in each mode, cards waiting in the new-card queue and how many enter reviews per day, the current streak in days, reviews coming due in the next 7 days, and the share of reviews recalled over the last 30 days (FSRS aims for 0.9).",
      annotations: { readOnlyHint: true },
    },
    async () => json(await store.stats(new Date())),
  );

  if (drills) registerDrillTools(server, drills);
  if (sharing) registerSharingTools(server, sharing);

  return server;
}

// Only the owner's connector: the owner starts a friend's deck with copies of their own words.
function registerSharingTools(server: McpServer, sharing: SharingStore) {
  server.registerTool(
    "list_members",
    {
      title: "List members",
      description: "The people the owner invited to KQuiz, with how many cards each has. Use the id with share_cards.",
      annotations: { readOnlyHint: true },
    },
    async () => json({ members: await sharing.members() }),
  );

  server.registerTool(
    "share_cards",
    {
      title: "Share cards with a member",
      description: `Copies up to ${MAX_CARDS_PER_CALL} of the owner's cards (ids from find_cards) into a member's deck as fresh new words, in the order given: everything on the card (meaning, examples, notes, tags, roots, phrase parts) but no schedule or review history, so the member learns them from scratch. Similar-word links between the shared cards are copied too. Words the member already has are left alone and reported as duplicates. The owner's cards don't change. Only the owner can share.`,
      inputSchema: {
        member_id: z.string().min(1).describe("From list_members"),
        card_ids: z.array(z.string().min(1)).min(1).max(MAX_CARDS_PER_CALL),
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ member_id, card_ids }) => {
      try {
        const result = await sharing.share(member_id, card_ids);
        return result ? json(result) : error(`No active member ${member_id}; see list_members`);
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e));
      }
    },
  );
}

// Sound drills: the app plays one word of a set aloud and the user picks which one it was.
function registerDrillTools(server: McpServer, drills: DrillStore) {
  server.registerTool(
    "add_sound_drills",
    {
      title: "Add sound drills",
      description: `Adds up to ${MAX_DRILLS_PER_CALL} listening drills on sounds the user confuses. Each drill is 2-4 Korean words that differ in exactly one sound, e.g. 불/풀/뿔 for ㅂ/ㅍ/ㅃ or 거리/고리 for ㅓ/ㅗ; the app plays one and the user picks which. Prefer real, common words and the user's own cards (find_cards); use get_weak_sounds to choose the contrasts. contrast names the sounds as shown to the user, e.g. "ㅂ/ㅍ/ㅃ". meaning is a short Russian gloss. Drills cannot be deleted from here; list_sound_drills shows existing ones.`,
      inputSchema: {
        drills: z
          .array(
            z.object({
              contrast: z.string().describe('The contrasted sounds, e.g. "ㄱ/ㅋ/ㄲ"'),
              words: z
                .array(z.object({ korean: z.string(), meaning: z.string().optional() }))
                .min(2)
                .max(4),
            }),
          )
          .min(1)
          .max(MAX_DRILLS_PER_CALL),
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ drills: inputs }) => {
      const rejected: { words: string[]; reason: string }[] = [];
      const valid: NewDrill[] = [];
      for (const input of inputs) {
        const parsed = newDrillSchema.safeParse(input);
        if (parsed.success) valid.push(parsed.data);
        else rejected.push({ words: input.words.map((w) => w.korean), reason: z.prettifyError(parsed.error) });
      }
      const result = valid.length ? await drills.add(valid) : { created: [], duplicates: [] };
      return json({ ...result, rejected });
    },
  );

  server.registerTool(
    "list_sound_drills",
    {
      title: "List sound drills",
      description: "All listening drills with how often the user picked the right word, the hardest first.",
      annotations: { readOnlyHint: true },
    },
    async () => json({ drills: await drills.list() }),
  );
}
