// Reference audio for cards: services/scorer's /tts (Supertonic) makes an MP3 per card, a
// background worker asks for it once and keeps it in card_audio (examples and drill words go to
// speech_audio, see practice.ts; other voices of card and drill words to voice_audio, see voices.ts).
// Nothing is pruned: a recording outlives its card, so re-adding the word reuses it.
// The web app uses the phone's own voice only while there is no recording at all (404).
import { createHash } from "node:crypto";
import { and, asc, eq, isNull, ne, notInArray, or, sql } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { cardAudio, cards, speechAudio } from "./db/schema.js";
import { nextTextWithoutAudio, saveSpeechAudio } from "./practice.js";
import { OWNER_ID } from "./users.js";
import { EXTRA_VOICES, getVoiceAudio, nextVoiceJob, saveVoiceAudio, type ExtraVoice } from "./voices.js";

export interface Speaker {
  /** MP3 of `text` read aloud, in the scorer's default voice unless `voice` is given. */
  speak(text: string, voice?: ExtraVoice): Promise<Uint8Array>;
}

/** The scorer refused the text itself; asking again won't help. Anything else is worth a retry. */
export class BadTextError extends Error {}

// The scorer gives up after 60 s; a little more here so its own 504 arrives first.
const TIMEOUT_MS = 70_000;

export function httpSpeaker(baseUrl: string, fetchImpl: typeof fetch = fetch): Speaker {
  return {
    async speak(text, voice) {
      const query = `text=${encodeURIComponent(text)}${voice ? `&voice=${voice}` : ""}`;
      const res = await fetchImpl(`${baseUrl}/tts?${query}`, {
        method: "POST",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 422) throw new BadTextError(await res.text());
      if (!res.ok) throw new Error(`scorer /tts answered ${res.status}`);
      // A scorer from before voices ignores the parameter and answers in its default one.
      if (voice && res.headers.get("x-tts-voice") !== voice) throw new Error(`scorer /tts did not use voice ${voice}`);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}

export type StoredAudio = { data: Uint8Array; mime: string; etag: string };

/**
 * The card's audio, if the card is `userId`'s and the audio was made from its current Korean; with
 * `voice`, its word read by that other voice.
 */
export function getCardAudio(db: Db, userId: number, cardId: number, voice?: ExtraVoice): StoredAudio | undefined {
  if (voice) {
    const card = db.select({ korean: cards.korean }).from(cards).where(and(eq(cards.id, cardId), eq(cards.userId, userId))).get();
    return card && getVoiceAudio(db, card.korean, voice);
  }
  const row = db
    .select({ data: cardAudio.data, mime: cardAudio.mime, createdAt: cardAudio.createdAt })
    .from(cardAudio)
    .innerJoin(cards, and(eq(cards.id, cardAudio.cardId), eq(cards.korean, cardAudio.text)))
    .where(and(eq(cardAudio.cardId, cardId), eq(cards.userId, userId)))
    .get();
  if (row) return { data: row.data, mime: row.mime, etag: `"${cardId}-${row.createdAt.getTime()}"` };
  // A word re-added or reworded to a text the library already has: served at once, before the
  // worker has copied it to the card, so the app never falls back to the phone's voice for it.
  const card = db.select({ korean: cards.korean }).from(cards).where(and(eq(cards.id, cardId), eq(cards.userId, userId))).get();
  const data = card && audioForText(db, card.korean);
  return data && { data, mime: "audio/mpeg", etag: `"t-${createHash("sha1").update(data).digest("hex").slice(0, 16)}"` };
}

/**
 * The oldest card with no audio or audio of an earlier version of its Korean. The owner's cards go
 * first, so a member's big batch doesn't hold up the owner's new words.
 */
export function nextCardWithoutAudio(db: Db, skip: number[] = []): { id: number; korean: string } | undefined {
  return db
    .select({ id: cards.id, korean: cards.korean })
    .from(cards)
    .leftJoin(cardAudio, eq(cardAudio.cardId, cards.id))
    .where(and(or(isNull(cardAudio.cardId), ne(cardAudio.text, cards.korean)), skip.length ? notInArray(cards.id, skip) : undefined))
    .orderBy(sql`${cards.userId} <> ${OWNER_ID}`, asc(cards.id))
    .limit(1)
    .get();
}

/**
 * Audio already made for exactly this Korean: another card's (two people learning the same word),
 * or the library's, which keeps recordings of deleted and reworded cards and of examples.
 */
export function audioForText(db: Db, text: string): Uint8Array | undefined {
  return (
    db.select({ data: cardAudio.data }).from(cardAudio).where(eq(cardAudio.text, text)).limit(1).get()?.data ??
    db.select({ data: speechAudio.data }).from(speechAudio).where(eq(speechAudio.text, text)).get()?.data
  );
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

type Job = { key: string; text: string; voice?: ExtraVoice; save(mp3: Uint8Array): void; ready?: Uint8Array };

/**
 * Makes audio for every card that lacks it, one at a time, then for example sentences and drill
 * words (practice.ts), then other voices of card and drill words (voices.ts), one of those per pass. One pass stops at the first failure that isn't about the text (scorer down,
 * busy, slow) and waits for the next tick.
 */
export function audioWorker(
  db: Db,
  speaker: Speaker,
  now: () => Date = () => new Date(),
  voices: readonly ExtraVoice[] = EXTRA_VOICES,
) {
  const badText = new Map<string, number>();
  let running = false;
  let failing = false;

  function nextJob(): Job | undefined {
    const skipCards = [...badText.keys()].filter((k) => k.startsWith("card:")).map((k) => Number(k.slice(5)));
    const card = nextCardWithoutAudio(db, skipCards);
    if (card) {
      return {
        key: `card:${card.id}`,
        text: card.korean,
        ready: audioForText(db, card.korean),
        save(mp3) {
          // The card may have changed or gone while the audio was being made.
          const current = db.select({ korean: cards.korean }).from(cards).where(eq(cards.id, card.id)).get();
          if (current?.korean === card.korean) saveCardAudio(db, card.id, card.korean, mp3, now());
        },
      };
    }
    const skipTexts = new Set([...badText.keys()].filter((k) => k.startsWith("text:")).map((k) => k.slice(5)));
    const text = nextTextWithoutAudio(db, skipTexts);
    if (text !== undefined) return { key: `text:${text}`, text, save: (mp3) => saveSpeechAudio(db, text, mp3, now()) };
    const skipVoices = new Set([...badText.keys()].filter((k) => k.startsWith("voice:")).map((k) => k.slice(6)));
    const voiced = nextVoiceJob(db, skipVoices, voices);
    return (
      voiced && {
        key: `voice:${voiced.voice}:${voiced.text}`,
        ...voiced,
        save: (mp3) => saveVoiceAudio(db, voiced.text, voiced.voice, mp3, now()),
      }
    );
  }

  async function runOnce(): Promise<number> {
    if (running) return 0;
    running = true;
    let made = 0;
    try {
      for (;;) {
        const t = now().getTime();
        for (const [key, until] of badText) if (until <= t) badText.delete(key);
        const job = nextJob();
        // Audio of texts no card uses any more stays: it is a library by text (0012_audio_library.sql).
        if (!job) break;
        if (job.ready) {
          job.save(job.ready);
          continue;
        }
        try {
          job.save(await speaker.speak(job.text, job.voice));
          made++;
          if (failing) console.log("tts: back to normal");
          failing = false;
          // Examples, drill words and other voices are a long, low-priority backfill: one per tick,
          // so new cards and pronunciation scoring get the CPU in between.
          if (!job.key.startsWith("card:")) break;
        } catch (error) {
          if (error instanceof BadTextError) {
            console.warn(`tts: ${job.key} refused: ${error.message}`);
            badText.set(job.key, t + BAD_TEXT_RETRY_MS);
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
