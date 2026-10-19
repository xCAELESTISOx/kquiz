// Audio thread side of src/lib/recorder.ts: copies microphone samples to the main thread in ~40 ms batches.
// Plain JS in public/ so it is served as is: audioWorklet.addModule() loads it by URL.
const BATCH = 2048;

class KquizRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(BATCH);
    this.filled = 0;
    this.port.onmessage = (event) => {
      if (event.data === "flush") {
        this.port.postMessage({ last: this.buffer.slice(0, this.filled) });
        this.filled = 0;
      }
    };
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    let offset = 0;
    while (offset < channel.length) {
      const n = Math.min(channel.length - offset, BATCH - this.filled);
      this.buffer.set(channel.subarray(offset, offset + n), this.filled);
      this.filled += n;
      offset += n;
      if (this.filled === BATCH) {
        this.port.postMessage(this.buffer.slice());
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor("kquiz-recorder", KquizRecorder);
