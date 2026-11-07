import { resume, shortClip } from "./audioSession";
import { whenVisible } from "./resume";

// Reference audio: the server's recording of the card (Supertonic, apps/api/src/cardAudio.ts).
// The system ko-KR voice speaks only when the server really has no recording (404), never because
// a load was slow, cut off or interrupted: those are retried. Listening may ask for the word in
// another voice (lib/voices.ts); without that recording yet, the default one plays.
type SpeechCard = { id: number; korean: string; voice?: string };
type ClipState = "loading" | "ready" | "missing" | "broken";
type Clip = {
  audio: HTMLAudioElement;
  korean: string;
  state: ClipState;
  /** When the server last said it has no recording, to ask again a little later. */
  missingAt: number;
  loaded: Promise<void>;
  objectUrl?: string;
};

const hasAudio = () => typeof Audio !== "undefined";
const hasSystemVoice = () => typeof speechSynthesis !== "undefined";

export function canSpeak(): boolean {
  return hasAudio() || hasSystemVoice();
}

// Recent cards only; each clip is a few dozen KB.
const MAX_CLIPS = 20;
const clips = new Map<string, Clip>();
const clipKey = (card: SpeechCard) => `${card.id}:${card.voice ?? ""}`;
// A new card's recording is made within seconds (the worker runs every 10 s), so a 404 is asked again.
const MISSING_RECHECK_MS = 15_000;
// Network hiccups, the app frozen by iOS mid-request, the server restarting for an update.
const RETRY_DELAYS_MS = [700, 2000, 5000];

// MP3s are also kept in Cache Storage, so a card heard once plays at once next time, even after
// the app was closed. The key carries the Korean: when it changes, so does the audio.
const AUDIO_CACHE = "kquiz-audio-v1";
const MAX_CACHED = 1500;

const baseUrl = (id: number) => `/api/cards/${id}/audio`;
const audioUrl = (card: SpeechCard) => baseUrl(card.id) + (card.voice ? `?voice=${card.voice}` : "");
const cacheKey = (card: SpeechCard) =>
  `${baseUrl(card.id)}?k=${encodeURIComponent(card.korean)}${card.voice ? `&v=${card.voice}` : ""}`;

async function openAudioCache(): Promise<Cache | undefined> {
  try {
    return typeof caches === "undefined" ? undefined : await caches.open(AUDIO_CACHE);
  } catch {
    return undefined;
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The card's MP3 from the cache or the server; "missing" when the server has none (404), "broken"
 * when it couldn't be fetched even after a few tries.
 */
export async function loadAudio(card: SpeechCard, delays: readonly number[] = RETRY_DELAYS_MS): Promise<Blob | "missing" | "broken"> {
  const cache = await openAudioCache();
  const hit = await cache?.match(cacheKey(card)).catch(() => undefined);
  if (hit) {
    const blob = await hit.blob().catch(() => undefined);
    if (blob?.size) return blob;
  }
  for (let attempt = 0; ; attempt++) {
    await whenVisible();
    let res: Response | undefined;
    try {
      res = await fetch(audioUrl(card), { credentials: "same-origin" });
    } catch {
      res = undefined;
    }
    if (res?.ok) {
      const blob = await res
        .clone()
        .blob()
        .catch(() => undefined);
      if (blob?.size) {
        if (cache) {
          await cache.put(cacheKey(card), res).catch(() => {});
          void pruneAudioCache(cache, card);
        }
        return blob;
      }
    }
    if (res?.status === 404) return "missing";
    // Signed out: trying again won't help.
    if (res?.status === 401 || res?.status === 403) return "broken";
    if (attempt >= delays.length) return "broken";
    await wait(delays[attempt]!);
  }
}

/** Drops the card's audio for its earlier Korean, in every voice, and the oldest clips past MAX_CACHED. */
async function pruneAudioCache(cache: Cache, card: SpeechCard) {
  try {
    const keys = await cache.keys();
    const prefix = new URL(`${baseUrl(card.id)}?`, location.origin).href;
    const stale = keys.filter((k) => k.url.startsWith(prefix) && new URL(k.url).searchParams.get("k") !== card.korean);
    const rest = keys.filter((k) => !stale.includes(k));
    const old = rest.slice(0, Math.max(rest.length - MAX_CACHED, 0));
    await Promise.all([...stale, ...old].map((k) => cache.delete(k)));
  } catch {
    // Only housekeeping.
  }
}

/** (Re)loads the clip's MP3 into its own element, which keeps the permission a tap gave it on iOS. */
function fill(clip: Clip, card: SpeechCard): Promise<void> {
  clip.state = "loading";
  clip.loaded = loadAudio(card).then((result) => {
    if (result === "missing") {
      clip.state = "missing";
      clip.missingAt = Date.now();
    } else if (result === "broken") {
      clip.state = "broken";
    } else {
      if (clip.objectUrl) URL.revokeObjectURL(clip.objectUrl);
      clip.objectUrl = URL.createObjectURL(result);
      // A tap before the load finished has already pointed the clip at the server.
      if (!clip.audio.getAttribute("src") || clip.audio.error) clip.audio.src = clip.objectUrl;
      clip.audio.dataset.src = clip.objectUrl;
      clip.state = "ready";
    }
  });
  return clip.loaded;
}

function clipFor(card: SpeechCard): Clip {
  const key = clipKey(card);
  const cached = clips.get(key);
  if (cached && cached.korean === card.korean) {
    // Not there a while ago, or the network failed: ask the server again.
    const stale =
      (cached.state === "missing" && Date.now() - cached.missingAt > MISSING_RECHECK_MS) || cached.state === "broken";
    if (stale) void fill(cached, card);
    clips.delete(key);
    clips.set(key, cached);
    return cached;
  }
  const audio = shortClip(new Audio());
  audio.preload = "auto";
  const clip: Clip = { audio, korean: card.korean, state: "loading", missingAt: 0, loaded: Promise.resolve() };
  void fill(clip, card);
  if (cached?.objectUrl) URL.revokeObjectURL(cached.objectUrl);
  clips.delete(key);
  clips.set(key, clip);
  for (const [k, old] of clips) {
    if (clips.size <= MAX_CLIPS) break;
    if (old.objectUrl) URL.revokeObjectURL(old.objectUrl);
    clips.delete(k);
  }
  return clip;
}

/** Starts loading the cards' audio so a tap plays it at once; iOS only plays inside the tap. */
export function preloadSpeech(...cards: SpeechCard[]) {
  if (!hasAudio()) return;
  for (const card of cards) {
    clipFor(card);
    // The fallback while the other voice isn't made yet.
    if (card.voice) clipFor({ ...card, voice: undefined });
  }
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

// Only the latest speak() may sound: an earlier one that is still loading or retrying stays silent.
let latest = 0;

/** play() was cut short by our own pause() or the next speak(), or refused outside a tap. */
const harmless = (e: unknown) => e instanceof DOMException && (e.name === "AbortError" || e.name === "NotAllowedError");

export function speak(card: SpeechCard): void {
  const turn = ++latest;
  if (hasSystemVoice()) speechSynthesis.cancel();
  for (const other of clips.values()) other.audio.pause();
  const clip = hasAudio() ? clipFor(card) : undefined;
  const fallback = (): void => {
    if (turn !== latest) return;
    if (card.voice) speak({ ...card, voice: undefined });
    else speakWithSystemVoice(card.korean);
  };
  if (!clip) return fallback();
  // Known to be absent, and asked recently: the other voice, or the phone's.
  if (clip.state === "missing") return fallback();
  const start = () => {
    resume(clip.audio);
    // Still loading: stream it from the server, inside the tap.
    if (!clip.audio.getAttribute("src") || clip.audio.error) clip.audio.src = clip.objectUrl ?? audioUrl(card);
    clip.audio.currentTime = 0;
    return clip.audio.play();
  };
  start().catch(async (e: unknown) => {
    if (harmless(e) || turn !== latest) return;
    // The stream failed (cut off, not made yet, server restarting): load it again and play that.
    await (clip.state === "loading" ? clip.loaded : fill(clip, card));
    if (turn !== latest) return;
    if (clip.state === "ready") {
      clip.audio.src = clip.objectUrl!;
      start().catch((again: unknown) => {
        if (!harmless(again)) fallback();
      });
    } else if (clip.state === "missing") fallback();
    // Still broken after the retries: the phone's voice would only mislead; the next tap tries again.
  });
}
