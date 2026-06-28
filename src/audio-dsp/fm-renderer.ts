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
//
// Modulation: generic per-param LFO + per-voice ADSR (ModEnvHost) reach the operator
// LEVELS (FM index), the feedback amount and the output mix — the params that shape
// the FM timbre. The four per-op amp envelopes stay built-in (FM has no single amp env).

import type { NoteSpec, ParamBag, VoiceRenderer, VoiceModOffsets } from './types';
import { param } from './types';
import { Adsr } from './adsr';
import type { ModLite } from './modulation-runtime';
import { ModEnvHost } from './mod-env-host';
import { registerRenderer } from './renderer-registry';
import { synthTrim } from './gain-staging';

const ALGORITHMS: number[][][] = [
  [[1], [2], [3], []],      // 0: Serial 4→3→2→1  (op0 = carrier)
  [[1, 2, 3], [], [], []],  // 1: Parallel mods → op0  (op0 = carrier)
  [[1], [], [3], []],       // 2: Two pairs (op3→op2, op1→op0)  (op0, op2 = carriers)
  [[], [], [], []],         // 3: Additive — all four are carriers
];

const CARRIERS: number[][] = [
  [0],
  [0],
  [0, 2],
  [0, 1, 2, 3],
];

const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const FM_DEPTH = 4;
const FB_DEPTH = 2;

class FmSine {
  private phase = 0;
  constructor(private sr: number) {}
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
  private freqs: number[];
  private opA: number[];
  private opD: number[];
  private opS: number[];
  private opR: number[];
  private lvl: number[];
  private algoIdx: number;
  private feedback: number;
  private mix: number;
  private vel: number;
  private fbState = 0;
  private modEnv = new ModEnvHost();
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

  setModEnvelopes(mods: ModLite[]): void { this.modEnv.setModEnvelopes(mods); }
  getAdsrOffsets(): VoiceModOffsets { return this.modEnv.getAdsrOffsets(); }

  renderSample(t: number, moIn?: VoiceModOffsets): number {
    if (t < this.begin) return 0;

    const gate = t <= this.holdEnd ? 1 : 0;
    // Shared-LFO offsets + this voice's per-voice ADSR, keyed by param dot-id.
    const mo = this.modEnv.active ? this.modEnv.combine(t, gate, moIn) : moIn;
    const feedback = mo?.['feedback'] ? Math.max(0, this.feedback + mo['feedback']) : this.feedback;

    const algo = ALGORITHMS[this.algoIdx];
    const carriers = CARRIERS[this.algoIdx];
    const opOut = new Array<number>(4);

    for (let i = 3; i >= 0; i--) {
      const env = this.envs[i].update(t, gate, this.opA[i], this.opD[i], this.opS[i], this.opR[i]);
      // FM index = modulator level, modulatable per op (base + offset, clamped 0..1).
      let fmHz = 0;
      for (const mIdx of algo[i]) {
        const mLvlOff = mo?.[`op${mIdx + 1}.level`];
        const mLvl = mLvlOff ? clamp01(this.lvl[mIdx] + mLvlOff) : this.lvl[mIdx];
        fmHz += opOut[mIdx] * this.freqs[mIdx] * mLvl * FM_DEPTH;
      }
      if (i === 3 && feedback > 0) {
        fmHz += this.fbState * this.freqs[3] * feedback * FB_DEPTH;
      }

      opOut[i] = this.oscs[i].next(this.freqs[i], fmHz) * env;   // raw osc×env (level applied in the carrier mix)
      if (i === 3) this.fbState = opOut[3];
    }

    let out = 0;
    for (const c of carriers) {
      const lo = mo?.[`op${c + 1}.level`];
      const lvl = lo ? clamp01(this.lvl[c] + lo) : this.lvl[c];
      out += opOut[c] * lvl;
    }

    if (gate === 0 && this.envs.every((e) => e.isOff) && t > this.holdEnd) {
      this.done = true;
    }

    const mix = mo?.['amp.mix'] ? Math.max(0, this.mix + mo['amp.mix']) : this.mix;
    let s = out * synthTrim('fm') * mix * this.vel;
    if (mo?.['amp.gain']) s *= Math.max(0, Math.min(2, 1 + mo['amp.gain']));
    return s;
  }
}

registerRenderer('fm', (n, p, sr) => new FMRenderer(n, p, sr));
