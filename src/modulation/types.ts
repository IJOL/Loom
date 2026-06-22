// src/modulation/types.ts
// Pure type definitions for the modular LFO + ADSR system.

import { parseSyncRatioToBars } from './rate-sync';

export type ModulatorKind = string;
export type Waveform = 'sine' | 'triangle' | 'square' | 'saw';
/** LFO phase behavior on note-on. 'free' = ignore notes (classic analog),
 *  'note' = reset phase on every trigger (retrigger / sync to note). */
export type LfoTriggerMode = 'free' | 'note';
export type ModulatorScope = 'shared' | 'per-voice';

export interface ModulationConnection {
  id: string;          // unique within the modulator
  paramId: string;     // destination param-id (matches automationRegistry keys)
  depth: number;       // -1..+1; final = output * depth * (paramMax - paramMin)
}

export interface ModulatorState {
  id: string;          // 'lfo1', 'adsr1', ...
  kind: ModulatorKind;
  enabled: boolean;
  connections: ModulationConnection[];
  /** Where the modulator's voice lives. 'shared' = engine-owned, one
   *  instance for all notes (default for LFO). 'per-voice' = spawned per
   *  createVoice call, lives for the duration of that note (default and
   *  only valid value for ADSR). */
  scope?: ModulatorScope;

  // LFO-only
  rateHz?: number;     // free rate in Hz (knob maps a piecewise bpm scale)
  waveform?: Waveform;
  bipolar?: boolean;
  syncToBpm?: boolean;
  /** Sync rate as BARS per LFO cycle (the "4" of 4/1 = 4 bars). Free numeric,
   *  so the range is open (8, 16, 32… bars for slow sweeps). When present this
   *  supersedes the legacy `syncRatio` string. */
  syncBars?: number;
  /** Subdivision feel applied on top of syncBars: straight, triplet (×3/2
   *  faster) or dotted (×2/3 slower). */
  syncSubdiv?: 'straight' | 'triplet' | 'dotted';
  /** @deprecated legacy preset-dropdown ratio ('1/4', '1/8T', '1/4.'…). Still
   *  honored by effectiveRateHz when syncBars is absent (old saves); migrated
   *  to syncBars/syncSubdiv by normalizeModulator. */
  syncRatio?: string;
  trigger?: LfoTriggerMode;

  // ADSR-only
  attackSec?: number;
  decaySec?: number;
  sustain?: number;    // 0..1
  releaseSec?: number;
}

export interface ModulatorVoice {
  output: AudioNode;
  trigger(time: number, opts: { gateDuration: number; accent?: boolean }): void;
  release(time: number): void;
  dispose(): void;
  currentValue(): number;   // for UI only; not for audio path
  /** Optional: upper bound (seconds) on how long this modulator keeps running
   *  AFTER the gate ends — i.e. its release tail. A polyhost voice uses it to
   *  schedule disposal of its one-shot per-voice modulators once the note is
   *  fully done, so free-running playback doesn't accumulate live nodes.
   *  Omitted ⇒ treated as 0 (free-running modulators like the shared LFO must
   *  NOT implement this; they're owned by the engine, not the note). */
  tailSec?(): number;
}

export interface ModulationHost {
  modulators: ModulatorState[];
  addModulator(kind: ModulatorKind): ModulatorState;
  removeModulator(id: string): void;
  setConnection(modId: string, conn: ModulationConnection): void;
  removeConnection(modId: string, connId: string): void;
  spawnVoice(ctx: AudioContext, bpm: () => number): Map<string, ModulatorVoice>;
  spawnVoiceFiltered(
    ctx: AudioContext,
    bpm: () => number,
    predicate: (m: ModulatorState) => boolean,
  ): Map<string, ModulatorVoice>;
  serialize(): ModulatorState[];
  deserialize(state: ModulatorState[]): void;
}

// Default modulator factory shapes (used by engines + add buttons).
export function makeDefaultLFO(id: string): ModulatorState {
  return {
    id, kind: 'lfo', enabled: true, connections: [],
    rateHz: 4, waveform: 'sine', bipolar: true,
    syncToBpm: false, syncBars: 0.25, syncSubdiv: 'straight', syncRatio: '1/4',
    trigger: 'free',
    scope: 'shared',
  };
}

export function makeDefaultADSR(id: string): ModulatorState {
  return {
    id, kind: 'adsr', enabled: true, connections: [],
    attackSec: 0.01, decaySec: 0.3, sustain: 0.7, releaseSec: 0.3,
    scope: 'per-voice',
  };
}

/** Default scope for a modulator kind. Used by normalizeModulator to fill in
 *  the field on older saves that pre-date the scope concept. */
export function defaultScopeFor(kind: ModulatorKind): ModulatorScope {
  return kind === 'lfo' ? 'shared' : 'per-voice';
}

/** Fill in fields missing on older saves. Idempotent — calling twice is safe.
 *  Populates `scope`, and migrates a legacy `syncRatio` string into the
 *  numeric `syncBars`/`syncSubdiv` model so the new sync UI shows the saved
 *  value (and effectiveRateHz uses the same path everywhere). */
export function normalizeModulator(m: ModulatorState): ModulatorState {
  let out = m;
  if (!out.scope) out = { ...out, scope: defaultScopeFor(out.kind) };
  if (out.kind === 'lfo' && out.syncBars == null && out.syncRatio) {
    const parsed = parseSyncRatioToBars(out.syncRatio);
    if (parsed) out = { ...out, syncBars: parsed.bars, syncSubdiv: parsed.subdiv };
  }
  return out;
}
