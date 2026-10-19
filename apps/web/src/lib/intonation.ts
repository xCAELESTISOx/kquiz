// Intonation feedback (docs/research item 9): the pitch curve of the reference next to yours.
// Everything runs on the phone: pitch by YIN, the two takes aligned in time by DTW over
// cepstral features, so a slower or faster take still lines up syllable by syllable. No server work.

/** Analysis rate: pitch below 500 Hz and the spectrum up to 4 kHz need no more. */
export const RATE = 8000;
const FRAME = 256; // 32 ms
const HOP = 80; // 10 ms
export const FRAME_SECONDS = HOP / RATE;
const MIN_HZ = 70;
const MAX_HZ = 500;
const YIN_THRESHOLD = 0.3;
// Frames quieter than this share of the loudest one are silence.
const SILENCE = 0.06;

/** Averaging windows of samples; enough to bring 16–48 kHz speech down to RATE. */
export function resampleTo(samples: Float32Array, rate: number, target = RATE): Float32Array {
  if (rate === target) return samples;
  const ratio = rate / target;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.max(start + 1, Math.min(Math.floor((i + 1) * ratio), samples.length));
    let sum = 0;
    for (let j = start; j < end; j++) sum += samples[j]!;
    out[i] = sum / (end - start);
  }
  return out;
}

function frameCount(n: number): number {
  return n < FRAME ? 0 : Math.floor((n - FRAME) / HOP) + 1;
}

function frameEnergy(x: Float32Array): Float32Array {
  const n = frameCount(x.length);
  const out = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let sum = 0;
    for (let j = 0; j < FRAME; j++) sum += x[f * HOP + j]! ** 2;
    out[f] = Math.sqrt(sum / FRAME);
  }
  return out;
}

/** First and last frame (exclusive) with speech in them. */
function speechSpan(energy: Float32Array): [number, number] {
  let max = 0;
  for (const e of energy) max = Math.max(max, e);
  const threshold = Math.max(max * SILENCE, 1e-3);
  let start = energy.findIndex((e) => e > threshold);
  if (start < 0) return [0, 0];
  let end = energy.length;
  while (end > start && energy[end - 1]! <= threshold) end--;
  start = Math.max(0, start - 3);
  end = Math.min(energy.length, end + 3);
  return [start, end];
}

/** Pitch of each frame in Hz, 0 where unvoiced (YIN, de Cheveigné & Kawahara 2002). */
export function pitch(x: Float32Array, energy = frameEnergy(x)): Float32Array {
  const n = energy.length;
  const out = new Float32Array(n);
  const minTau = Math.floor(RATE / MAX_HZ);
  const maxTau = Math.min(Math.ceil(RATE / MIN_HZ), FRAME - 1);
  const d = new Float32Array(maxTau + 1);
  let loudest = 0;
  for (const e of energy) loudest = Math.max(loudest, e);
  const W = FRAME - maxTau;
  for (let f = 0; f < n; f++) {
    if (energy[f]! < loudest * SILENCE) continue;
    const at = f * HOP;
    for (let tau = 1; tau <= maxTau; tau++) {
      let sum = 0;
      for (let j = 0; j < W; j++) {
        const diff = x[at + j]! - x[at + j + tau]!;
        sum += diff * diff;
      }
      d[tau] = sum;
    }
    // Cumulative mean normalized difference.
    let running = 0;
    let best = -1;
    for (let tau = 1; tau <= maxTau; tau++) {
      running += d[tau]!;
      d[tau] = running > 0 ? (d[tau]! * tau) / running : 1;
    }
    for (let tau = minTau; tau <= maxTau; tau++) {
      if (d[tau]! < YIN_THRESHOLD) {
        while (tau + 1 <= maxTau && d[tau + 1]! < d[tau]!) tau++;
        best = tau;
        break;
      }
    }
    if (best < 0) continue;
    // Parabolic interpolation around the dip.
    const a = d[best - 1] ?? d[best]!;
    const b = d[best]!;
    const c = d[best + 1] ?? d[best]!;
    const shift = a + c - 2 * b !== 0 ? (a - c) / (2 * (a + c - 2 * b)) : 0;
    out[f] = RATE / (best + Math.max(-1, Math.min(1, shift)));
  }
  return cleanPitch(out);
}

/** Drops voiced runs shorter than 40 ms and octave jumps, which are YIN's usual mistakes. */
function cleanPitch(f0: Float32Array): Float32Array {
  const out = f0.slice();
  for (let i = 0; i < out.length; ) {
    if (!out[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < out.length && out[j]) j++;
    if (j - i < 4) out.fill(0, i, j);
    i = j;
  }
  const median = (values: number[]) => values.sort((a, b) => a - b)[values.length >> 1]!;
  for (let i = 0; i < out.length; i++) {
    if (!out[i]) continue;
    const near: number[] = [];
    for (let k = Math.max(0, i - 3); k <= Math.min(out.length - 1, i + 3); k++) if (f0[k]) near.push(f0[k]!);
    const m = median(near);
    if (Math.abs(12 * Math.log2(out[i]! / m)) > 7) out[i] = m;
  }
  return out;
}

// ---- Spectral features for alignment ----

const FFT_SIZE = 256;
const MEL_BANDS = 24;
const CEPSTRA = 13;

function fftPower(frame: Float32Array): Float32Array {
  const n = FFT_SIZE;
  const re = Float64Array.from(frame);
  const im = new Float64Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(angle * k);
        const wi = Math.sin(angle * k);
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b]! * wr - im[b]! * wi;
        const ti = re[b]! * wi + im[b]! * wr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
      }
    }
  }
  const power = new Float32Array(n / 2 + 1);
  for (let i = 0; i <= n / 2; i++) power[i] = re[i]! ** 2 + im[i]! ** 2;
  return power;
}

const mel = (hz: number) => 2595 * Math.log10(1 + hz / 700);
const hz = (m: number) => 700 * (10 ** (m / 2595) - 1);

let melBank: Float32Array[] | undefined;
function melFilters(): Float32Array[] {
  if (melBank) return melBank;
  const lo = mel(100);
  const hi = mel(RATE / 2 - 200);
  const edges = Array.from({ length: MEL_BANDS + 2 }, (_, i) => (hz(lo + ((hi - lo) * i) / (MEL_BANDS + 1)) * FFT_SIZE) / RATE);
  melBank = Array.from({ length: MEL_BANDS }, (_, b) => {
    const filter = new Float32Array(FFT_SIZE / 2 + 1);
    const [l, c, r] = [edges[b]!, edges[b + 1]!, edges[b + 2]!];
    for (let k = 0; k < filter.length; k++) {
      if (k > l && k <= c) filter[k] = (k - l) / (c - l);
      else if (k > c && k < r) filter[k] = (r - k) / (r - c);
    }
    return filter;
  });
  return melBank;
}

/** Mel cepstra per frame (c1…c12), mean-normalized so two different voices still compare. */
export function cepstra(x: Float32Array, from: number, to: number): Float32Array[] {
  const filters = melFilters();
  const window = Float32Array.from({ length: FRAME }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1)));
  const frames: Float32Array[] = [];
  const buffer = new Float32Array(FFT_SIZE);
  const logMel = new Float32Array(MEL_BANDS);
  for (let f = from; f < to; f++) {
    for (let j = 0; j < FRAME; j++) buffer[j] = (x[f * HOP + j] ?? 0) * window[j]!;
    const power = fftPower(buffer);
    for (let b = 0; b < MEL_BANDS; b++) {
      let sum = 0;
      const filter = filters[b]!;
      for (let k = 0; k < power.length; k++) sum += filter[k]! * power[k]!;
      logMel[b] = Math.log(sum + 1e-8);
    }
    const c = new Float32Array(CEPSTRA - 1);
    for (let i = 1; i < CEPSTRA; i++) {
      let sum = 0;
      for (let b = 0; b < MEL_BANDS; b++) sum += logMel[b]! * Math.cos((Math.PI * i * (b + 0.5)) / MEL_BANDS);
      c[i - 1] = sum;
    }
    frames.push(c);
  }
  const mean = new Float32Array(CEPSTRA - 1);
  for (const c of frames) for (let i = 0; i < c.length; i++) mean[i]! += c[i]! / frames.length;
  for (const c of frames) for (let i = 0; i < c.length; i++) c[i]! -= mean[i]!;
  return frames;
}

// A take may run faster or slower than the reference, but not by more than this share of its
// length at any point; outside the band the path is never searched. Steps that stretch one take
// cost a little extra, so flat stretches with nothing to match don't wander off the diagonal.
const BAND = 0.25;
const STRETCH_PENALTY = 0.5;

/** For each frame of `a`, the frames of `b` it is matched with (dynamic time warping). */
export function align(a: Float32Array[], b: Float32Array[]): number[][] {
  const n = a.length;
  const m = b.length;
  const matches: number[][] = Array.from({ length: n }, () => []);
  if (!n || !m) return matches;
  const cost = new Float32Array(n * m).fill(Infinity);
  const dist = (i: number, j: number) => {
    let sum = 0;
    const x = a[i]!;
    const y = b[j]!;
    for (let k = 0; k < x.length; k++) sum += (x[k]! - y[k]!) ** 2;
    return Math.sqrt(sum);
  };
  const inBand = (i: number, j: number) => Math.abs(i / Math.max(n - 1, 1) - j / Math.max(m - 1, 1)) <= BAND;
  let scale = 0;
  for (let i = 0; i < n; i += Math.max(1, n >> 4)) scale += dist(i, Math.round((i * (m - 1)) / Math.max(n - 1, 1)));
  const penalty = (STRETCH_PENALTY * scale) / Math.ceil(n / Math.max(1, n >> 4));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (!inBand(i, j) && !(i === 0 && j === 0) && !(i === n - 1 && j === m - 1)) continue;
      const up = i > 0 ? cost[(i - 1) * m + j]! + penalty : Infinity;
      const left = j > 0 ? cost[i * m + j - 1]! + penalty : Infinity;
      const diag = i > 0 && j > 0 ? cost[(i - 1) * m + j - 1]! : Infinity;
      const prev = i === 0 && j === 0 ? 0 : Math.min(up, left, diag);
      cost[i * m + j] = prev + dist(i, j);
    }
  }
  let i = n - 1;
  let j = m - 1;
  for (;;) {
    matches[i]!.push(j);
    if (i === 0 && j === 0) break;
    if (i === 0) j--;
    else if (j === 0) i--;
    else {
      const diag = cost[(i - 1) * m + j - 1]!;
      const up = cost[(i - 1) * m + j]! + penalty;
      const left = cost[i * m + j - 1]! + penalty;
      if (diag <= up && diag <= left) {
        i--;
        j--;
      } else if (up <= left) i--;
      else j--;
    }
  }
  return matches;
}

// ---- Comparison ----

export type Contour = (number | null)[];

export type IntonationComparison = {
  /** Reference pitch per 10 ms frame, in semitones from the speaker's own median; null = no voice. */
  reference: Contour;
  /** Your pitch on the reference's timeline, in semitones from your own median. */
  yours: Contour;
  /** Frames [from, to) where the two curves part by more than DIVERGE semitones. */
  diverging: [number, number][];
  /** Pearson correlation of the curves where both have voice; null when there is too little. */
  similarity: number | null;
};

const DIVERGE = 3.5;

function semitones(f0: Float32Array, from: number, to: number): Contour {
  const voiced = Array.from(f0.subarray(from, to)).filter((v) => v > 0).sort((a, b) => a - b);
  if (voiced.length < 5) return Array.from({ length: to - from }, () => null);
  const median = voiced[voiced.length >> 1]!;
  return Array.from(f0.subarray(from, to), (v) => (v > 0 ? 12 * Math.log2(v / median) : null));
}

/** Light smoothing that keeps gaps where there is no voice. */
function smooth(contour: Contour, radius = 2): Contour {
  return contour.map((v, i) => {
    if (v === null) return null;
    let sum = 0;
    let count = 0;
    for (let k = i - radius; k <= i + radius; k++) {
      const w = contour[k];
      if (w !== null && w !== undefined) {
        sum += w;
        count++;
      }
    }
    return sum / count;
  });
}

function correlation(a: number[], b: number[]): number | null {
  if (a.length < 15) return null;
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  const ma = mean(a);
  const mb = mean(b);
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += (a[i]! - ma) * (b[i]! - mb);
    aa += (a[i]! - ma) ** 2;
    bb += (b[i]! - mb) ** 2;
  }
  // A flat curve on both sides is a match, not a division by zero.
  if (aa < 1e-6 || bb < 1e-6) return aa < 1e-6 && bb < 1e-6 ? 1 : 0;
  return ab / Math.sqrt(aa * bb);
}

/** Both takes as mono samples at RATE. */
export function compareIntonation(reference: Float32Array, yours: Float32Array): IntonationComparison {
  const refEnergy = frameEnergy(reference);
  const yourEnergy = frameEnergy(yours);
  const [r0, r1] = speechSpan(refEnergy);
  const [y0, y1] = speechSpan(yourEnergy);
  const refContour = smooth(semitones(pitch(reference, refEnergy), r0, r1));
  const yourContour = semitones(pitch(yours, yourEnergy), y0, y1);
  const matches = align(cepstra(reference, r0, r1), cepstra(yours, y0, y1));
  const warped = smooth(
    matches.map((js) => {
      const voiced = js.map((j) => yourContour[j]).filter((v): v is number => v !== null && v !== undefined);
      return voiced.length ? voiced.reduce((s, v) => s + v, 0) / voiced.length : null;
    }),
  );

  const both: [number, number][] = [];
  const diverging: [number, number][] = [];
  let runStart = -1;
  for (let i = 0; i <= refContour.length; i++) {
    const a = refContour[i];
    const b = warped[i];
    const has = a !== null && a !== undefined && b !== null && b !== undefined;
    if (has) both.push([a, b]);
    const apart = has && Math.abs(a - b) > DIVERGE;
    if (apart && runStart < 0) runStart = i;
    if (!apart && runStart >= 0) {
      // Under 80 ms is noise in the alignment, not something to show.
      if (i - runStart >= 8) diverging.push([runStart, i]);
      runStart = -1;
    }
  }
  return {
    reference: refContour,
    yours: warped,
    diverging,
    similarity: correlation(
      both.map(([a]) => a),
      both.map(([, b]) => b),
    ),
  };
}

export type Verdict = { tone: "ok" | "weak" | "wrong" | "none"; title: string; text: string };

export function intonationVerdict(c: IntonationComparison): Verdict {
  const voiced = c.yours.filter((v) => v !== null).length;
  if (c.similarity === null || voiced < c.reference.length * 0.2) {
    return { tone: "none", title: "Мелодию не разобрать", text: "Голоса в записи мало. Скажи фразу целиком и чуть громче." };
  }
  // Two voices never match frame by frame; a short slip in a matching melody is not worth a warning.
  const apart = c.diverging.reduce((n, [from, to]) => n + to - from, 0);
  if (c.similarity >= 0.7 && apart <= voiced * 0.15) {
    return { tone: "ok", title: "Мелодия совпадает", text: "Подъёмы и спады там же, где у образца." };
  }
  if (c.similarity >= 0.4) {
    return { tone: "weak", title: "Похоже, с расхождениями", text: "Красным отмечено, где мелодия уходит от образца." };
  }
  return { tone: "wrong", title: "Мелодия другая", text: "Послушай образец ещё раз и повтори, следя за подъёмами и спадами." };
}

// ---- Decoding ----

/** Samples of a 16-bit PCM WAV, as the recorder makes them. */
export function wavSamples(wav: Uint8Array): { samples: Float32Array; rate: number } {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const rate = view.getUint32(24, true);
  const count = Math.floor((wav.byteLength - 44) / 2);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) samples[i] = view.getInt16(44 + i * 2, true) / 32768;
  return { samples, rate };
}

/** Fetches and decodes reference audio (MP3) to mono samples at RATE; undefined if it is not there. */
export async function loadReference(url: string): Promise<Float32Array | undefined> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) return undefined;
  const data = await res.arrayBuffer();
  // An offline context decodes without a user gesture and resamples on the way.
  const ctx = new OfflineAudioContext(1, 1, 16_000);
  const buffer = await ctx.decodeAudioData(data);
  return resampleTo(buffer.getChannelData(0), buffer.sampleRate);
}
