// src/audio-dsp/subtractive-renderer.ts
import type { NoteSpec, SubParams, ParamBag, ParamIndex, VoiceRenderer, VoiceModOffsets } from './types';
import { param, slotOf } from './types';
import { midiToFreq, clamp01 } from './dsp-util';
import { SineOsc, WhiteNoise } from './osc';
import { UnisonStack, driftDepthFor } from './unison';
import { Svf } from './filter';
import { LadderFilter, type LadderTap } from './ladder';
import { Adsr } from './adsr';
import type { ModLite } from './modulation-runtime';
import { registerRenderer } from './renderer-registry';
import { synthTrim } from './gain-staging';
import { velGain01 } from '../core/velocity-gain';

/** One per-voice ADSR modulator: its own envelope state + the shape/depths from
 *  the ModLite. update() returns env×depth per connected field, gated by the note. */
/** One per-voice ADSR modulator with its targets already resolved to SLOTS —
 *  once, at spawn. Subtractive keeps its own combine rather than using
 *  ModEnvHost because two of its targets are not additive offsets at all: 'amp'
 *  and 'filter.env' BECOME the voice's envelopes. */
interface ModEnv { adsr: Adsr; m: ModLite; slots: Int32Array; depths: Float64Array; }

const NO_SLOTS = new Float64Array(0);

/** Read a dot-id ParamBag into an EXISTING SubParams — no allocation, so the
 *  lane can refresh its live snapshot on the audio thread. Defaults match
 *  subtractive-params.ts / defaultSubParams(). */
export function subParamsInto(b: ParamBag, out: SubParams): SubParams {
  out.masterTune = param(b, 'master.tune', 0);
  out.unisonVoices = param(b, 'master.unison', 1);
  out.unisonDetune = param(b, 'master.detune', 25);
  out.unisonDrift = param(b, 'master.drift', 0);
  out.osc1Wave = param(b, 'osc1.wave', 0);
  out.osc1Level = param(b, 'osc1.level', 0.6);
  out.osc1Detune = param(b, 'osc1.detune', 0);
  out.osc1Pw = param(b, 'osc1.pw', 0.5);
  out.osc2Pw = param(b, 'osc2.pw', 0.5);
  out.osc1Sync = param(b, 'osc1.sync', 2);
  out.osc2Sync = param(b, 'osc2.sync', 2);
  out.osc2Wave = param(b, 'osc2.wave', 1);
  out.osc2Level = param(b, 'osc2.level', 0.4);
  out.osc2Detune = param(b, 'osc2.detune', 7);
  out.subLevel = param(b, 'sub.level', 0.3);
  out.noiseLevel = param(b, 'noise.level', 0);
  out.noiseColor = param(b, 'noise.color', 0.6);
  out.filterCutoff = param(b, 'filter.cutoff', 0.55);
  out.filterResonance = param(b, 'filter.resonance', 0.25);
  out.filterEnvAmount = param(b, 'filter.envAmount', 0.45);
  out.filterModel = param(b, 'filter.model', 0);
  out.filterType = param(b, 'filter.type', 0);
  out.filterDrive = param(b, 'filter.drive', 0);
  out.filterKeyTrack = param(b, 'filter.keyTrack', 0);
  out.filterBuiltinEnv = param(b, 'filter.builtinEnv', 1);
  out.filterAttack = param(b, 'filter.attack', 0.01);
  out.filterDecay = param(b, 'filter.decay', 0.3);
  out.filterSustain = param(b, 'filter.sustain', 0.4);
  out.filterRelease = param(b, 'filter.release', 0.35);
  out.ampBuiltinEnv = param(b, 'amp.builtinEnv', 1);
  out.ampAttack = param(b, 'amp.attack', 0.01);
  out.ampDecay = param(b, 'amp.decay', 0.2);
  out.ampSustain = param(b, 'amp.sustain', 0.7);
  out.ampRelease = param(b, 'amp.release', 0.3);
  return out;
}

/** Allocating form — for a renderer's own trigger-time snapshot. */
export function subParamsFromBag(b: ParamBag): SubParams {
  return subParamsInto(b, {} as SubParams);
}

/** filterType (0=LP, 1=HP, 2=BP, 3=NOTCH) → the ladder tap that honestly serves
 *  it. NOTCH maps to 'lp': a ladder's resonance feedback fills a notch's null in,
 *  so it has no honest notch and keeps its lowpass instead of pretending (see
 *  ladder.ts). DIG — the default model — is a true multimode and does all four. */
const ladderTapFor = (filterType: number): LadderTap =>
  filterType === 1 ? 'hp' : filterType === 2 ? 'bp' : 'lp';

/** Pulse width lives in 0.05..0.95 — the rails of its own param spec. */
const clampPw = (v: number) => Math.min(0.95, Math.max(0.05, v));
/** The unison spread lives in 0..50 cents — the rails of its own param spec. A
 *  negative spread would merely mirror the stack (the positions are symmetric),
 *  so clamping costs nothing and keeps a deep LFO inside the knob's meaning. */
const clampSpread = (v: number) => Math.min(50, Math.max(0, v));
/** Depth 1 on a bipolar LFO sweeps the unison spread across its full range. */
const MOD_UNISON_CENTS = 50;
/** Depth 1 on a bipolar LFO sweeps the width across most of its range, which
 *  is what a PWM pad wants; the clamp keeps it out of silence at the extremes. */
const MOD_PW_RANGE = 0.45;
/** The Sync wave's index in WAVE_OPTIONS (Saw, Sqr, Tri, Sin, Sync). */
const WAVE_SYNC = 4;
/** Sync ratio lives in 1..8 (SYNC_RATIO_MIN/MAX). */
const clampSync = (v: number) => Math.min(8, Math.max(1, v));
/** Depth 1 on a bipolar LFO sweeps the ratio across ~4 octaves of it — the
 *  tearing sweep, the reason to modulate sync at all. */
const MOD_SYNC_RANGE = 3.5;
// Native-unit scale for modulation offsets whose param is NOT a 0..1 knob.
// Depth 1 on a bipolar LFO ⇒ full knob sweep: master.tune ±12 st, osc detune
// ±50 cents (matching the legacy engine's modulation ranges).
const MOD_TUNE_SEMIS = 12;
const MOD_DETUNE_CENTS = 50;
function driveShape(x: number, amount: number): number {
  const k = 1 + amount * amount * 25;
  return Math.tanh(x * k) / Math.tanh(k);
}

export class SubtractiveVoiceRenderer implements VoiceRenderer {
  private sr: number;
  // osc1/osc2 are UNISON STACKS: N detuned copies each (N=1 by default, which is
  // one oscillator at unity gain — exactly what they were before).
  private osc1: UnisonStack; private osc2: UnisonStack;
  /** How far this note's drift can pull the pitch — a fraction of its frequency,
   *  fixed at trigger because it depends only on the note. */
  private driftDepth: number;
  private sub: SineOsc; private noise = new WhiteNoise();
  private noiseLp: Svf; private filter: Svf;
  // The ladders are built only when a patch asks for one — the Svf stays the
  // default, so nothing voiced against it changes.
  private ladder: LadderFilter | null = null;
  // 0 = LP, 1 = HP, 2 = BP, 3 = NOTCH. Read once at trigger, like the model:
  // which tap you take out is a topology, not a knob to sweep mid-note.
  private filterType: number;
  private ampEnv = new Adsr(); private filtEnv = new Adsr();
  private begin: number; private holdEnd: number;
  /** The trigger-time snapshot. It is the FROZEN structural source (waveform,
   *  filter model, envelope times) AND the fallback for a live param whose slot
   *  the lane does not declare — the same role `xBase` plays in the other
   *  renderers, which is all this struct is now. */
  private p: SubParams;
  /** The lane's live (smoothed) values, or null when this voice runs standalone
   *  (the offline kernel builds renderers directly). */
  private live: Float64Array | null = null;
  private sMasterTune = -1;
  private sUnisonDetune = -1;
  private sUnisonDrift = -1;
  private sOsc1Level = -1;
  private sOsc1Detune = -1;
  private sOsc1Pw = -1;
  private sOsc1Sync = -1;
  private sOsc2Level = -1;
  private sOsc2Detune = -1;
  private sOsc2Pw = -1;
  private sOsc2Sync = -1;
  private sSubLevel = -1;
  private sNoiseLevel = -1;
  private sNoiseColor = -1;
  private sFilterCutoff = -1;
  private sFilterResonance = -1;
  private sFilterEnvAmount = -1;
  private sFilterDrive = -1;
  private sFilterKeyTrack = -1;
  /** The synthetic tremolo target. */
  private sAmpGain = -1;
  private velPeak: number;
  // Kept for live recompute of keytrack/env ranges when cutoff/keyTrack/envAmount
  // are modulated (those ranges scale with the live base cutoff).
  private keySemiDelta: number; private accentMul: number;
  // Trigger-time frozen structure. `this.p` becomes the LANE's live snapshot once
  // setLiveSubParams runs, so anything that must NOT change mid-note is copied
  // here at spawn: the two oscillator waves (a Sync wave reinterprets its second
  // argument), the two envelope switches and all eight envelope TIMES.
  private readonly osc1WaveFrozen: number;
  private readonly osc2WaveFrozen: number;
  private readonly ampBuiltinFrozen: number;
  private readonly filterBuiltinFrozen: number;
  private readonly ampA: number; private readonly ampD: number;
  private readonly ampS: number; private readonly ampR: number;
  private readonly filtA: number; private readonly filtD: number;
  private readonly filtS: number; private readonly filtR: number;
  /** Cached cutoff conversion: 60·220^x is not a per-sample cost while nothing moves. */
  private cutRaw = NaN;
  private cutHzCached = 0;
  /** Cached master-tune conversion (the note's base frequency). */
  private tuneRaw = NaN;
  private baseFreqCached = 0;
  private readonly noteHz: number;
  done = false;
  /** Per-voice ADSR modulators, handed in at spawn. Empty ⇒ LFO-only fast path. */
  private modEnvs: ModEnv[] = [];
  /** Pooled effective-offset struct (shared LFO + this voice's ADSR), reused each
   *  sample so the render loop allocates nothing on the audio thread. */
  private effMo: VoiceModOffsets = NO_SLOTS;
  /** This voice's ADSR-only contribution per slot (NOT including the LFO),
   *  refreshed each sample. The worklet reads the most-recent voice's copy to
   *  drive the knob ring (the LFO part is added from the shared activeOffsets). */
  private adsrOnly: VoiceModOffsets = NO_SLOTS;
  /** Every ADDITIVE slot this voice's envelopes write — 'amp' and 'filter.env'
   *  excluded, since those become envelopes rather than offsets. */
  private touched: Int32Array = new Int32Array(0);
  /** The two envelope targets, resolved once so the per-sample loop compares
   *  numbers instead of strings. */
  private sAmpTarget = -1;
  private sFilterEnvTarget = -1;
  /** When an ADSR is routed to the 'amp' target it BECOMES this voice's amplitude
   *  envelope (multiplicative 0..1), replacing the built-in amp env. null ⇒ none. */
  private ampEnvValue: number | null = null;
  /** The Adsr driving 'amp' (for the done test) when an ADSR governs amplitude. */
  private ampEnvAdsr: Adsr | null = null;
  /** When an ADSR is routed to 'filterEnv' it BECOMES this voice's filter envelope
   *  (0..1, scaled by envRangeHz exactly like the built-in), replacing it. null ⇒ none. */
  private filterEnvValue: number | null = null;

  constructor(note: NoteSpec, params: ParamBag, sampleRate: number) {
    this.sr = sampleRate;
    const p = subParamsFromBag(params); this.p = p;
    this.begin = note.beginSec;
    this.holdEnd = note.beginSec + note.durationSec;
    this.noteHz = midiToFreq(note.midi);
    const baseFreq = this.noteHz * Math.pow(2, p.masterTune / 12);
    // The stack size is read once, here: you cannot grow a stack mid-note without
    // a click, so it is a trigger-time decision like the filter model.
    this.osc1 = new UnisonStack(p.osc1Wave, p.unisonVoices, sampleRate);
    this.osc2 = new UnisonStack(p.osc2Wave, p.unisonVoices, sampleRate);
    this.driftDepth = driftDepthFor(baseFreq);
    this.sub = new SineOsc(sampleRate);
    this.noiseLp = new Svf(sampleRate);
    this.filter = new Svf(sampleRate);
    // 0 = DIG (the Svf above), 1 = MOG, 2 = 303. Read once at trigger: a filter
    // model is a topology, not a knob to sweep mid-note.
    const model = Math.round(p.filterModel);
    this.filterType = Math.round(p.filterType);
    // The ladders are a genuine multimode via their stage taps (see ladder.ts) —
    // except the NOTCH, which they cannot do honestly, so it keeps the lowpass.
    if (model === 1 || model === 2) {
      this.ladder = new LadderFilter(model === 1 ? 'moog' : 'diode', sampleRate, ladderTapFor(this.filterType));
    }
    // × output.trim: per-preset gain-staging lever (params['output.trim'], default 1).
    this.velPeak = synthTrim('subtractive') * param(params, 'output.trim', 1) * velGain01(note.velocity, note.accent);
    this.keySemiDelta = note.midi - 60;
    this.accentMul = note.accent ? 1.3 : 1.0;
    this.osc1WaveFrozen = p.osc1Wave;
    this.osc2WaveFrozen = p.osc2Wave;
    this.ampBuiltinFrozen = p.ampBuiltinEnv;
    this.filterBuiltinFrozen = p.filterBuiltinEnv;
    this.ampA = p.ampAttack; this.ampD = p.ampDecay; this.ampS = p.ampSustain; this.ampR = p.ampRelease;
    this.filtA = p.filterAttack; this.filtD = p.filterDecay; this.filtS = p.filterSustain; this.filtR = p.filterRelease;
  }

  /** One sample through whichever filter this patch selected.
   *
   *  DIG is the Svf: clean, cheap, and what every existing preset was voiced
   *  against — hence the default. MOG and 303 are the ladders (see ladder.ts):
   *  four poles, and they thin as they resonate, which the Svf does not do.
   *
   *  The Svf is a true multimode — it has been computing lp, bp AND hp on every
   *  sample all along, and only .lp was ever read. filterType picks the tap.
   *  (The notch is derived inside the Svf, where the damping term is in scope;
   *  the textbook lp+hp does not null in that topology — see filter.ts.) */
  private filterAt(x: number, cutoffHz: number, res: number): number {
    if (this.ladder) return this.ladder.update(x, cutoffHz, res);
    const f = this.filter;
    f.update(x, cutoffHz, res);
    switch (this.filterType) {
      case 1: return f.hp;
      case 2: return f.bp;
      case 3: return f.notch;
      default: return f.lp;
    }
  }

  noteOff(t: number): void { if (t < this.holdEnd) this.holdEnd = t; }

  /** Receive this voice's per-voice ADSR modulators (one Adsr each). Called once
   *  at spawn by the VoiceManager. LFOs are NOT here — they stay shared. The
   *  lane's numbering comes with them so each target resolves to a slot HERE,
   *  not on every sample. */
  setModEnvelopes(mods: ModLite[], index: ParamIndex): void {
    this.effMo = new Float64Array(index.length);
    this.adsrOnly = new Float64Array(index.length);
    this.sAmpTarget = slotOf(index, 'amp');
    this.sFilterEnvTarget = slotOf(index, 'filter.env');
    const touched = new Set<number>();
    this.modEnvs = mods.map((m) => {
      const slots: number[] = [];
      const depths: number[] = [];
      for (const id in m.depthByParam) {
        const depth = m.depthByParam[id];
        if (!depth) continue;
        const slot = index.slot[id];
        if (slot === undefined) continue;   // a target this lane does not declare
        slots.push(slot);
        depths.push(depth);
        // The two envelope targets are handled apart, so they must not be
        // cleared or summed as additive offsets.
        if (slot !== this.sAmpTarget && slot !== this.sFilterEnvTarget) touched.add(slot);
      }
      return { adsr: new Adsr(), m, slots: Int32Array.from(slots), depths: Float64Array.from(depths) };
    });
    this.touched = Int32Array.from(touched);
  }

  /** Swap this voice's param source for the lane's LIVE snapshot. Everything
   *  structural was already copied out in the constructor. */
  setLiveValues(values: Float64Array, index: ParamIndex): void {
    this.live = values;
    this.sMasterTune = slotOf(index, 'master.tune');
    this.sUnisonDetune = slotOf(index, 'master.detune');
    this.sUnisonDrift = slotOf(index, 'master.drift');
    this.sOsc1Level = slotOf(index, 'osc1.level');
    this.sOsc1Detune = slotOf(index, 'osc1.detune');
    this.sOsc1Pw = slotOf(index, 'osc1.pw');
    this.sOsc1Sync = slotOf(index, 'osc1.sync');
    this.sOsc2Level = slotOf(index, 'osc2.level');
    this.sOsc2Detune = slotOf(index, 'osc2.detune');
    this.sOsc2Pw = slotOf(index, 'osc2.pw');
    this.sOsc2Sync = slotOf(index, 'osc2.sync');
    this.sSubLevel = slotOf(index, 'sub.level');
    this.sNoiseLevel = slotOf(index, 'noise.level');
    this.sNoiseColor = slotOf(index, 'noise.color');
    this.sFilterCutoff = slotOf(index, 'filter.cutoff');
    this.sFilterResonance = slotOf(index, 'filter.resonance');
    this.sFilterEnvAmount = slotOf(index, 'filter.envAmount');
    this.sFilterDrive = slotOf(index, 'filter.drive');
    this.sFilterKeyTrack = slotOf(index, 'filter.keyTrack');
    this.sAmpGain = slotOf(index, 'amp.gain');
  }

  /** Fold this voice's gated ADSR envelopes into the shared-LFO offsets, returning
   *  one effective offset set the rest of renderSample reads. Reuses the pooled
   *  struct; `moIn` carries the full 14-field subtractive set, so copying it first
   *  resets every field before the ADSR contributions are added on top. */
  private combineMods(t: number, gate: number, moIn?: VoiceModOffsets): VoiceModOffsets {
    const e = this.effMo;
    const a = this.adsrOnly;
    // Recompute the ADSR-only contribution (cleared first). `touched` is tiny —
    // the slots this voice's connections actually drive, usually one or two.
    for (const s of this.touched) a[s] = 0;
    this.ampEnvValue = null; this.ampEnvAdsr = null; this.filterEnvValue = null;
    for (const me of this.modEnvs) {
      const env = me.adsr.update(
        t, gate, me.m.attackSec ?? 0.01, me.m.decaySec ?? 0.3, me.m.sustain ?? 0.7, me.m.releaseSec ?? 0.3,
      );
      const { slots, depths } = me;
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        const depth = depths[i];
        if (slot === this.sAmpTarget) {
          // 'amp' is the per-voice AMPLITUDE envelope (multiplicative 0..1), not an
          // additive param offset — keep it out of the offset array.
          this.ampEnvValue = (this.ampEnvValue ?? 0) + env * depth;
          this.ampEnvAdsr = me.adsr;
          continue;
        }
        if (slot === this.sFilterEnvTarget) {
          // 'filter.env' is the per-voice FILTER envelope (0..1, scaled by envRangeHz
          // downstream — same as the built-in), not an additive offset.
          this.filterEnvValue = (this.filterEnvValue ?? 0) + env * depth;
          continue;
        }
        a[slot] += env * depth;
      }
    }
    // Effective offsets = shared-LFO base + this voice's ADSR. set() is a memcpy
    // and fill(0) a memset; only the ADSR-touched slots then need adding.
    if (moIn) e.set(moIn); else e.fill(0);
    for (const s of this.touched) e[s] += a[s];
    return e;
  }

  /** This voice's ADSR-only offsets (for the UI knob ring). The worklet reads the
   *  most-recent voice's copy and adds the shared-LFO part on top. */
  getAdsrOffsets(): VoiceModOffsets { return this.adsrOnly; }

  renderSample(t: number, moIn?: VoiceModOffsets): number {
    if (t < this.begin) return 0;
    const p = this.p;
    const L = this.live;
    const gate = t <= this.holdEnd ? 1 : 0;
    // Per-voice ADSR (gated by this note) folded into the shared-LFO offsets.
    // No ADSR ⇒ use the shared struct directly (zero extra work).
    const mo = this.modEnvs.length > 0 ? this.combineMods(t, gate, moIn) : moIn;
    // Live shared-LFO offsets (normalised) applied on top of the spawned-snapshot
    // params at read time, each scaled to its native units and clamped. A falsy
    // (incl. 0) offset takes the cached/base value — the unmodulated path.
    const osc1Level = mo?.[this.sOsc1Level] ? clamp01((L && this.sOsc1Level >= 0 ? L[this.sOsc1Level] : p.osc1Level) + mo[this.sOsc1Level]) : (L && this.sOsc1Level >= 0 ? L[this.sOsc1Level] : p.osc1Level);
    const osc2Level = mo?.[this.sOsc2Level] ? clamp01((L && this.sOsc2Level >= 0 ? L[this.sOsc2Level] : p.osc2Level) + mo[this.sOsc2Level]) : (L && this.sOsc2Level >= 0 ? L[this.sOsc2Level] : p.osc2Level);
    const subLevel  = mo?.[this.sSubLevel]  ? clamp01((L && this.sSubLevel >= 0 ? L[this.sSubLevel] : p.subLevel) + mo[this.sSubLevel])   : (L && this.sSubLevel >= 0 ? L[this.sSubLevel] : p.subLevel);
    const noiseLevel = mo?.[this.sNoiseLevel] ? clamp01((L && this.sNoiseLevel >= 0 ? L[this.sNoiseLevel] : p.noiseLevel) + mo[this.sNoiseLevel]) : (L && this.sNoiseLevel >= 0 ? L[this.sNoiseLevel] : p.noiseLevel);
    // Master tune is continuous, so it moves the sounding note. Cached: the pow
    // only re-runs when the tune knob actually changes.
    if ((L && this.sMasterTune >= 0 ? L[this.sMasterTune] : p.masterTune) !== this.tuneRaw) {
      this.tuneRaw = (L && this.sMasterTune >= 0 ? L[this.sMasterTune] : p.masterTune);
      this.baseFreqCached = this.noteHz * Math.pow(2, (L && this.sMasterTune >= 0 ? L[this.sMasterTune] : p.masterTune) / 12);
    }
    const baseFreq = this.baseFreqCached;
    // Pitch modulation: master tune (±12 st full-depth) → freq multiplier;
    // per-osc detune (±50 cents full-depth) added to the cents knob.
    const f = mo?.[this.sMasterTune] ? baseFreq * Math.pow(2, mo[this.sMasterTune] * MOD_TUNE_SEMIS / 12) : baseFreq;
    const det1 = mo?.[this.sOsc1Detune] ? (L && this.sOsc1Detune >= 0 ? L[this.sOsc1Detune] : p.osc1Detune) + mo[this.sOsc1Detune] * MOD_DETUNE_CENTS : (L && this.sOsc1Detune >= 0 ? L[this.sOsc1Detune] : p.osc1Detune);
    const det2 = mo?.[this.sOsc2Detune] ? (L && this.sOsc2Detune >= 0 ? L[this.sOsc2Detune] : p.osc2Detune) + mo[this.sOsc2Detune] * MOD_DETUNE_CENTS : (L && this.sOsc2Detune >= 0 ? L[this.sOsc2Detune] : p.osc2Detune);
    // Pulse width, and with an LFO on it, pulse-width MODULATION. Clamped to
    // the param's own rails: 0 and 1 are silence, not a thinner sound.
    // The stack's second argument is pulse width for most waves, but the sync
    // ratio for the Sync wave — SyncOsc reads it as its ratio. Both are
    // continuous and modulatable; pick which one this oscillator wants.
    const pw1 = this.osc1WaveFrozen === WAVE_SYNC
      ? clampSync(mo?.[this.sOsc1Sync] ? (L && this.sOsc1Sync >= 0 ? L[this.sOsc1Sync] : p.osc1Sync) + mo[this.sOsc1Sync] * MOD_SYNC_RANGE : (L && this.sOsc1Sync >= 0 ? L[this.sOsc1Sync] : p.osc1Sync))
      : (mo?.[this.sOsc1Pw] ? clampPw((L && this.sOsc1Pw >= 0 ? L[this.sOsc1Pw] : p.osc1Pw) + mo[this.sOsc1Pw] * MOD_PW_RANGE) : (L && this.sOsc1Pw >= 0 ? L[this.sOsc1Pw] : p.osc1Pw));
    const pw2 = this.osc2WaveFrozen === WAVE_SYNC
      ? clampSync(mo?.[this.sOsc2Sync] ? (L && this.sOsc2Sync >= 0 ? L[this.sOsc2Sync] : p.osc2Sync) + mo[this.sOsc2Sync] * MOD_SYNC_RANGE : (L && this.sOsc2Sync >= 0 ? L[this.sOsc2Sync] : p.osc2Sync))
      : (mo?.[this.sOsc2Pw] ? clampPw((L && this.sOsc2Pw >= 0 ? L[this.sOsc2Pw] : p.osc2Pw) + mo[this.sOsc2Pw] * MOD_PW_RANGE) : (L && this.sOsc2Pw >= 0 ? L[this.sOsc2Pw] : p.osc2Pw));
    // Unison: the spread each stack fans its copies across, and the analog drift
    // depth. Both continuous, so an LFO reaches them like any other param — on the
    // spread that is a stack that breathes. Both default to inert (spread only
    // bites above 1 voice; drift is 0), so nothing that exists today moves.
    const spread = mo?.[this.sUnisonDetune] ? clampSpread((L && this.sUnisonDetune >= 0 ? L[this.sUnisonDetune] : p.unisonDetune) + mo[this.sUnisonDetune] * MOD_UNISON_CENTS) : (L && this.sUnisonDetune >= 0 ? L[this.sUnisonDetune] : p.unisonDetune);
    const drift = mo?.[this.sUnisonDrift] ? clamp01((L && this.sUnisonDrift >= 0 ? L[this.sUnisonDrift] : p.unisonDrift) + mo[this.sUnisonDrift]) : (L && this.sUnisonDrift >= 0 ? L[this.sUnisonDrift] : p.unisonDrift);
    const driftAmt = drift * this.driftDepth;
    // oscillators (detune in cents; sub one octave down). The sub and the noise
    // are deliberately NOT scaled by the stack's gain compensation, unlike mpump:
    // they are single sources that never got stacked, so there is nothing to
    // compensate, and sub.level/noise.level keep meaning exactly what they always
    // meant. (Turning unison up therefore fattens the oscillators against them —
    // which is what turning unison up is for.)
    let mix = this.osc1.update(f, pw1, det1, spread, driftAmt) * osc1Level
            + this.osc2.update(f, pw2, det2, spread, driftAmt) * osc2Level
            + this.sub.update(f * 0.5) * subLevel;
    if (noiseLevel > 0) {
      const noiseColor = mo?.[this.sNoiseColor] ? clamp01((L && this.sNoiseColor >= 0 ? L[this.sNoiseColor] : p.noiseColor) + mo[this.sNoiseColor]) : (L && this.sNoiseColor >= 0 ? L[this.sNoiseColor] : p.noiseColor);
      this.noiseLp.update(this.noise.update(), 200 + noiseColor * 14800, 0);
      mix += this.noiseLp.lp * noiseLevel;
    }
    // parallel drive (dry + saturated wet scaled by drive), as in PolySynth
    const drive = mo?.[this.sFilterDrive] ? clamp01((L && this.sFilterDrive >= 0 ? L[this.sFilterDrive] : p.filterDrive) + mo[this.sFilterDrive]) : (L && this.sFilterDrive >= 0 ? L[this.sFilterDrive] : p.filterDrive);
    if (drive > 0) mix = mix + driveShape(mix, 1.0) * drive;
    // Filter cutoff = base + keytrack + envelope contribution. The base is LIVE
    // (the knob under your hand), and modulation adds on top of it. keytrack and
    // env range scale with the base, so they follow it.
    const cut01 = mo?.[this.sFilterCutoff] ? clamp01((L && this.sFilterCutoff >= 0 ? L[this.sFilterCutoff] : p.filterCutoff) + mo[this.sFilterCutoff]) : (L && this.sFilterCutoff >= 0 ? L[this.sFilterCutoff] : p.filterCutoff);
    if (cut01 !== this.cutRaw) {
      this.cutRaw = cut01;
      this.cutHzCached = Math.min(60 * Math.pow(220, cut01), 18000);
    }
    const baseCutoffHz = this.cutHzCached;
    const kt = mo?.[this.sFilterKeyTrack] ? clamp01((L && this.sFilterKeyTrack >= 0 ? L[this.sFilterKeyTrack] : p.filterKeyTrack) + mo[this.sFilterKeyTrack]) : (L && this.sFilterKeyTrack >= 0 ? L[this.sFilterKeyTrack] : p.filterKeyTrack);
    const keyTrackHz = this.keySemiDelta * baseCutoffHz * (Math.pow(2, 1 / 12) - 1) * kt;
    const envAmt = mo?.[this.sFilterEnvAmount] ? clamp01((L && this.sFilterEnvAmount >= 0 ? L[this.sFilterEnvAmount] : p.filterEnvAmount) + mo[this.sFilterEnvAmount]) : (L && this.sFilterEnvAmount >= 0 ? L[this.sFilterEnvAmount] : p.filterEnvAmount);
    const envRangeHz = Math.min(baseCutoffHz * 7, 16000) * envAmt * this.accentMul;
    // Filter envelope. Like amp: the built-in env wins when enabled (presets keep
    // filterBuiltinEnv=1 → unchanged); else an ADSR routed to 'filterEnv' becomes the
    // env — scaled by the SAME envRangeHz, so it sounds identical; else 0.
    let fe: number;
    if (this.filterBuiltinFrozen >= 0.5) {
      fe = this.filtEnv.update(t, gate, this.filtA, this.filtD, this.filtS, this.filtR);
    } else if (this.filterEnvValue != null) {
      fe = this.filterEnvValue;
    } else {
      fe = 0;
    }
    const cutoff = baseCutoffHz + keyTrackHz + fe * envRangeHz;
    // Svf resonance is 0..1 (NOT the biquad's 0..22 Q): damping r = 0.5^((res+0.125)/0.125),
    // so res>~1 makes it near-undamped → resonant blow-up (peak 9× at res=2.475). Map the
    // 0..1 knob straight through; res=1 is already a strong, bounded resonance (peak ~2.8).
    // Modulation offset clamped to 0..1 so a deep LFO can't drive it into blow-up.
    const q = mo?.[this.sFilterResonance] ? clamp01((L && this.sFilterResonance >= 0 ? L[this.sFilterResonance] : p.filterResonance) + mo[this.sFilterResonance]) : (L && this.sFilterResonance >= 0 ? L[this.sFilterResonance] : p.filterResonance);
    const filtered = this.filterAt(mix, cutoff, q);
    // Amp envelope. Priority: the built-in env when enabled (presets keep
    // ampBuiltinEnv=1 → unchanged); else an ADSR routed to 'amp' BECOMES the
    // amplitude envelope (the unified pre-worklet model); else a flat gain.
    let ae: number;
    if (this.ampBuiltinFrozen >= 0.5) {
      ae = this.ampEnv.update(t, gate, this.ampA, this.ampD, this.ampS, this.ampR);
    } else if (this.ampEnvValue != null) {
      ae = this.ampEnvValue < 0 ? 0 : this.ampEnvValue > 1 ? 1 : this.ampEnvValue;
    } else {
      ae = 1;
    }
    let out = filtered * ae * this.velPeak;
    // amp.gain modulation = tremolo: a multiplicative gain on the output
    // (depth 1 ⇒ ±1 ⇒ 0..2×), clamped non-negative.
    if (mo?.[this.sAmpGain]) out *= Math.max(0, Math.min(2, 1 + mo[this.sAmpGain]));
    // Done once the amplitude DRIVER has fully released after the gate: the
    // built-in env, the ADSR 'amp' envelope, or (no envelope) at gate-off. A
    // fixed-gain voice ending at gate-off keeps it from becoming immortal.
    const ampOff = this.ampBuiltinFrozen >= 0.5 ? this.ampEnv.isOff
      : this.ampEnvAdsr ? this.ampEnvAdsr.isOff : true;
    if (gate === 0 && ampOff && t > this.holdEnd) this.done = true;
    return out;
  }
}

registerRenderer('subtractive', (n, p, sr) => new SubtractiveVoiceRenderer(n, p, sr));
