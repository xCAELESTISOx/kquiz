// Reference audio for cards: services/scorer's /tts (Supertonic) makes an MP3 per card, a
// background worker asks for it once and keeps it in card_audio. Until it is there, or when the
// scorer is down, the web app falls back to the phone's own voice.
import { and, asc, eq, isNull, ne, notInArray, or } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { cardAudio, cards } from "./db/schema.js";

export interface Speaker {
  /** MP3 of `text` read aloud. */
  speak(text: string): Promise<Uint8Array>;
}

/** The scorer refused the text itself; asking again won't help. Anything else is worth a retry. */
export class BadTextError extends Error {}

// The scorer gives up after 60 s; a little more here so its own 504 arrives first.
const TIMEOUT_MS = 70_000;

export function httpSpeaker(baseUrl: string, fetchImpl: typeof fetch = fetch): Speaker {
  return {
    async speak(text) {
      const res = await fetchImpl(`${baseUrl}/tts?text=${encodeURIComponent(text)}`, {
        method: "POST",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 422) throw new BadTextError(await res.text());
      if (!res.ok) throw new Error(`scorer /tts answered ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}

export type StoredAudio = { data: Uint8Array; mime: string; etag: string };

/** The card's audio, if it was made from the card's current Korean. */
export function getCardAudio(db: Db, cardId: number): StoredAudio | undefined {
  const row = db
    .select({ data: cardAudio.data, mime: cardAudio.mime, createdAt: cardAudio.createdAt })
    .from(cardAudio)
    .innerJoin(cards, and(eq(cards.id, cardAudio.cardId), eq(cards.korean, cardAudio.text)))
    .where(eq(cardAudio.cardId, cardId))
    .get();
  return row && { data: row.data, mime: row.mime, etag: `"${cardId}-${row.createdAt.getTime()}"` };
}

/** The oldest card with no audio or audio of an earlier version of its Korean. */
export function nextCardWithoutAudio(db: Db, skip: number[] = []): { id: number; korean: string } | undefined {
  return db
    .select({ id: cards.id, korean: cards.korean })
    .from(cards)
    .leftJoin(cardAudio, eq(cardAudio.cardId, cards.id))
    .where(and(or(isNull(cardAudio.cardId), ne(cardAudio.text, cards.korean)), skip.length ? notInArray(cards.id, skip) : undefined))
    .orderBy(asc(cards.id))
    .limit(1)
    .get();
}

export function saveCardAudio(db: Db, cardId: number, text: string, data: Uint8Array, now: Date) {
  const values = { text, mime: "audio/mpeg", data: Buffer.from(data), createdAt: now };
  db.insert(cardAudio)
    .values({ cardId, ...values })
    .onConflictDoUpdate({ target: cardAudio.cardId, set: values })
    .run();
}

// A text the scorer refused is tried again after a day, in case the model or the text changed.
const BAD_TEXT_RETRY_MS = 24 * 60 * 60 * 1000;

/**
 * Makes audio for every card that lacks it, one at a time. One pass stops at the first failure
 * that isn't about the text (scorer down, busy, slow) and waits for the next tick.
 */
export function audioWorker(db: Db, speaker: Speaker, now: () => Date = () => new Date()) {
  const badText = new Map<number, number>();
  let running = false;
  let failing = false;

  async function runOnce(): Promise<number> {
    if (running) return 0;
    running = true;
    let made = 0;
    try {
      for (;;) {
        const t = now().getTime();
        for (const [id, until] of badText) if (until <= t) badText.delete(id);
        const card = nextCardWithoutAudio(db, [...badText.keys()]);
        if (!card) break;
        try {
          const mp3 = await speaker.speak(card.korean);
          // The card may have changed or gone while the audio was being made.
          const current = db.select({ korean: cards.korean }).from(cards).where(eq(cards.id, card.id)).get();
          if (current?.korean === card.korean) saveCardAudio(db, card.id, card.korean, mp3, now());
          made++;
          if (failing) console.log("tts: back to normal");
          failing = false;
        } catch (error) {
          if (error instanceof BadTextError) {
            console.warn(`tts: card ${card.id} refused: ${error.message}`);
            badText.set(card.id, t + BAD_TEXT_RETRY_MS);
            continue;
          }
          // Logged once per outage, not on every tick.
          if (!failing) console.warn(`tts: ${(error as Error).message}; will retry`);
          failing = true;
          break;
        }
      }
    } finally {
      running = false;
    }
    return made;
  }

  return {
    runOnce,
    /** Runs a pass now and then every `intervalMs`; returns a function that stops it. */
    start(intervalMs = 10_000) {
      void runOnce();
      const timer = setInterval(() => void runOnce(), intervalMs);
      timer.unref();
      return () => clearInterval(timer);
    },
  };
}
