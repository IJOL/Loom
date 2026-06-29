// src/audio-dsp/subtractive-renderer.ts
import type { NoteSpec, SubParams, ParamBag, VoiceRenderer, VoiceModOffsets } from './types';
import { param } from './types';
import { midiToFreq, clamp01 } from './dsp-util';
import { SawOsc, SquareOsc, TriOsc, SineOsc, WhiteNoise } from './osc';
import { Svf } from './filter';
import { Adsr } from './adsr';
import type { ModLite } from './modulation-runtime';
import { registerRenderer } from './renderer-registry';
import { synthTrim } from './gain-staging';

/** One per-voice ADSR modulator: its own envelope state + the shape/depths from
 *  the ModLite. update() returns env×depth per connected field, gated by the note. */
interface ModEnv { adsr: Adsr; m: ModLite; }

/** Read a dot-id ParamBag into the typed SubParams snapshot the renderer uses
 *  internally. Defaults match subtractive-params.ts / defaultSubParams(). */
function subParamsFromBag(b: ParamBag): SubParams {
  return {
    masterTune: param(b, 'master.tune', 0),
    osc1Wave: param(b, 'osc1.wave', 0), osc1Level: param(b, 'osc1.level', 0.6), osc1Detune: param(b, 'osc1.detune', 0),
    osc2Wave: param(b, 'osc2.wave', 1), osc2Level: param(b, 'osc2.level', 0.4), osc2Detune: param(b, 'osc2.detune', 7),
    subLevel: param(b, 'sub.level', 0.3),
    noiseLevel: param(b, 'noise.level', 0), noiseColor: param(b, 'noise.color', 0.6),
    filterCutoff: param(b, 'filter.cutoff', 0.55), filterResonance: param(b, 'filter.resonance', 0.25), filterEnvAmount: param(b, 'filter.envAmount', 0.45),
    filterDrive: param(b, 'filter.drive', 0), filterKeyTrack: param(b, 'filter.keyTrack', 0), filterBuiltinEnv: param(b, 'filter.builtinEnv', 1),
    filterAttack: param(b, 'filter.attack', 0.01), filterDecay: param(b, 'filter.decay', 0.3), filterSustain: param(b, 'filter.sustain', 0.4), filterRelease: param(b, 'filter.release', 0.35),
    ampBuiltinEnv: param(b, 'amp.builtinEnv', 1),
    ampAttack: param(b, 'amp.attack', 0.01), ampDecay: param(b, 'amp.decay', 0.2), ampSustain: param(b, 'amp.sustain', 0.7), ampRelease: param(b, 'amp.release', 0.3),
  };
}

type Osc = { update(freq: number): number };
function makeOsc(wave: number, sr: number): Osc {
  switch (wave) {
    case 1: return new SquareOsc(sr);
    case 2: return new TriOsc(sr);
    case 3: return new SineOsc(sr);
    default: return new SawOsc(sr);
  }
}
const detuneMul = (cents: number) => Math.pow(2, cents / 1200);
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
  private osc1: Osc; private osc2: Osc; private sub: SineOsc; private noise = new WhiteNoise();
  private noiseLp: Svf; private filter: Svf;
  private ampEnv = new Adsr(); private filtEnv = new Adsr();
  private begin: number; private holdEnd: number;
  private p: SubParams;
  private baseFreq: number; private velPeak: number;
  private baseCutoffHz: number; private keyTrackHz: number; private envRangeHz: number;
  // Kept for live recompute of keytrack/env ranges when cutoff/keyTrack/envAmount
  // are modulated (those ranges scale with the live base cutoff).
  private keySemiDelta: number; private accentMul: number;
  done = false;
  /** Per-voice ADSR modulators, handed in at spawn. Empty ⇒ LFO-only fast path. */
  private modEnvs: ModEnv[] = [];
  /** Pooled effective-offset struct (shared LFO + this voice's ADSR), reused each
   *  sample so the render loop allocates nothing on the audio thread. */
  private readonly effMo: VoiceModOffsets = {};
  /** This voice's ADSR-only contribution per field (NOT including the LFO),
   *  refreshed each sample. The worklet reads the most-recent voice's copy to
   *  drive the knob ring (the LFO part is added from the shared activeOffsets). */
  private readonly adsrOnly: VoiceModOffsets = {};
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
    this.baseFreq = midiToFreq(note.midi) * Math.pow(2, p.masterTune / 12);
    this.osc1 = makeOsc(p.osc1Wave, sampleRate);
    this.osc2 = makeOsc(p.osc2Wave, sampleRate);
    this.sub = new SineOsc(sampleRate);
    this.noiseLp = new Svf(sampleRate);
    this.filter = new Svf(sampleRate);
    // 0.4 * velGain(...) with NoteSpec.velocity already normalised 0..1.
    // velToGain(v01) = 0.3 + 1.1*v01 ; accent amp punch = 1.1 (ACCENT_PUNCH).
    this.velPeak = synthTrim('subtractive') * (0.3 + 1.1 * note.velocity) * (note.accent ? 1.1 : 1.0);
    this.baseCutoffHz = Math.min(60 * Math.pow(220, p.filterCutoff), 18000);
    this.keySemiDelta = note.midi - 60;
    this.keyTrackHz = this.keySemiDelta * this.baseCutoffHz * (Math.pow(2, 1 / 12) - 1) * p.filterKeyTrack;
    this.accentMul = note.accent ? 1.3 : 1.0;
    this.envRangeHz = Math.min(this.baseCutoffHz * 7, 16000) * p.filterEnvAmount * this.accentMul;
  }

  noteOff(t: number): void { if (t < this.holdEnd) this.holdEnd = t; }

  /** Receive this voice's per-voice ADSR modulators (one Adsr each). Called once
   *  at spawn by the VoiceManager. LFOs are NOT here — they stay shared. */
  setModEnvelopes(mods: ModLite[]): void {
    this.modEnvs = mods.map((m) => ({ adsr: new Adsr(), m }));
  }

  /** Fold this voice's gated ADSR envelopes into the shared-LFO offsets, returning
   *  one effective offset set the rest of renderSample reads. Reuses the pooled
   *  struct; `moIn` carries the full 14-field subtractive set, so copying it first
   *  resets every field before the ADSR contributions are added on top. */
  private combineMods(t: number, gate: number, moIn?: VoiceModOffsets): VoiceModOffsets {
    const e = this.effMo as Record<string, number>;
    const a = this.adsrOnly as Record<string, number>;
    // Recompute the ADSR-only contribution (cleared first; fields are fixed by the
    // connection set, so this loop is tiny — 1-2 entries).
    for (const k in a) a[k] = 0;
    this.ampEnvValue = null; this.ampEnvAdsr = null; this.filterEnvValue = null;
    for (const me of this.modEnvs) {
      const env = me.adsr.update(
        t, gate, me.m.attackSec ?? 0.01, me.m.decaySec ?? 0.3, me.m.sustain ?? 0.7, me.m.releaseSec ?? 0.3,
      );
      const depths = me.m.depthByParam;
      for (const field in depths) {
        const depth = depths[field];
        if (!depth) continue;
        if (field === 'amp') {
          // 'amp' is the per-voice AMPLITUDE envelope (multiplicative 0..1), not an
          // additive param offset — keep it out of the offset struct.
          this.ampEnvValue = (this.ampEnvValue ?? 0) + env * depth;
          this.ampEnvAdsr = me.adsr;
          continue;
        }
        if (field === 'filterEnv') {
          // 'filterEnv' is the per-voice FILTER envelope (0..1, scaled by envRangeHz
          // downstream — same as the built-in), not an additive offset.
          this.filterEnvValue = (this.filterEnvValue ?? 0) + env * depth;
          continue;
        }
        a[field] = (a[field] ?? 0) + env * depth;
      }
    }
    // Effective offsets = shared-LFO base + this voice's ADSR. moIn carries all 14
    // subtractive fields, so copying it resets every field before adding the ADSR.
    if (moIn) Object.assign(e, moIn); else for (const k in e) e[k] = 0;
    for (const k in a) e[k] = (e[k] ?? 0) + a[k];
    return this.effMo;
  }

  /** This voice's ADSR-only offsets (for the UI knob ring). The worklet reads the
   *  most-recent voice's copy and adds the shared-LFO part on top. */
  getAdsrOffsets(): VoiceModOffsets { return this.adsrOnly; }

  renderSample(t: number, moIn?: VoiceModOffsets): number {
    if (t < this.begin) return 0;
    const p = this.p;
    const gate = t <= this.holdEnd ? 1 : 0;
    // Per-voice ADSR (gated by this note) folded into the shared-LFO offsets.
    // No ADSR ⇒ use the shared struct directly (zero extra work).
    const mo = this.modEnvs.length > 0 ? this.combineMods(t, gate, moIn) : moIn;
    // Live shared-LFO offsets (normalised) applied on top of the spawned-snapshot
    // params at read time, each scaled to its native units and clamped. A falsy
    // (incl. 0) offset takes the cached/base value — the unmodulated path.
    const osc1Level = mo?.osc1Level ? clamp01(p.osc1Level + mo.osc1Level) : p.osc1Level;
    const osc2Level = mo?.osc2Level ? clamp01(p.osc2Level + mo.osc2Level) : p.osc2Level;
    const subLevel  = mo?.subLevel  ? clamp01(p.subLevel + mo.subLevel)   : p.subLevel;
    const noiseLevel = mo?.noiseLevel ? clamp01(p.noiseLevel + mo.noiseLevel) : p.noiseLevel;
    // Pitch modulation: master tune (±12 st full-depth) → freq multiplier;
    // per-osc detune (±50 cents full-depth) added to the cents knob.
    const f = mo?.masterTune ? this.baseFreq * Math.pow(2, mo.masterTune * MOD_TUNE_SEMIS / 12) : this.baseFreq;
    const det1 = mo?.osc1Detune ? p.osc1Detune + mo.osc1Detune * MOD_DETUNE_CENTS : p.osc1Detune;
    const det2 = mo?.osc2Detune ? p.osc2Detune + mo.osc2Detune * MOD_DETUNE_CENTS : p.osc2Detune;
    // oscillators (detune in cents; sub one octave down)
    let mix = this.osc1.update(f * detuneMul(det1)) * osc1Level
            + this.osc2.update(f * detuneMul(det2)) * osc2Level
            + this.sub.update(f * 0.5) * subLevel;
    if (noiseLevel > 0) {
      const noiseColor = mo?.noiseColor ? clamp01(p.noiseColor + mo.noiseColor) : p.noiseColor;
      this.noiseLp.update(this.noise.update(), 200 + noiseColor * 14800, 0);
      mix += this.noiseLp.lp * noiseLevel;
    }
    // parallel drive (dry + saturated wet scaled by drive), as in PolySynth
    const drive = mo?.filterDrive ? clamp01(p.filterDrive + mo.filterDrive) : p.filterDrive;
    if (drive > 0) mix = mix + driveShape(mix, 1.0) * drive;
    // filter cutoff = base + keytrack + envelope contribution. Each input is
    // modulatable; keytrack/env ranges scale with the (possibly modulated) base
    // cutoff, so recompute them only when cutoff/keyTrack/envAmount is modulated.
    let baseCutoffHz = this.baseCutoffHz;
    if (mo?.filterCutoff) {
      baseCutoffHz = Math.min(60 * Math.pow(220, clamp01(p.filterCutoff + mo.filterCutoff)), 18000);
    }
    let keyTrackHz = this.keyTrackHz;
    if (mo?.filterCutoff || mo?.filterKeyTrack) {
      const kt = mo?.filterKeyTrack ? clamp01(p.filterKeyTrack + mo.filterKeyTrack) : p.filterKeyTrack;
      keyTrackHz = this.keySemiDelta * baseCutoffHz * (Math.pow(2, 1 / 12) - 1) * kt;
    }
    let envRangeHz = this.envRangeHz;
    if (mo?.filterCutoff || mo?.filterEnvAmount) {
      const env = mo?.filterEnvAmount ? clamp01(p.filterEnvAmount + mo.filterEnvAmount) : p.filterEnvAmount;
      envRangeHz = Math.min(baseCutoffHz * 7, 16000) * env * this.accentMul;
    }
    // Filter envelope. Like amp: the built-in env wins when enabled (presets keep
    // filterBuiltinEnv=1 → unchanged); else an ADSR routed to 'filterEnv' becomes the
    // env — scaled by the SAME envRangeHz, so it sounds identical; else 0.
    let fe: number;
    if (p.filterBuiltinEnv >= 0.5) {
      fe = this.filtEnv.update(t, gate, p.filterAttack, p.filterDecay, p.filterSustain, p.filterRelease);
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
    const q = mo?.filterResonance ? clamp01(p.filterResonance + mo.filterResonance) : p.filterResonance;
    this.filter.update(mix, cutoff, q);
    // Amp envelope. Priority: the built-in env when enabled (presets keep
    // ampBuiltinEnv=1 → unchanged); else an ADSR routed to 'amp' BECOMES the
    // amplitude envelope (the unified pre-worklet model); else a flat gain.
    let ae: number;
    if (p.ampBuiltinEnv >= 0.5) {
      ae = this.ampEnv.update(t, gate, p.ampAttack, p.ampDecay, p.ampSustain, p.ampRelease);
    } else if (this.ampEnvValue != null) {
      ae = this.ampEnvValue < 0 ? 0 : this.ampEnvValue > 1 ? 1 : this.ampEnvValue;
    } else {
      ae = 1;
    }
    let out = this.filter.lp * ae * this.velPeak;
    // amp.gain modulation = tremolo: a multiplicative gain on the output
    // (depth 1 ⇒ ±1 ⇒ 0..2×), clamped non-negative.
    if (mo?.ampGain) out *= Math.max(0, Math.min(2, 1 + mo.ampGain));
    // Done once the amplitude DRIVER has fully released after the gate: the
    // built-in env, the ADSR 'amp' envelope, or (no envelope) at gate-off. A
    // fixed-gain voice ending at gate-off keeps it from becoming immortal.
    const ampOff = p.ampBuiltinEnv >= 0.5 ? this.ampEnv.isOff
      : this.ampEnvAdsr ? this.ampEnvAdsr.isOff : true;
    if (gate === 0 && ampOff && t > this.holdEnd) this.done = true;
    return out;
  }
}

registerRenderer('subtractive', (n, p, sr) => new SubtractiveVoiceRenderer(n, p, sr));
