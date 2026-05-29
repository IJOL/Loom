// src/modulation/types.ts
// Pure type definitions for the modular LFO + ADSR system.

export type ModulatorKind = 'lfo' | 'adsr';
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
  rateHz?: number;     // 0.01..40 (free rate)
  waveform?: Waveform;
  bipolar?: boolean;
  syncToBpm?: boolean;
  syncRatio?: string;  // '1/4', '1/8T', '1/4.', ...
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
    syncToBpm: false, syncRatio: '1/4',
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

/** Return a shallow clone with `scope` populated from `defaultScopeFor(kind)`
 *  when missing. Idempotent — calling twice is safe. */
export function normalizeModulator(m: ModulatorState): ModulatorState {
  if (m.scope) return m;
  return { ...m, scope: defaultScopeFor(m.kind) };
}
