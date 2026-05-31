// src/modulation/modulation-host.ts
// State container + CRUD for an engine's modulators. Voice spawning is
// stubbed here and filled in by Task 6.

import {
  type ModulationConnection, type ModulationHost,
  type ModulatorKind, type ModulatorState, type ModulatorVoice,
  makeDefaultLFO, makeDefaultADSR,
  normalizeModulator,
} from './types';
import { LFOVoice } from './lfo-voice';
import { ADSRVoice } from './adsr-voice';
import { createInstance } from '../plugins/registry';
import type { ModulatorInstance } from '../plugins/types';

function modulatorInstanceAsVoice(inst: ModulatorInstance, _m: ModulatorState): ModulatorVoice {
  return {
    output: inst.output,
    trigger: (t, o) => inst.trigger?.(t, o),
    release: (t)    => inst.release?.(t),
    dispose: ()     => inst.dispose(),
    currentValue: () => 0,
  };
}

export class ModulationHostImpl implements ModulationHost {
  modulators: ModulatorState[];

  constructor(defaults: ModulatorState[]) {
    this.modulators = defaults.map((m) => ({ ...m, connections: [...m.connections] }));
  }

  addModulator(kind: ModulatorKind): ModulatorState {
    const prefix = kind === 'lfo' ? 'lfo' : 'adsr';
    const used = new Set(this.modulators.filter(m => m.kind === kind).map(m => m.id));
    let n = 1;
    while (used.has(`${prefix}${n}`)) n++;
    const id = `${prefix}${n}`;
    const fresh = kind === 'lfo' ? makeDefaultLFO(id) : makeDefaultADSR(id);
    this.modulators.push(fresh);
    return fresh;
  }

  removeModulator(id: string): void {
    const idx = this.modulators.findIndex((m) => m.id === id);
    if (idx >= 0) this.modulators.splice(idx, 1);
  }

  setConnection(modId: string, conn: ModulationConnection): void {
    const mod = this.modulators.find((m) => m.id === modId);
    if (!mod) return;
    const existing = mod.connections.findIndex((c) => c.id === conn.id);
    if (existing >= 0) mod.connections[existing] = conn;
    else mod.connections.push(conn);
  }

  removeConnection(modId: string, connId: string): void {
    const mod = this.modulators.find((m) => m.id === modId);
    if (!mod) return;
    const idx = mod.connections.findIndex((c) => c.id === connId);
    if (idx >= 0) mod.connections.splice(idx, 1);
  }

  serialize(): ModulatorState[] {
    return this.modulators.map((m) => ({ ...m, connections: m.connections.map((c) => ({ ...c })) }));
  }

  deserialize(state: ModulatorState[]): void {
    this.modulators = state.map((m) => {
      const norm = normalizeModulator(m);
      return { ...norm, connections: norm.connections.map((c) => ({ ...c })) };
    });
  }

  spawnVoice(ctx: AudioContext, bpm: () => number): Map<string, ModulatorVoice> {
    return this.spawnVoiceFiltered(ctx, bpm, () => true);
  }

  spawnVoiceFiltered(
    ctx: AudioContext,
    bpm: () => number,
    predicate: (m: ModulatorState) => boolean,
  ): Map<string, ModulatorVoice> {
    const out = new Map<string, ModulatorVoice>();
    for (const m of this.modulators) {
      if (!m.enabled) continue;
      if (!predicate(m)) continue;
      // Built-in modulators MUST be constructed with the live `m` state so the
      // UI's rate/waveform edits and the rAF currentValue() poll reach the
      // actual oscillator/envelope. The plugin registry's create(ctx, bpm)
      // signature can't receive `m`, so a registry-made instance is a
      // stateless stub (its LFOVoice uses a throwaway state and the wrapper's
      // currentValue() returns 0) — never route lfo/adsr through it.
      if (m.kind === 'lfo')  { out.set(m.id, new LFOVoice(ctx, m, bpm)); continue; }
      if (m.kind === 'adsr') { out.set(m.id, new ADSRVoice(ctx, m));     continue; }
      // Unknown/custom kinds: best-effort via the plugin registry. Live state
      // sync is unsupported until the modulator SPI carries `state`.
      const inst = createInstance('modulator', m.kind, ctx, bpm());
      if (inst) out.set(m.id, modulatorInstanceAsVoice(inst, m));
    }
    return out;
  }
}

export interface ParamRange { min: number; max: number; }
