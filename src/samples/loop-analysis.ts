// Detection fallback for loops with no embedded metadata. Pure DSP on the
// decoded buffer: energy-onset envelope → peak-pick onsets → autocorrelation
// tempo estimate → snap to a whole-bar interpretation for an exact BPM.

import { quartersPerBar, type TimeSignature } from '../core/meter';

const HOP = 256;        // envelope hop in samples
const MIN_BPM = 70;
const MAX_BPM = 180;

export interface LoopAnalysis {
  originalBpm: number;
  slicePointsSec: number[];
  confidence: number;   // 0..1 rough autocorrelation peak strength
}

function monoEnvelope(buffer: AudioBuffer): { env: Float32Array; rate: number } {
  const ch = buffer.numberOfChannels;
  const n = buffer.length;
  const frames = Math.max(1, Math.floor(n / HOP));
  const env = new Float32Array(frames);
  for (let c = 0; c < ch; c++) {
    const d = buffer.getChannelData(c);
    for (let f = 0; f < frames; f++) {
      let sum = 0;
      const base = f * HOP;
      for (let i = 0; i < HOP && base + i < n; i++) { const s = d[base + i]; sum += s * s; }
      env[f] += Math.sqrt(sum / HOP);
    }
  }
  return { env, rate: buffer.sampleRate / HOP };
}

/** Positive first-difference (spectral-flux-like) of the envelope. */
function onsetFunction(env: Float32Array): Float32Array {
  const o = new Float32Array(env.length);
  for (let i = 1; i < env.length; i++) o[i] = Math.max(0, env[i] - env[i - 1]);
  return o;
}

function peakPick(onset: Float32Array, rate: number): number[] {
  const mean = onset.reduce((a, b) => a + b, 0) / Math.max(1, onset.length);
  const thresh = mean * 1.5;
  const minGap = Math.floor(rate * 0.05); // 50ms
  const peaks: number[] = [];
  let last = -minGap;
  for (let i = 1; i < onset.length - 1; i++) {
    if (onset[i] > thresh && onset[i] >= onset[i - 1] && onset[i] > onset[i + 1] && i - last >= minGap) {
      peaks.push(i / rate);
      last = i;
    }
  }
  return peaks;
}

function autocorrTempo(onset: Float32Array, rate: number): { bpm: number; conf: number } {
  const minLag = Math.floor((60 / MAX_BPM) * rate);
  const maxLag = Math.floor((60 / MIN_BPM) * rate);
  let bestLag = minLag, best = 0, total = 0;
  for (let lag = minLag; lag <= maxLag && lag < onset.length; lag++) {
    let s = 0;
    for (let i = lag; i < onset.length; i++) s += onset[i] * onset[i - lag];
    total += s;
    if (s > best) { best = s; bestLag = lag; }
  }
  const bpm = 60 / (bestLag / rate);
  return { bpm, conf: total > 0 ? best / total : 0 };
}

/** Snap a rough BPM to the exact value implied by a whole number of bars over
 *  the loop's duration, keeping the result inside [MIN_BPM, MAX_BPM]. */
function snapToWholeBars(roughBpm: number, durationSec: number, meter: TimeSignature): number {
  const qpb = quartersPerBar(meter);
  const barSecAtRough = qpb * (60 / roughBpm);
  const bars = Math.max(1, Math.round(durationSec / barSecAtRough));
  let bpm = (bars * qpb * 60) / durationSec;
  while (bpm < MIN_BPM) bpm *= 2;
  while (bpm > MAX_BPM) bpm /= 2;
  return bpm;
}

export function detectLoop(buffer: AudioBuffer, meter: TimeSignature): LoopAnalysis {
  const { env, rate } = monoEnvelope(buffer);
  const onset = onsetFunction(env);
  const slicePointsSec = peakPick(onset, rate);
  const { bpm: rough, conf } = autocorrTempo(onset, rate);
  const originalBpm = snapToWholeBars(rough, buffer.duration, meter);
  return { originalBpm, slicePointsSec, confidence: conf };
}
