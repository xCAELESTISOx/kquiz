// Listening in several voices (apps/api/src/voices.ts): each listening item is heard in a voice
// picked at random from the default one and the others its word already has, so the ear learns
// the sound rather than one speaker's timbre.
import type { QueueItem } from "./types";

/** A voice besides the default one, as the server names it (M1, F3…); undefined is the default. */
export type Voice = string | undefined;

const picked = new WeakMap<QueueItem, { voice: Voice }>();

/** Picks one of the voices at random; undefined, the default, is one of them. */
export function pickVoice(voices: readonly string[] | undefined, random = Math.random): Voice {
  const all = [undefined, ...(voices ?? [])];
  return all[Math.floor(random() * all.length)];
}

/** The voice this listening item is heard in, the same for every replay; the default for other modes. */
export function voiceFor(item: QueueItem, random = Math.random): Voice {
  if (item.mode !== "listening" || !item.voices?.length) return undefined;
  let pick = picked.get(item);
  if (!pick) picked.set(item, (pick = { voice: pickVoice(item.voices, random) }));
  return pick.voice;
}

/** A card that comes back later in the session is heard in a new voice then. */
export function forgetVoice(item: QueueItem) {
  picked.delete(item);
}

/** What speech.ts plays for the item: its card, in its voice. */
export const heard = (item: QueueItem) => ({ id: item.card.id, korean: item.card.korean, voice: voiceFor(item) });
