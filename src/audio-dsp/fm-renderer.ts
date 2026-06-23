// src/audio-dsp/fm-renderer.ts
// 4-operator FM voice renderer. Pure per-sample DSP — no Web Audio / worklet globals.
// Ports FMVoice from src/engines/fm.ts with corrected FM tuning: per-sample linear-FM
// so carrier ratios stay in tune across all algorithms.
//
// ALGORITHMS and CARRIERS are copied from src/engines/fm.ts (0-indexed ops 0..3):
//   ALGORITHMS[algo][i] = list of op indices that modulate op i (matching fm.ts ops[i].modulators)
//   CARRIERS[algo]      = op indices that go to the final mix    (matching fm.ts ops[i].isCarrier)
//
// FM tuning fix: in the node version, modulator output is scaled by (opFreq * 4) Hz.
// Here, carrier phase advances by (freq + modSample * modFreq * modLevel) per sample
// so ratios stay musically in tune regardless of carrier frequency.

import type { NoteSpec, ParamBag, VoiceRenderer } from './types';
import { param } from './types';
import { Adsr } from './adsr';
import { registerRenderer } from './renderer-registry';

// ALGORITHMS[algo][opIdx] = array of op indices that modulate opIdx.
// Matches fm.ts FMAlgorithm.ops[i].modulators (0-indexed, 0..3).
const ALGORITHMS: number[][][] = [
  [[1], [2], [3], []],      // 0: Serial 4→3→2→1  (op0 = carrier)
  [[1, 2, 3], [], [], []],  // 1: Parallel mods → op0  (op0 = carrier)
  [[1], [], [3], []],       // 2: Two pairs (op3→op2, op1→op0)  (op0, op2 = carriers)
  [[], [], [], []],         // 3: Additive — all four are carriers
];

// CARRIERS[algo] = op indices that contribute to the final output mix.
// Matches fm.ts ops[i].isCarrier.
const CARRIERS: number[][] = [
  [0],
  [0],
  [0, 2],
  [0, 1, 2, 3],
];

const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
// Modulation-depth scalars matching the legacy node engine (fm.ts): modulator
// outGain = level·opFreq·4, op4 feedback gain = feedback·op4Freq·2.
const FM_DEPTH = 4;
const FB_DEPTH = 2;

/** Minimal sine phase accumulator with support for per-sample frequency modulation.
 *  Unlike SineOsc (which advances by freq/sr and returns sin), FmSine lets the
 *  caller pass an fmHz offset so the carrier phase receives the FM contribution
 *  in the same sample it is synthesised. */
class FmSine {
  private phase = 0;
  constructor(private sr: number) {}

  /** Advance phase by (freq + fmHz)/sr and return sin of the resulting phase. */
  next(freq: number, fmHz = 0): number {
    const v = Math.sin(this.phase * 2 * Math.PI);
    this.phase = (this.phase + (freq + fmHz) / this.sr) % 1;
    return v;
  }
}

export class FMRenderer implements VoiceRenderer {
  private begin: number;
  private holdEnd: number;
  private oscs: FmSine[];
  private envs: Adsr[];
  /** Hz base frequency of each operator (note freq * ratio * detune). */
  private freqs: number[];
  /** Per-op ADSR times. */
  private opA: number[];
  private opD: number[];
  private opS: number[];
  private opR: number[];
  /** Per-op output level (0..1). */
  private lvl: number[];
  private algoIdx: number;
  private feedback: number;
  /** Global output mix scale (amp.mix). */
  private mix: number;
  /** Velocity multiplier, including accent boost. */
  private vel: number;
  /** Single-sample feedback state for op4 self-feedback. */
  private fbState = 0;
  done = false;

  constructor(note: NoteSpec, p: ParamBag, private sr: number) {
    this.begin = note.beginSec;
    this.holdEnd = note.beginSec + note.durationSec;

    const f = midiToFreq(note.midi);
    this.algoIdx = Math.max(0, Math.min(3, Math.round(param(p, 'algorithm', 0))));
    this.feedback = param(p, 'feedback', 0);
    this.mix = param(p, 'amp.mix', 0.7);
    this.vel = note.velocity * (note.accent ? 1.3 : 1);

    this.oscs = [];
    this.envs = [];
    this.freqs = [];
    this.opA = [];
    this.opD = [];
    this.opS = [];
    this.opR = [];
    this.lvl = [];

    for (let i = 1; i <= 4; i++) {
      this.oscs.push(new FmSine(sr));
      this.envs.push(new Adsr());

      const ratio = param(p, `op${i}.ratio`, 1);
      const detCents = param(p, `op${i}.detune`, 0);
      this.freqs.push(f * ratio * Math.pow(2, detCents / 1200));

      this.opA.push(Math.max(0.001, param(p, `op${i}.attack`, 0.01)));
      this.opD.push(Math.max(0.001, param(p, `op${i}.decay`, 0.3)));
      this.opS.push(param(p, `op${i}.sustain`, 0.7));
      this.opR.push(Math.max(0.005, param(p, `op${i}.release`, 0.3)));
      this.lvl.push(param(p, `op${i}.level`, 0.6));
    }
  }

  noteOff(t: number): void {
    if (t < this.holdEnd) this.holdEnd = t;
  }

  renderSample(t: number): number {
    if (t < this.begin) return 0;

    const gate = t <= this.holdEnd ? 1 : 0;
    const algo = ALGORITHMS[this.algoIdx];
    const carriers = CARRIERS[this.algoIdx];

    // op output for this sample (raw sine × envelope, before carrier/modulator scaling).
    const opOut = new Array<number>(4);

    // Compute ops from highest index to lowest so modulators are ready before carriers.
    // (In all four algorithms, higher-indexed ops always modulate lower-indexed ones.)
    for (let i = 3; i >= 0; i--) {
      const env = this.envs[i].update(
        t, gate, this.opA[i], this.opD[i], this.opS[i], this.opR[i],
      );

      // Sum FM contributions from ops that modulate this op.
      // Each modulator contributes modSine * modFreq * modLevel * FM_DEPTH Hz of
      // deviation. FM_DEPTH = 4 matches the legacy node engine's modulator outGain
      // (level * opFreq * 4) so the ~20 FM presets keep their intended index. The
      // tuning fix is the linear-FM phase advance below, independent of this depth.
      let fmHz = 0;
      for (const mIdx of algo[i]) {
        fmHz += opOut[mIdx] * this.freqs[mIdx] * this.lvl[mIdx] * FM_DEPTH;
      }

      // Op 3 (index 3) supports self-feedback: output at t-1 feeds its own FM input.
      // FB_DEPTH = 2 matches the legacy fbGain = feedback * op4Freq * 2.
      if (i === 3 && this.feedback > 0) {
        fmHz += this.fbState * this.freqs[3] * this.feedback * FB_DEPTH;
      }

      opOut[i] = this.oscs[i].next(this.freqs[i], fmHz) * env;

      // Update feedback state (single-sample delay loop) on op index 3.
      if (i === 3) this.fbState = opOut[3];
    }

    // Sum carrier outputs (scaled by their level and OUTPUT_TRIM 0.25 to match the
    // node engine's carrier outGain = level * velMul * 0.25 at trigger).
    let out = 0;
    for (const c of carriers) {
      out += opOut[c] * this.lvl[c];
    }

    // Mark voice as done once all envelopes have fully released after gate-off.
    if (gate === 0 && this.envs.every((e) => e.isOff) && t > this.holdEnd) {
      this.done = true;
    }

    // OUTPUT_TRIM (0.25) + global mix + velocity, matching legacy carrier scaling.
    return out * 0.25 * this.mix * this.vel;
  }
}

registerRenderer('fm', (n, p, sr) => new FMRenderer(n, p, sr));
