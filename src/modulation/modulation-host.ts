// src/modulation/modulation-host.ts
// State container + CRUD for an engine's modulators. Voice spawning is
// stubbed here and filled in by Task 6.

import {
  type ModulationConnection, type ModulationHost,
  type ModulatorKind, type ModulatorState, type ModulatorVoice,
  makeDefaultLFO, makeDefaultADSR,
} from './types';
import { LFOVoice } from './lfo-voice';
import { ADSRVoice } from './adsr-voice';

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
    this.modulators = state.map((m) => ({ ...m, connections: m.connections.map((c) => ({ ...c })) }));
  }

  spawnVoice(ctx: AudioContext, bpm: () => number): Map<string, ModulatorVoice> {
    const out = new Map<string, ModulatorVoice>();
    for (const m of this.modulators) {
      if (!m.enabled) continue;
      out.set(m.id, m.kind === 'lfo' ? new LFOVoice(ctx, m, bpm) : new ADSRVoice(ctx, m));
    }
    return out;
  }
}

export interface ParamRange { min: number; max: number; }
