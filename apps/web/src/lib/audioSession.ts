// iOS audio session hygiene. While a page holds the microphone, iOS keeps it in the call
// session: sound comes out of the earpiece and the volume buttons set the call volume. And any
// <audio> that has played stays on the lock screen as "Now Playing" until it is unloaded.

type SessionType = "auto" | "playback" | "transient" | "transient-solo" | "ambient" | "play-and-record";

function setSession(type: SessionType) {
  try {
    const session = (navigator as Navigator & { audioSession?: { type: SessionType } }).audioSession;
    if (session) session.type = type;
  } catch {
    // Safari before 17 has no audioSession; releasing the microphone is enough there.
  }
}

/** Before getUserMedia, inside the tap. */
export const enterRecording = () => setSession("play-and-record");
/** After the microphone tracks are stopped: back to the loudspeaker and media volume. */
export const leaveRecording = () => setSession("auto");

const watched = new WeakSet<HTMLAudioElement>();

/**
 * Unloads a short clip once it stops, so it leaves the lock screen player. The source is kept on
 * `data-src`; `resume` puts it back before the next play.
 */
export function shortClip(audio: HTMLAudioElement): HTMLAudioElement {
  if (watched.has(audio)) return audio;
  watched.add(audio);
  audio.addEventListener("pause", () => {
    // pause() right before play() of the same clip: it is playing again by now.
    if (!audio.paused || !audio.getAttribute("src")) return;
    audio.dataset.src = audio.src;
    audio.removeAttribute("src");
    audio.load();
    try {
      if ("mediaSession" in navigator) {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = "none";
      }
    } catch {
      // Only cosmetic.
    }
  });
  return audio;
}

/** Restores a clip unloaded by `shortClip`; call before play(). */
export function resume(audio: HTMLAudioElement) {
  if (!audio.getAttribute("src") && audio.dataset.src) audio.src = audio.dataset.src;
}

/** Plays a one-off clip, such as the user's own take. */
export function playOnce(url: string) {
  void shortClip(new Audio(url))
    .play()
    .catch(() => {});
}
