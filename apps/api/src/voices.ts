// Other voices for listening. Hearing a word from several speakers trains the ear on the sound
// itself rather than on one speaker's timbre (high variability phonetic training), so card words
// and drill words are also read by a few more Supertonic voices. The default voice stays in
// card_audio and speech_audio; the others go here, made by the same worker after everything else.
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { cards, soundDrills, voiceAudio } from "./db/schema.js";
import { OWNER_ID } from "./users.js";

/** Voices besides the scorer's default (F1): two male and one more female. */
export const EXTRA_VOICES = ["M1", "F3", "M3"] as const;
export type ExtraVoice = (typeof EXTRA_VOICES)[number];

export const isExtraVoice = (voice: string | undefined): voice is ExtraVoice => EXTRA_VOICES.includes(voice as ExtraVoice);

/** Every text that should be heard in other voices: card words (the owner's first), then drill words. */
export function wantedVoiceTexts(db: Db): string[] {
  const texts = new Set<string>();
  const words = db
    .select({ korean: cards.korean })
    .from(cards)
    .orderBy(sql`${cards.userId} <> ${OWNER_ID}`, asc(cards.id))
    .all();
  for (const card of words) texts.add(card.korean);
  for (const drill of db.select({ words: soundDrills.words }).from(soundDrills).orderBy(asc(soundDrills.id)).all()) {
    for (const word of drill.words) texts.add(word.korean);
  }
  return [...texts];
}

/** The extra voices each text already has. */
export function voicesFor(db: Db, texts: string[]): Map<string, ExtraVoice[]> {
  const voices = new Map<string, ExtraVoice[]>();
  const unique = [...new Set(texts)];
  // Chunks keep the IN list well under SQLite's variable limit.
  for (let i = 0; i < unique.length; i += 500) {
    const rows = db
      .select({ text: voiceAudio.text, voice: voiceAudio.voice })
      .from(voiceAudio)
      .where(inArray(voiceAudio.text, unique.slice(i, i + 500)))
      .all();
    for (const { text, voice } of rows) {
      if (isExtraVoice(voice)) voices.set(text, [...(voices.get(text) ?? []), voice]);
    }
  }
  for (const list of voices.values()) list.sort((a, b) => EXTRA_VOICES.indexOf(a) - EXTRA_VOICES.indexOf(b));
  return voices;
}

/** The first wanted text and voice without audio, skipping keys `voice:text` in `skip`. */
export function nextVoiceJob(
  db: Db,
  skip: Set<string> = new Set(),
  voices: readonly ExtraVoice[] = EXTRA_VOICES,
): { text: string; voice: ExtraVoice } | undefined {
  if (!voices.length) return undefined;
  const wanted = wantedVoiceTexts(db);
  for (let i = 0; i < wanted.length; i += 500) {
    const chunk = wanted.slice(i, i + 500);
    const have = voicesFor(db, chunk);
    for (const text of chunk) {
      const voice = voices.find((v) => !have.get(text)?.includes(v) && !skip.has(`${v}:${text}`));
      if (voice) return { text, voice };
    }
  }
  return undefined;
}

export function saveVoiceAudio(db: Db, text: string, voice: ExtraVoice, data: Uint8Array, now: Date) {
  const values = { mime: "audio/mpeg", data: Buffer.from(data), createdAt: now };
  db.insert(voiceAudio)
    .values({ text, voice, ...values })
    .onConflictDoUpdate({ target: [voiceAudio.text, voiceAudio.voice], set: values })
    .run();
}

export function getVoiceAudio(db: Db, text: string, voice: ExtraVoice) {
  const row = db
    .select()
    .from(voiceAudio)
    .where(and(eq(voiceAudio.text, text), eq(voiceAudio.voice, voice)))
    .get();
  return row && { data: row.data, mime: row.mime, etag: `"${voice}-${row.createdAt.getTime()}-${row.data.length}"` };
}

