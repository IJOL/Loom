// plugins/fm/dsp.ts
// 4-operator FM voice renderer. Pure per-sample DSP — no Web Audio / worklet globals.
// Ports FMVoice from the legacy node-per-note engine with corrected FM tuning:
// per-sample linear-FM so carrier ratios stay in tune across all algorithms.
//
// ALGORITHMS and CARRIERS use 0-indexed ops 0..3 (the manifest's op1..op4):
//   ALGORITHMS[algo][i] = list of op indices that modulate op i
//   CARRIERS[algo]      = op indices that go to the final mix
//
// FM tuning fix: in the node version, modulator output was scaled by (opFreq * 4) Hz.
// Here, carrier phase advances by (freq + modSample * modFreq * modLevel) per sample
// so ratios stay musically in tune regardless of carrier frequency.
//
// Soft-clip and trim: the summed carrier output is soft-clipped via tanh() to prevent
// clipping from high-level operator combinations (e.g., additive four-carrier + accent).
// Per-preset output.trim (default 1) scales the final amplitude. The per-ENGINE trim
// is NOT applied here — it is the manifest's `outputTrim`, which the host multiplies in.
// FM_DEPTH was reviewed down to 3 to reduce harshness and modulation peaks.
//
// ⚠️ WHY outputTrim IS 0.179 AND NOT A ROUNDED 0.25 — copied from the ENGINE_TRIM
// table it came from, because this is exactly the kind of number someone "cleans
// up" to 0.18 six months later if the reasoning is nowhere near it:
//   It was 0.25, then ÷1.4 (2026-07-25). FM used to scale RAW velocity — the
//   AudioWorklet port dropped the `0.3 + 1.1·v` curve — so restoring the curve
//   multiplied a full-velocity note by velGain01(1) = 1.4. What the division puts
//   back is exactly the FULL-velocity level (rms ratio 1.002 vs the pre-change
//   render): that ONE point, not the range. Below it every note is now LOUDER than
//   it was, because the restored curve has a 0.3 floor where raw velocity had none.
//   The lift is (0.3 + 1.1·v) / (1.4·v), unbounded as v → 0: +0.73 dB at the app's
//   default velocity of 90, +9.3 dB at a tenth of full scale, and ×28 (+29 dB) at
//   MIDI velocity 1, the softest note a clip can carry. (Measured values run ~0.02 dB
//   above those, since the trims are stored rounded to three decimals.) That lift is
//   the point — a soft note was a third too quiet on the two engines that lost the
//   curve, and MIDI-import passages went missing — but it is a change, not a
//   restoration, and only v = 1.0 is where it was. Pinned at each of those
//   velocities in the host's gain-staging-velocity.test.ts.
//
// Modulation: generic per-param LFO + per-voice ADSR (ModEnvHost) reach the operator
// LEVELS (FM index), the feedback amount and the output mix — the params that shape
// the FM timbre. The four per-op amp envelopes stay built-in (FM has no single amp env).

import { param, slotOf, midiToFreq, clamp01, Adsr, ModEnvHost, velGain01 } from '@loom/plugin-sdk';
import type {
  NoteSpec, ParamBag, ParamIndex, VoiceRenderer, VoiceModOffsets, ModEnvSpec,
} from '@loom/plugin-sdk';

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

const FM_DEPTH = 3;    // modulation index scale (was 4 — reviewed down; tanh tames peaks)
const FB_DEPTH = 2;
const FM_DRIVE = 1.0;  // pre-soft-clip drive into tanh; ear-tunable

// Per-operator param ids, hoisted: building `op${i}.ratio` etc. inside
// renderSample would allocate a string per operator per sample on the audio
// thread. Index 0..3 matches the 0-based operator index used throughout.
const OP_RATIO_IDS = ['op1.ratio', 'op2.ratio', 'op3.ratio', 'op4.ratio'] as const;
const OP_DETUNE_IDS = ['op1.detune', 'op2.detune', 'op3.detune', 'op4.detune'] as const;
const OP_LEVEL_IDS = ['op1.level', 'op2.level', 'op3.level', 'op4.level'] as const;

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
  private ratioBase: number[] = [];
  private detuneBase: number[] = [];
  private f0 = 0;
  private readonly freqEff = new Float64Array(4);
  // Cache for the per-operator ratio/detune → Hz conversion (a pow call), keyed
  // on the EFFECTIVE (base + mod offset) values that actually feed it — an LFO
  // riding detune must not read a value frozen from the last knob move.
  private readonly opRatioRaw = new Float64Array(4).fill(NaN);
  private readonly opDetuneRaw = new Float64Array(4).fill(NaN);
  private opA: number[];
  private opD: number[];
  private opS: number[];
  private opR: number[];
  private lvl: number[];
  private algoIdx: number;
  private feedback: number;
  private mix: number;
  private vel: number;
  private outputTrim: number;
  private fbState = 0;
  private modEnv = new ModEnvHost();
  /** The lane's live (smoothed) values, or null when this voice runs standalone
   *  (the offline kernel builds renderers directly). Addressed by the slots
   *  below, resolved ONCE in setLiveValues; -1 means the lane does not declare
   *  that id, so the trigger snapshot stands. The per-op ones matter most here:
   *  three string lookups per operator per sample used to be twelve. */
  private live: Float64Array | null = null;
  private sFeedback = -1;
  private sMix = -1;
  private sTrim = -1;
  private readonly sRatio = new Int32Array(4).fill(-1);
  private readonly sDetune = new Int32Array(4).fill(-1);
  private readonly sLevel = new Int32Array(4).fill(-1);
  /** The synthetic tremolo target. Not a declared param — the index appends it,
   *  which is what those three synthetic slots are for. */
  private sAmpGain = -1;
  // Pooled per-sample scratch — allocated once, reused every renderSample call
  // so the audio thread allocates nothing.
  private readonly opOut = new Float64Array(4);
  done = false;

  constructor(note: NoteSpec, p: ParamBag, private sr: number) {
    this.begin = note.beginSec;
    this.holdEnd = note.beginSec + note.durationSec;

    const f = midiToFreq(note.midi);
    this.f0 = f;
    this.algoIdx = Math.max(0, Math.min(3, Math.round(param(p, 'algorithm', 0))));
    this.feedback = param(p, 'feedback', 0);
    this.mix = param(p, 'amp.mix', 0.7);
    this.outputTrim = param(p, 'output.trim', 1);
    this.vel = velGain01(note.velocity, note.accent);

    this.oscs = [];
    this.envs = [];
    this.opA = [];
    this.opD = [];
    this.opS = [];
    this.opR = [];
    this.lvl = [];

    for (let i = 1; i <= 4; i++) {
      this.oscs.push(new FmSine(sr));
      this.envs.push(new Adsr());

      this.ratioBase.push(param(p, `op${i}.ratio`, 1));
      this.detuneBase.push(param(p, `op${i}.detune`, 0));

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

  setModEnvelopes(mods: ModEnvSpec[], index: ParamIndex): void { this.modEnv.setModEnvelopes(mods, index); }
  getAdsrOffsets(): VoiceModOffsets { return this.modEnv.getAdsrOffsets(); }
  setLiveValues(values: Float64Array, index: ParamIndex): void {
    this.live = values;
    this.sFeedback = slotOf(index, 'feedback');
    this.sMix = slotOf(index, 'amp.mix');
    this.sTrim = slotOf(index, 'output.trim');
    this.sAmpGain = slotOf(index, 'amp.gain');
    for (let i = 0; i < 4; i++) {
      this.sRatio[i] = slotOf(index, OP_RATIO_IDS[i]);
      this.sDetune[i] = slotOf(index, OP_DETUNE_IDS[i]);
      this.sLevel[i] = slotOf(index, OP_LEVEL_IDS[i]);
    }
  }

  renderSample(t: number, moIn?: VoiceModOffsets): number {
    if (t < this.begin) return 0;

    const gate = t <= this.holdEnd ? 1 : 0;
    // Shared-LFO offsets + this voice's per-voice ADSR, keyed by param dot-id.
    const mo = this.modEnv.active ? this.modEnv.combine(t, gate, moIn) : moIn;
    // Live knobs: turning these moves THIS note. The trigger snapshot is the
    // fallback when no lane bag is attached.
    const L = this.live;
    const feedbackKnob = L && this.sFeedback >= 0 ? L[this.sFeedback] : this.feedback;
    const mixKnob = L && this.sMix >= 0 ? L[this.sMix] : this.mix;
    const outputTrimKnob = L && this.sTrim >= 0 ? L[this.sTrim] : this.outputTrim;
    const feedback = mo?.[this.sFeedback] ? Math.max(0, feedbackKnob + mo[this.sFeedback]) : feedbackKnob;

    const algo = ALGORITHMS[this.algoIdx];
    const carriers = CARRIERS[this.algoIdx];
    const opOut = this.opOut;

    // Effective op frequencies — ratio and detune are live knobs, each also
    // modulatable (±2 units / ±50¢). The pow conversion is cached against the
    // EFFECTIVE value (knob + mod), so a moving LFO never reads a stale Hz.
    const fe = this.freqEff;
    for (let i = 0; i < 4; i++) {
      const ratioKnob = L && this.sRatio[i] >= 0 ? L[this.sRatio[i]] : this.ratioBase[i];
      const detuneKnob = L && this.sDetune[i] >= 0 ? L[this.sDetune[i]] : this.detuneBase[i];
      const rMod = mo?.[this.sRatio[i]], dMod = mo?.[this.sDetune[i]];
      const effRatio = Math.max(0.01, ratioKnob + (rMod ?? 0) * 2);
      const effDetune = detuneKnob + (dMod ?? 0) * 50;
      if (effRatio !== this.opRatioRaw[i] || effDetune !== this.opDetuneRaw[i]) {
        this.opRatioRaw[i] = effRatio;
        this.opDetuneRaw[i] = effDetune;
        fe[i] = this.f0 * effRatio * Math.pow(2, effDetune / 1200);
      }
    }

    for (let i = 3; i >= 0; i--) {
      const env = this.envs[i].update(t, gate, this.opA[i], this.opD[i], this.opS[i], this.opR[i]);
      // FM index = modulator level, modulatable per op (base + offset, clamped 0..1).
      let fmHz = 0;
      for (const mIdx of algo[i]) {
        const mLvlBase = L && this.sLevel[mIdx] >= 0 ? L[this.sLevel[mIdx]] : this.lvl[mIdx];
        const mLvlOff = mo?.[this.sLevel[mIdx]];
        const mLvl = mLvlOff ? clamp01(mLvlBase + mLvlOff) : mLvlBase;
        fmHz += opOut[mIdx] * fe[mIdx] * mLvl * FM_DEPTH;
      }
      if (i === 3 && feedback > 0) {
        fmHz += this.fbState * fe[3] * feedback * FB_DEPTH;
      }

      opOut[i] = this.oscs[i].next(fe[i], fmHz) * env;   // raw osc×env (level applied in the carrier mix)
      if (i === 3) this.fbState = opOut[3];
    }

    let out = 0;
    for (const c of carriers) {
      const lvlBase = L && this.sLevel[c] >= 0 ? L[this.sLevel[c]] : this.lvl[c];
      const lo = mo?.[this.sLevel[c]];
      const lvl = lo ? clamp01(lvlBase + lo) : lvlBase;
      out += opOut[c] * lvl;
    }

    let allOff = true;
    for (let i = 0; i < 4; i++) { if (!this.envs[i].isOff) { allOff = false; break; } }
    if (gate === 0 && allOff && t > this.holdEnd) {
      this.done = true;
    }

    const mix = mo?.[this.sMix] ? Math.max(0, mixKnob + mo[this.sMix]) : mixKnob;
    const shaped = Math.tanh(out * FM_DRIVE);   // soft-clip: tame harsh peaks, prevent carrier-sum clipping
    // No engine trim here: it is a manifest capability (`outputTrim`) that the
    // host multiplies in, together with its synth category gain. `outputTrimKnob`
    // is the per-PRESET balance (params['output.trim']), which IS the plugin's.
    let s = shaped * outputTrimKnob * mix * this.vel;
    if (mo?.[this.sAmpGain]) s *= Math.max(0, Math.min(2, 1 + mo[this.sAmpGain]));
    return s;
  }
}

Loom.registerRenderer('fm', (n, p, sr) => new FMRenderer(n, p, sr));
