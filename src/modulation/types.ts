// src/modulation/types.ts
// Pure type definitions for the modular LFO + ADSR system.

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
   *  only valid value for ADSR). Always set at construction — a freshly
   *  added instance takes its owning component's declared `scopes[0]`
   *  (see ModulatorComponent in modulator-registry.ts). */
  scope: ModulatorScope;

  // LFO-only
  rateHz?: number;     // free rate in Hz (knob maps a piecewise bpm scale)
  waveform?: Waveform;
  bipolar?: boolean;
  syncToBpm?: boolean;
  /** Sync rate as BARS per LFO cycle (the "4" of 4/1 = 4 bars). Free numeric,
   *  so the range is open (8, 16, 32… bars for slow sweeps). */
  syncBars?: number;
  /** Subdivision feel applied on top of syncBars: straight, triplet (×3/2
   *  faster) or dotted (×2/3 slower). */
  syncSubdiv?: 'straight' | 'triplet' | 'dotted';
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

