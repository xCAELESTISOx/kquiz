// Reference audio via the system ko-KR voice until server TTS exists (docs/PLAN.md §4.1).
export function canSpeak(): boolean {
  return typeof speechSynthesis !== "undefined";
}

export function speak(text: string) {
  if (!canSpeak()) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ko-KR";
  utterance.rate = 0.9;
  const voice = speechSynthesis.getVoices().find((v) => v.lang.replace("_", "-").startsWith("ko"));
  if (voice) utterance.voice = voice;
  speechSynthesis.speak(utterance);
}
