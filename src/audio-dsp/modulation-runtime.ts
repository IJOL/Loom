// src/audio-dsp/modulation-runtime.ts
// In-worklet LFO modulation over the full subtractive modulation target set
// (every SubParams field a connection can reach, plus the synthetic `ampGain`
// tremolo). The runtime returns NORMALISED offsets (sum of wave×depth); the
// renderer scales each to native units (cents/semitones for pitch, ×gain for
// ampGain, 0..1 add for the rest). BPM-synced LFOs ARE honoured: the host
// (WorkletLaneEngine.toModLite) resolves any sync→free Hz via effectiveRateHz
// before sending, so `rateHz` here is already tempo-correct and re-posted on
// every BPM change.
//
// TRIG + SCOPE: both are honoured, and both reduce to ONE question — where does
// the phase start (see PhaseOrigin). A free+shared LFO starts at 0 and is the
// cheap path the render loop takes when nothing needs more; note-triggered and
// per-voice LFOs need an origin per voice, which VoiceManager supplies from each
// slot's note-on time. `needsPerVoicePhase()` tells the loop which path to take.
//
// `kind: 'adsr'` mods contribute zero HERE — they are genuinely per-voice and
// travel a different road: getAdsrMods() hands them to the renderer at spawn,
// which gates an envelope per note (see ModEnvHost).
import type { ModTarget } from './types';

export interface ModLite {
  id: string;
  kind: 'lfo' | 'adsr';
  enabled: boolean;
  rateHz: number;
  waveform: 'sine' | 'triangle' | 'square' | 'saw';
  /** Polarity: bipolar (default) swings -1..+1; unipolar maps the wave to 0..1
   *  so the offset only pushes the target one way. Optional — absent ⇒ bipolar. */
  bipolar?: boolean;
  /** ADSR shape (seconds; sustain 0..1). Present for kind:'adsr' — the renderer
   *  drives a PER-VOICE envelope from these, gated by the note (attack on note-on,
   *  release on note-off), and adds env×depth to each connected param. */
  attackSec?: number;
  decaySec?: number;
  sustain?: number;
  releaseSec?: number;
  /** TRIG: 'free' runs the phase off absolute time; 'note' restarts it on every
   *  note-on. Absent ⇒ 'free' (the historical behaviour). */
  trigger?: 'free' | 'note';
  /** SCOPE: 'shared' is one phase for the whole lane; 'voice' gives each played
   *  note its own phase, so voices drift apart. Absent ⇒ 'shared'. */
  scope?: 'shared' | 'voice';
  /** SubParams field name → modulation depth (-1..1), additive in the field's
   *  native 0..1 units. */
  depthByParam: Record<string, number>;
}

/** Where a modulator's phase starts. TRIG and SCOPE both reduce to this one
 *  question, which is why they share a code path:
 *    free + shared → 0            (one phase for the lane, ignores notes)
 *    note + shared → lastNoteOnT  (the lane retriggers together)
 *    scope 'voice' → voiceStartT  (each note runs its own) */
export interface PhaseOrigin {
  /** When the voice being rendered was triggered. */
  voiceStartT: number;
  /** When the lane most recently received any note-on. */
  lastNoteOnT: number;
}

const SHARED_FREE: PhaseOrigin = { voiceStartT: 0, lastNoteOnT: 0 };

/** The modulator's signal at phase, honouring polarity: bipolar -1..+1 (raw
 *  wave), unipolar 0..1 (wave shifted/scaled so it only pushes one way). */
function signal(m: ModLite, phase: number): number {
  const w = wave(m.waveform, phase);
  return m.bipolar === false ? (w + 1) / 2 : w;
}

function wave(w: ModLite['waveform'], phase: number): number {
  switch (w) {
    case 'square':   return phase < 0.5 ? 1 : -1;
    case 'saw':      return phase * 2 - 1;
    case 'triangle': return phase < 0.5 ? phase * 4 - 1 : 3 - phase * 4;
    default:         return Math.sin(phase * 2 * Math.PI);
  }
}

/** The phase origin for one modulator. Voice scope wins over trigger: a
 *  per-voice LFO always starts with its own note, whatever TRIG says. */
function originFor(m: ModLite, o: PhaseOrigin): number {
  if (m.scope === 'voice') return o.voiceStartT;
  if (m.trigger === 'note') return o.lastNoteOnT;
  return 0;
}

/** Phase of `m` at absolute time `t`, relative to its origin. Guarded against a
 *  negative delta (a voice origin slightly ahead of t at spawn) so the phase
 *  never wraps backwards into a discontinuity. */
function phaseOf(m: ModLite, t: number, o: PhaseOrigin): number {
  const dt = t - originFor(m, o);
  return dt <= 0 ? 0 : (dt * m.rateHz) % 1;
}

export class ModulationRuntime {
  private mods: ModLite[] = [];
  /** True when any enabled LFO needs a per-voice phase (SCOPE=voice or
   *  TRIG=note). Lets the render loop keep the cheap once-per-sample shared path
   *  when nothing asks for more. Recomputed on setMods, never per sample. */
  private perVoicePhase = false;
  // sr is reserved for future per-sample phase accumulation (BPM sync); the
  // current free-rate implementation derives phase from absolute time directly.
  constructor(_sr: number) {}
  setMods(mods: ModLite[]): void {
    this.mods = mods;
    this.perVoicePhase = mods.some(
      (m) => m.enabled && m.kind === 'lfo' && (m.scope === 'voice' || m.trigger === 'note'),
    );
  }

  /** Whether the render loop must compute offsets per voice rather than once per
   *  sample. False for the common all-free/all-shared case. */
  needsPerVoicePhase(): boolean { return this.perVoicePhase; }

  /** The enabled ADSR modulators (per-voice envelopes the renderer drives). LFOs
   *  stay shared in offsetFor/activeOffsets; ADSR is gated per note, so each voice
   *  runs its own envelope from these — the VoiceManager hands them to the renderer
   *  at spawn. */
  getAdsrMods(): ModLite[] {
    return this.mods.filter((m) => m.kind === 'adsr' && m.enabled);
  }
  /** Normalised additive offset (Σ wave×depth over enabled LFOs) for a
   *  modulation target at absolute time t. The renderer scales it to the
   *  target's native units. */
  offsetFor(field: ModTarget, t: number, o: PhaseOrigin = SHARED_FREE): number {
    let sum = 0;
    for (const m of this.mods) {
      if (!m.enabled || m.kind !== 'lfo') continue;
      const depth = m.depthByParam[field as string];
      if (!depth) continue;
      sum += signal(m, phaseOf(m, t, o)) * depth;
    }
    return sum;
  }

  /** Snapshot of the normalised offset for EVERY param any enabled modulator
   *  drives at time t (the sum over all sources, the same value offsetFor
   *  returns). The worklet posts this to the main thread so the knob rings show
   *  the REAL modulation; params with no active modulation are omitted. When
   *  per-voice ADSR lands it adds its contribution here and the rings follow. */
  activeOffsets(t: number, o: PhaseOrigin = SHARED_FREE): Record<string, number> {
    const out: Record<string, number> = {};
    for (const m of this.mods) {
      if (!m.enabled || m.kind !== 'lfo') continue;
      const w = signal(m, phaseOf(m, t, o));
      for (const field in m.depthByParam) {
        const depth = m.depthByParam[field];
        if (!depth) continue;
        out[field] = (out[field] ?? 0) + w * depth;
      }
    }
    return out;
  }

  /** Pooled variant of activeOffsets: fills `out` IN PLACE (zeroing its existing
   *  keys first) so the per-sample render loop allocates nothing on the audio
   *  thread. Generic — `out` is keyed by whatever the connections target
   *  (SubParams fields for Subtractive, param dot-ids for the other engines), so
   *  the same path drives every engine's LFO modulation. */
  offsetsInto(out: Record<string, number>, t: number, o: PhaseOrigin = SHARED_FREE): void {
    for (const k in out) out[k] = 0;
    for (const m of this.mods) {
      if (!m.enabled || m.kind !== 'lfo') continue;
      const w = signal(m, phaseOf(m, t, o));
      for (const field in m.depthByParam) {
        const depth = m.depthByParam[field];
        if (!depth) continue;
        out[field] = (out[field] ?? 0) + w * depth;
      }
    }
  }
}
