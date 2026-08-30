// plugins/westcoast/dsp.ts
// Per-sample Westcoast (Buchla-style) voice renderer.
// Ports WestVoice from the legacy node-per-note engine faithfully:
//   complex osc (main lin-FM'd by mod, ring/AM, sub-divider)
//   → DC-bias (symmetry)
//   → wavefolder (Timbre)
//   → low-pass gate (SVF + VCA driven by AD contour)
// Pure — no Web Audio. Sample rate is injected.

import { param, slotOf, SineOsc, TriOsc, SawOsc, Svf, fold, ModEnvHost, velGain01, midiToFreq, clamp01, UnisonStack } from '@loom/plugin-sdk';
import type {
  NoteSpec, ParamBag, ParamIndex, VoiceRenderer, VoiceModOffsets, ModEnvSpec,
} from '@loom/plugin-sdk';

type Osc = { update(f: number): number };

const MAIN_WAVE_OSC = [
  (sr: number): Osc => new SineOsc(sr),   // 0 = sine
  (sr: number): Osc => new TriOsc(sr),    // 1 = triangle
  (sr: number): Osc => new SawOsc(sr),    // 2 = sawtooth
];
const MOD_WAVE_OSC = [
  (sr: number): Osc => new SineOsc(sr),   // 0 = sine
  (sr: number): Osc => new TriOsc(sr),    // 1 = triangle
];

// Sub-divisor lookup: index 0..3 → divisor (0 = off)
const SUBDIV_VALUES = [0, 2, 3, 4];

// Cutoff curve: cutoffHz(norm) = min(18000, 60 * 220^norm)
function cutoffHz(norm: number): number {
  return Math.min(18000, 60 * Math.pow(220, norm));
}

// Multiplier on base cutoff for the contour's filter sweep.
const CUTOFF_ENV_SCALE = 3;

/** Simple AD + optional sustain contour, clocked per-sample. Mirrors the
 *  ConstantSource automation schedule in the legacy WestVoice.trigger. */
class AdContour {
  private val = 0;
  private phase: 'idle' | 'attack' | 'decay' | 'sustain' | 'release' | 'done' = 'idle';
  private phaseStart = 0;
  private peak = 0;
  // Set once the note gate ends. A cycling contour keeps re-triggering only while
  // the note is held; after gate-off it finishes its current decay and goes
  // 'done' so the voice is reaped (otherwise a cycling LPG voice is immortal).
  private ended = false;

  constructor(
    private atk: number,
    private dec: number,
    private amount: number,
    /** 0=pluck (AD, gate-independent), 1=sustain (hold until noteOff then dec) */
    private cmode: number,
    private cycle: boolean,
    /** gate end time for sustain mode / cycling */
    private holdEnd: number,
  ) {
    this.peak = amount;
  }

  /** Signal gate-off to the contour. Stops a cycling contour from re-triggering
   *  and releases a sustained one. */
  noteOff(t: number): void {
    this.ended = true;
    if (this.phase === 'sustain') {
      this.phase = 'release';
      this.phaseStart = t;
    }
  }

  tick(t: number): number {
    switch (this.phase) {
      case 'idle': {
        this.phase = 'attack';
        this.phaseStart = t;
        return 0;
      }
      case 'attack': {
        const dt = t - this.phaseStart;
        if (dt >= this.atk) {
          this.phase = this.cmode === 1 ? 'sustain' : 'decay';
          this.phaseStart = t;
          this.val = this.peak;
          return this.peak;
        }
        this.val = this.peak * (dt / this.atk);
        return this.val;
      }
      case 'decay': {
        const dt = t - this.phaseStart;
        // Exponential decay: setTargetAtTime with time-constant dec/3
        const tau = this.dec / 3;
        this.val = this.peak * Math.exp(-dt / tau);
        if (this.val < 1e-4) {
          if (this.cycle && !this.ended) {
            // Restart the AD cycle (free-running LFO-like contour) — only while
            // the note is still held; after gate-off it finishes here.
            this.phase = 'attack';
            this.phaseStart = t;
            this.val = 0;
          } else {
            this.phase = 'done';
            this.val = 0;
          }
        }
        return this.val;
      }
      case 'sustain': {
        // Hold at peak until noteOff is called
        this.val = this.peak;
        return this.val;
      }
      case 'release': {
        const dt = t - this.phaseStart;
        const tau = this.dec / 3;
        this.val = this.peak * Math.exp(-dt / tau);
        if (this.val < 1e-4) {
          this.phase = 'done';
          this.val = 0;
        }
        return this.val;
      }
      case 'done':
        return 0;
    }
  }

  get isDone(): boolean { return this.phase === 'done'; }
}

export class WestcoastRenderer implements VoiceRenderer {
  // The MAIN oscillator is a unison stack (n=1 by default — one oscillator at
  // unity gain, exactly what it was before). The mod and sub oscillators stay
  // single on purpose: stacking the FM modulator blurs the sidebands into
  // noise, and a stacked sub defeats its point as an anchor.
  private main: UnisonStack;
  private mod: Osc;
  private sub: SineOsc;
  private spreadBase: number;
  private sSpread = -1;

  private freq0: number;            // structural base frequency (from note.midi)
  private subDiv: number;

  private mainGain: number;

  // LPG
  private filter: Svf;
  private filterMode: boolean;     // drives filter cutoff with contour
  private vcaMode: boolean;        // drives VCA with contour; if false, VCA is fixed 1

  // Contour
  private contour: AdContour;

  // Modulation: ModEnvHost (per-voice ADSR) + saved knob bases so generic LFO/ADSR
  // and live knob turns can recompute the timbre params (cutoff, fold, resonance,
  // fmIndex) plus the rest of the LIVE set (ring, subLevel, ratio, detune, tune,
  // symmetry, amp.level) on the note ALREADY sounding.
  private modEnv = new ModEnvHost();
  private foldBase: number;
  private fmIndexBase: number;
  private cutoffNorm: number;       // 0..1 lpg.cutoff knob
  private lpgResBase: number;
  private ratioBase: number;
  private detuneBase: number;
  private tuneBase: number;
  private ringBase: number;
  private subLevelBase: number;
  private symmetryBase: number;     // raw 0..1 knob (the ×0.5 DC-bias scale is applied at read time)
  private levelBase: number;
  private ampTrim: number;          // velocity gain — the frozen part of the amp scalar
  private accentMul: number;

  /** The lane's live (smoothed) values, or null when this voice runs standalone
   *  (the offline kernel builds renderers directly). Addressed by the slots
   *  below, resolved ONCE in setLiveValues; -1 means the lane does not declare
   *  that id, so the trigger snapshot stands. */
  private live: Float64Array | null = null;
  private sTune = -1;
  private sDetune = -1;
  private sRatio = -1;
  private sFmIndex = -1;
  private sRing = -1;
  private sSubLevel = -1;
  private sSymmetry = -1;
  private sFold = -1;
  private sCutoff = -1;
  private sLpgRes = -1;
  private sLevel = -1;
  /** The synthetic tremolo target. Not a declared param — the index appends it,
   *  which is what those three synthetic slots are for. */
  private sAmpGain = -1;
  // Cached expensive conversions, refreshed only when their raw input moves.
  private pitchRaw = NaN;
  private freqEffCache = 0;
  private cutRaw = NaN;
  private cutHzCached = 0;

  // Timing
  private begin: number;
  private holdEnd: number;
  private contourGateTriggered = false;

  done = false;

  constructor(note: NoteSpec, p: ParamBag, private sr: number) {
    this.begin = note.beginSec;
    this.holdEnd = note.beginSec + note.durationSec;

    // Frequency. tune/detune/ratio are LIVE (see renderSample); freq0 is the
    // structural note pitch from MIDI, which never changes mid-note.
    this.freq0 = midiToFreq(note.midi);
    this.tuneBase = param(p, 'master.tune', 0);
    this.detuneBase = param(p, 'osc.detune', 0);
    this.ratioBase = param(p, 'osc.ratio', 2);
    // subDiv is a resolved STRUCTURAL index (frozen): which divisor the sub
    // oscillator uses, or 0 = no sub voice at all.
    this.subDiv = SUBDIV_VALUES[Math.round(param(p, 'osc.subDiv', 0))] ?? 0;

    // Oscillators — wave CHOICE is structural (frozen).
    const mainWave = Math.max(0, Math.min(2, Math.round(param(p, 'osc.mainWave', 0))));
    const modWave = Math.max(0, Math.min(1, Math.round(param(p, 'osc.modWave', 0))));
    // Stack size and mode are structural (a stack cannot grow mid-note without
    // a click); the spread is live. The factory keeps THIS table's numbering —
    // makeOsc's indices mean different waves.
    this.main = new UnisonStack(
      MAIN_WAVE_OSC[mainWave] ?? MAIN_WAVE_OSC[0],
      param(p, 'osc.unison', 1),
      sr,
      param(p, 'osc.unisonMode', 0),
    );
    this.spreadBase = param(p, 'osc.spread', 15);
    this.mod = (MOD_WAVE_OSC[modWave] ?? MOD_WAVE_OSC[0])(sr);
    this.sub = new SineOsc(sr);

    // FM + mix (mirrors WestVoice.trigger exactly) — fmIndex/ring/subLevel are LIVE.
    this.fmIndexBase = param(p, 'osc.fmIndex', 0.2);
    this.ringBase = param(p, 'osc.ring', 0);
    this.mainGain = 0.7;   // fixed in original
    this.subLevelBase = param(p, 'osc.subLevel', 0.3);

    // Wavefolder — fold/symmetry are LIVE.
    this.foldBase = param(p, 'timbre.fold', 0.5);
    const accentMul = note.accent ? 1.3 : 1.0;
    this.symmetryBase = param(p, 'timbre.symmetry', 0);

    // LPG — cutoff/resonance are LIVE; mode is structural (frozen).
    this.filter = new Svf(sr);
    const mode = Math.round(param(p, 'lpg.mode', 2));  // 0=lp, 1=gate, 2=both
    this.filterMode = mode === 0 || mode === 2;
    this.vcaMode = mode === 1 || mode === 2;
    this.cutoffNorm = param(p, 'lpg.cutoff', 0.6);
    // Svf resonance is 0..1 — pass straight through (per carry-forward note).
    // The legacy biquad used Q = 0.5 + res*20; here we map that to 0..1:
    // the 0..1 resonance knob → svf 0..1 resonance directly (as spec'd).
    this.lpgResBase = Math.max(0, Math.min(1, param(p, 'lpg.resonance', 0.2)));

    // Contour — frozen: an AD envelope shape is structural, not a live knob.
    const cmode = Math.round(param(p, 'contour.mode', 0));
    const atk = Math.max(0.001, param(p, 'contour.attack', 0.005));
    const dec = Math.max(0.005, param(p, 'contour.decay', 0.4));
    const amount = param(p, 'contour.amount', 0.9);
    const cycle = Math.round(param(p, 'contour.cycle', 0)) >= 1;
    this.contour = new AdContour(atk, dec, amount, cmode, cycle, this.holdEnd);

    // Amp — level is LIVE; the velocity gain is frozen at trigger. No engine
    // trim here: it is a manifest capability (`outputTrim`) the host multiplies
    // in, together with its synth category gain.
    this.levelBase = param(p, 'amp.level', 0.8);
    // accentMul above is this engine's TIMBRE multiplier — fold drive and cutoff
    // env — and it stays out of here. The amp punch is the shared one, as the
    // legacy WestVoice had it: an accent drives the folder harder, it does not
    // also turn the voice up by the same factor.
    this.ampTrim = velGain01(note.velocity, note.accent);
    this.accentMul = accentMul;
  }

  noteOff(t: number): void {
    // The contour is told ALWAYS. A stop has to be able to end a voice, and
    // wrapping this call in the guard below meant it could not: the guard is
    // there so a late note-off cannot EXTEND a gate that has already passed,
    // which is a statement about `holdEnd` alone.
    //
    // `!(t >= holdEnd)` rather than `t < holdEnd` so a holdEnd that is not a
    // number is repaired instead of frozen — with NaN both comparisons are
    // false, and the version that only ever tightened the hold left the voice
    // sustaining at full level for ever.
    if (!(t >= this.holdEnd)) this.holdEnd = t;
    this.contour.noteOff(t);
  }

  setModEnvelopes(mods: ModEnvSpec[], index: ParamIndex): void { this.modEnv.setModEnvelopes(mods, index); }
  getAdsrOffsets(): VoiceModOffsets { return this.modEnv.getAdsrOffsets(); }
  setLiveValues(values: Float64Array, index: ParamIndex): void {
    this.live = values;
    this.sTune = slotOf(index, 'master.tune');
    this.sDetune = slotOf(index, 'osc.detune');
    this.sRatio = slotOf(index, 'osc.ratio');
    this.sFmIndex = slotOf(index, 'osc.fmIndex');
    this.sRing = slotOf(index, 'osc.ring');
    this.sSubLevel = slotOf(index, 'osc.subLevel');
    this.sSpread = slotOf(index, 'osc.spread');
    this.sSymmetry = slotOf(index, 'timbre.symmetry');
    this.sFold = slotOf(index, 'timbre.fold');
    this.sCutoff = slotOf(index, 'lpg.cutoff');
    this.sLpgRes = slotOf(index, 'lpg.resonance');
    this.sLevel = slotOf(index, 'amp.level');
    this.sAmpGain = slotOf(index, 'amp.gain');
  }

  renderSample(t: number, moIn?: VoiceModOffsets): number {
    if (t < this.begin) return 0;
    const gate = t <= this.holdEnd ? 1 : 0;
    // Generic LFO/ADSR offsets keyed by param dot-id — the timbre params are
    // modulatable (cutoff, fold, resonance, fmIndex); the contour stays native.
    const mo = this.modEnv.active ? this.modEnv.combine(t, gate, moIn) : moIn;
    // Live knobs: turning these moves THIS note. The trigger snapshot is the
    // fallback when no lane bag is attached.
    const L = this.live;

    // --- Pitch: master.tune + osc.detune, live, cached (pow is not a per-
    // sample cost while the knobs are settled). osc.ratio is live too, cheap
    // (a multiply), so it is read fresh each sample.
    const tuneKnob = L && this.sTune >= 0 ? L[this.sTune] : this.tuneBase;
    const detuneKnob = L && this.sDetune >= 0 ? L[this.sDetune] : this.detuneBase;
    const ratioKnob = L && this.sRatio >= 0 ? L[this.sRatio] : this.ratioBase;
    const pitchCents = tuneKnob * 100 + detuneKnob;
    if (pitchCents !== this.pitchRaw) {
      this.pitchRaw = pitchCents;
      this.freqEffCache = this.freq0 * Math.pow(2, pitchCents / 1200);
    }
    const freq = this.freqEffCache;
    const modFreq = freq * ratioKnob;
    const subFreq = this.subDiv > 0 ? freq / this.subDiv : freq;

    // --- Complex oscillator (FM index modulatable) ---
    // Mod osc runs at modFreq, feeds linear FM into main osc via fmDepthHz.
    const fmIndexKnob = L && this.sFmIndex >= 0 ? L[this.sFmIndex] : this.fmIndexBase;
    const fmFactor = freq * ratioKnob * 2;
    const fmIndexEff = mo?.[this.sFmIndex] ? Math.max(0, fmIndexKnob + mo[this.sFmIndex]) : fmIndexKnob;
    const fmDepthHz = fmIndexEff * fmFactor;
    const modSample = this.mod.update(modFreq);
    const mainFreq = freq + modSample * fmDepthHz;
    const spreadKnob = L && this.sSpread >= 0 ? L[this.sSpread] : this.spreadBase;
    const mainSample = this.main.update(mainFreq, 0.5, 0, spreadKnob, 0);

    // Ring/AM: ringMod.gain = modSample, so ring = mainSample * modSample * ringAmt
    // In the original: mainOsc → ringMod (gain.value = 0 initially), modOsc → ringMod.gain
    // → ringGain (gain.value = ring param). So ring output = mainSample * modSample * ringAmt.
    const ringKnob = L && this.sRing >= 0 ? L[this.sRing] : this.ringBase;
    const ringSample = mainSample * modSample * ringKnob;

    // Sub osc — subDiv (whether a sub voice exists at all) is structural/frozen;
    // subLevel is live. The oscillator always advances (even at level 0) so a
    // live level turn from 0 never has to resume from a frozen phase.
    const subLevelKnob = L && this.sSubLevel >= 0 ? L[this.sSubLevel] : this.subLevelBase;
    const subSample = this.subDiv > 0 ? this.sub.update(subFreq) * subLevelKnob : 0;

    // Mix: mainGain*main + ringGain*ring + sub + bias
    // Original: mainGain=0.7, ringGain=ring param, subGain=subLevel
    const symmetryKnob = L && this.sSymmetry >= 0 ? L[this.sSymmetry] : this.symmetryBase;
    const mixRaw = mainSample * this.mainGain + ringSample + subSample + symmetryKnob * 0.5;

    // --- Wavefolder (fold amount modulatable) ---
    const foldKnob = L && this.sFold >= 0 ? L[this.sFold] : this.foldBase;
    const foldEff = mo?.[this.sFold] ? clamp01(foldKnob + mo[this.sFold]) : foldKnob;
    const driveGain = (0.1 + foldEff * 0.9) * this.accentMul;
    const folded = fold(mixRaw, driveGain);

    // --- Contour (AD envelope driving the LPG) ---
    // Trigger gate-off on the contour when the note gate ends (sustain mode needs this)
    if (!this.contourGateTriggered && t >= this.holdEnd) {
      this.contourGateTriggered = true;
      this.contour.noteOff(t);
    }
    const contourVal = this.contour.tick(t);

    // --- Low-pass gate (cutoff + resonance modulatable) ---
    // Cutoff conversion cached: the pow only re-runs when the effective knob moves.
    const cutoffKnob = L && this.sCutoff >= 0 ? L[this.sCutoff] : this.cutoffNorm;
    const cutoffEff = mo?.[this.sCutoff] ? clamp01(cutoffKnob + mo[this.sCutoff]) : cutoffKnob;
    if (cutoffEff !== this.cutRaw) {
      this.cutRaw = cutoffEff;
      this.cutHzCached = cutoffHz(cutoffEff);
    }
    const cutoffBaseHz = this.cutHzCached;
    const cutoffEnvScale = this.filterMode ? cutoffBaseHz * CUTOFF_ENV_SCALE * this.accentMul : 0;
    // Clamp the LIVE read: the constructor clamps this.lpgResBase 0..1, but the
    // live bag is a raw knob write with no such guarantee — filter.ts warns res
    // above ~1.5 blows up the Svf. See I-hardening, 2026-07-26 review.
    const resKnob = L && this.sLpgRes >= 0 ? clamp01(L[this.sLpgRes]) : this.lpgResBase;
    const lpgRes = mo?.[this.sLpgRes] ? clamp01(resKnob + mo[this.sLpgRes]) : resKnob;
    const dynamicCutoff = cutoffBaseHz + contourVal * cutoffEnvScale;
    this.filter.update(folded, dynamicCutoff, lpgRes);

    // VCA: contour drives gain in gate/both mode; in lp-only mode, VCA is fixed 1
    const vca = this.vcaMode ? contourVal : 1;

    // --- Output (amp.level live, amp.gain tremolo) ---
    const levelKnob = L && this.sLevel >= 0 ? L[this.sLevel] : this.levelBase;
    let out = this.filter.lp * vca * levelKnob * this.ampTrim;
    if (mo?.[this.sAmpGain]) out *= Math.max(0, Math.min(2, 1 + mo[this.sAmpGain]));

    // Mark done:
    // - In pluck (gate-independent) mode: done when contour finishes, regardless of gate
    // - In sustain mode: done only after gate ends AND contour finishes
    if (this.contour.isDone) {
      this.done = true;
    }

    return out;
  }
}

Loom.registerRenderer('westcoast', (n, p, sr) => new WestcoastRenderer(n, p, sr));
