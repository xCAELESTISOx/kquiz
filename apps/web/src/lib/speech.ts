// Reference audio: the server's recording of the card (Supertonic, apps/api/src/cardAudio.ts),
// or the system ko-KR voice while there is none yet or it fails to load.
type SpeechCard = { id: number; korean: string };
type Clip = { audio: HTMLAudioElement; korean: string; failed: boolean; objectUrl?: string };

const hasAudio = () => typeof Audio !== "undefined";
const hasSystemVoice = () => typeof speechSynthesis !== "undefined";

export function canSpeak(): boolean {
  return hasAudio() || hasSystemVoice();
}

// Recent cards only; each clip is a few dozen KB.
const MAX_CLIPS = 20;
const clips = new Map<number, Clip>();

// MP3s are also kept in Cache Storage, so a card heard once plays at once next time, even after
// the app was closed. The key carries the Korean: when it changes, so does the audio.
const AUDIO_CACHE = "kquiz-audio-v1";
const MAX_CACHED = 1500;

const audioUrl = (id: number) => `/api/cards/${id}/audio`;
const cacheKey = (card: SpeechCard) => `${audioUrl(card.id)}?k=${encodeURIComponent(card.korean)}`;

async function openAudioCache(): Promise<Cache | undefined> {
  try {
    return typeof caches === "undefined" ? undefined : await caches.open(AUDIO_CACHE);
  } catch {
    return undefined;
  }
}

/** The card's MP3 from the cache or the server; undefined while the server has none (404). */
async function loadAudio(card: SpeechCard): Promise<Blob | undefined> {
  const cache = await openAudioCache();
  const hit = await cache?.match(cacheKey(card)).catch(() => undefined);
  if (hit) return hit.blob();
  const res = await fetch(audioUrl(card.id), { credentials: "same-origin" });
  if (!res.ok) return undefined;
  if (cache) {
    await cache.put(cacheKey(card), res.clone()).catch(() => {});
    void pruneAudioCache(cache, card);
  }
  return res.blob();
}

/** Drops the card's audio for its earlier Korean, and the oldest clips past MAX_CACHED. */
async function pruneAudioCache(cache: Cache, card: SpeechCard) {
  try {
    const keys = await cache.keys();
    const current = new URL(cacheKey(card), location.origin).href;
    const prefix = new URL(`${audioUrl(card.id)}?`, location.origin).href;
    const stale = keys.filter((k) => k.url.startsWith(prefix) && k.url !== current);
    const rest = keys.filter((k) => !stale.includes(k));
    const old = rest.slice(0, Math.max(rest.length - MAX_CACHED, 0));
    await Promise.all([...stale, ...old].map((k) => cache.delete(k)));
  } catch {
    // Only housekeeping.
  }
}

function clipFor(card: SpeechCard): Clip {
  const cached = clips.get(card.id);
  if (cached && cached.korean === card.korean) return cached;
  const audio = new Audio();
  audio.preload = "auto";
  const clip: Clip = { audio, korean: card.korean, failed: false };
  // 404 until the server has made it.
  audio.addEventListener("error", () => (clip.failed = true));
  loadAudio(card).then(
    (blob) => {
      if (!blob) clip.failed = true;
      // A tap before the load finished has already pointed the clip at the server.
      else if (!audio.src) audio.src = clip.objectUrl = URL.createObjectURL(blob);
    },
    () => (clip.failed = true),
  );
  if (cached?.objectUrl) URL.revokeObjectURL(cached.objectUrl);
  clips.delete(card.id);
  clips.set(card.id, clip);
  for (const [id, old] of clips) {
    if (clips.size <= MAX_CLIPS) break;
    if (old.objectUrl) URL.revokeObjectURL(old.objectUrl);
    clips.delete(id);
  }
  return clip;
}

/** Starts loading the cards' audio so a tap plays it at once; iOS only plays inside the tap. */
export function preloadSpeech(...cards: SpeechCard[]) {
  if (hasAudio()) for (const card of cards) clipFor(card);
}

function speakWithSystemVoice(text: string) {
  if (!hasSystemVoice()) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ko-KR";
  utterance.rate = 0.9;
  const voice = speechSynthesis.getVoices().find((v) => v.lang.replace("_", "-").startsWith("ko"));
  if (voice) utterance.voice = voice;
  speechSynthesis.speak(utterance);
}

export function speak(card: SpeechCard) {
  if (hasSystemVoice()) speechSynthesis.cancel();
  for (const other of clips.values()) other.audio.pause();
  const clip = hasAudio() ? clipFor(card) : undefined;
  if (!clip || clip.failed) return speakWithSystemVoice(card.korean);
  if (!clip.audio.src) clip.audio.src = audioUrl(card.id);
  clip.audio.currentTime = 0;
  clip.audio.play().catch(() => {
    clip.failed = true;
    speakWithSystemVoice(card.korean);
  });
}
