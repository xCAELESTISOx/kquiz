import { downsample, encodeWav, rms } from "./wav";

// Recording through an AudioWorklet into 16 kHz WAV (docs/PLAN.md §4.1). MediaRecorder is avoided:
// it breaks in iOS home-screen PWAs and Safari only writes audio/mp4, which the scorer doesn't read.

/** The scorer refuses anything over 10 s; stop a little earlier. */
export const MAX_SECONDS = 9;

export type RecorderError = "unsupported" | "denied" | "no_microphone" | "failed";

export class RecorderFailure extends Error {
  constructor(readonly reason: RecorderError) {
    super(reason);
  }
}

export function canRecord(): boolean {
  return typeof AudioWorkletNode !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

/**
 * One instance per screen. The microphone stays open between takes, so iOS asks once per visit,
 * and is released by `close()` when the screen goes away.
 */
export class Recorder {
  private ctx?: AudioContext;
  private stream?: MediaStream;
  private ready?: Promise<void>;
  private module?: Promise<void>;
  private node?: AudioWorkletNode;
  private source?: MediaStreamAudioSourceNode;
  private sink?: GainNode;
  private chunks: Float32Array[] = [];
  private length = 0;
  private finish?: (last: Float32Array) => void;

  /**
   * Must be called from a tap: iOS only lets an AudioContext start inside a user gesture,
   * so the context is created and resumed before the first await.
   */
  async start(onLevel: (level: number) => void, onLimit: () => void): Promise<void> {
    if (!canRecord()) throw new RecorderFailure("unsupported");
    this.ctx ??= new AudioContext();
    const resumed = this.ctx.resume();
    // iOS ends the microphone track when the app goes to the background; open it again.
    if (this.stream?.getAudioTracks().every((t) => t.readyState === "ended")) {
      this.stream = undefined;
      this.ready = undefined;
    }
    try {
      this.ready ??= this.open();
      await this.ready;
      await resumed;
    } catch (error) {
      this.ready = undefined;
      throw error instanceof RecorderFailure ? error : new RecorderFailure("failed");
    }
    const ctx = this.ctx;
    this.chunks = [];
    this.length = 0;
    const limit = MAX_SECONDS * ctx.sampleRate;
    const node = new AudioWorkletNode(ctx, "kquiz-recorder", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
    node.port.onmessage = (event: MessageEvent<Float32Array | { last: Float32Array }>) => {
      if (!(event.data instanceof Float32Array)) {
        this.finish?.(event.data.last);
        return;
      }
      if (this.length >= limit) return;
      this.chunks.push(event.data);
      this.length += event.data.length;
      onLevel(rms(event.data));
      if (this.length >= limit) onLimit();
    };
    this.source = ctx.createMediaStreamSource(this.stream!);
    // Silent sink: some engines don't run a worklet that isn't connected to the destination.
    this.sink = ctx.createGain();
    this.sink.gain.value = 0;
    this.source.connect(node).connect(this.sink).connect(ctx.destination);
    this.node = node;
  }

  get recording(): boolean {
    return this.node !== undefined;
  }

  /** Stops the take and returns it as 16 kHz mono WAV, or undefined if nothing was recorded. */
  async stop(): Promise<{ wav: Uint8Array<ArrayBuffer>; seconds: number } | undefined> {
    const node = this.node;
    const ctx = this.ctx;
    if (!node || !ctx) return undefined;
    const last = await Promise.race([
      new Promise<Float32Array>((resolve) => {
        this.finish = resolve;
        node.port.postMessage("flush");
      }),
      new Promise<Float32Array>((resolve) => setTimeout(() => resolve(new Float32Array()), 300)),
    ]);
    this.finish = undefined;
    this.source?.disconnect();
    node.disconnect();
    this.sink?.disconnect();
    node.port.onmessage = null;
    this.node = undefined;
    const limit = MAX_SECONDS * ctx.sampleRate;
    if (this.length < limit) this.chunks.push(last.subarray(0, limit - this.length));
    const samples = new Float32Array(this.chunks.reduce((n, c) => n + c.length, 0));
    let offset = 0;
    for (const chunk of this.chunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    this.chunks = [];
    if (!samples.length) return undefined;
    return { wav: encodeWav(downsample(samples, ctx.sampleRate)), seconds: samples.length / ctx.sampleRate };
  }

  close() {
    this.source?.disconnect();
    this.node?.disconnect();
    this.node = undefined;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
    this.ready = undefined;
    void this.ctx?.close().catch(() => {});
    this.ctx = undefined;
    this.module = undefined;
  }

  private async open() {
    if (this.stream) return;
    try {
      // The scorer does its own normalization; the browser's processing smears consonants.
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (error) {
      const name = (error as DOMException).name;
      if (name === "NotAllowedError" || name === "SecurityError") throw new RecorderFailure("denied");
      if (name === "NotFoundError" || name === "OverconstrainedError") throw new RecorderFailure("no_microphone");
      throw new RecorderFailure("failed");
    }
    this.module ??= this.ctx!.audioWorklet.addModule("/recorder-worklet.js");
    await this.module;
  }
}
