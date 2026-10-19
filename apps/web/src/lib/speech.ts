// Reference audio: the server's recording of the card (Supertonic, apps/api/src/cardAudio.ts),
// or the system ko-KR voice while there is none yet or it fails to load.
type SpeechCard = { id: number; korean: string };
type Clip = { audio: HTMLAudioElement; korean: string; failed: boolean };

const hasAudio = () => typeof Audio !== "undefined";
const hasSystemVoice = () => typeof speechSynthesis !== "undefined";

export function canSpeak(): boolean {
  return hasAudio() || hasSystemVoice();
}

// Recent cards only; each clip is a few dozen KB.
const MAX_CLIPS = 20;
const clips = new Map<number, Clip>();

function clipFor(card: SpeechCard): Clip {
  const cached = clips.get(card.id);
  if (cached && cached.korean === card.korean) return cached;
  const audio = new Audio(`/api/cards/${card.id}/audio`);
  audio.preload = "auto";
  const clip: Clip = { audio, korean: card.korean, failed: false };
  // 404 until the server has made it.
  audio.addEventListener("error", () => (clip.failed = true));
  clips.delete(card.id);
  clips.set(card.id, clip);
  for (const id of clips.keys()) {
    if (clips.size <= MAX_CLIPS) break;
    clips.delete(id);
  }
  return clip;
}

/** Starts loading the card's audio so a tap plays it at once; iOS only plays inside the tap. */
export function preloadSpeech(card: SpeechCard) {
  if (hasAudio()) clipFor(card);
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
  clip.audio.currentTime = 0;
  clip.audio.play().catch(() => {
    clip.failed = true;
    speakWithSystemVoice(card.korean);
  });
}
