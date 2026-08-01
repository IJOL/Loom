// src/modulation/modulation-host.ts
// State container + CRUD for an engine's modulators. addModulator and
// spawnVoiceFiltered ask the modulator-registry component for each
// modulator's `kind` — never a switch on 'lfo'/'adsr' — so a third
// registered modulator (built-in or plugin) works here with zero changes.

import {
  type ModulationConnection, type ModulationHost,
  type ModulatorKind, type ModulatorState, type ModulatorVoice,
} from './types';
import { getModulator } from './modulator-registry';

export class ModulationHostImpl implements ModulationHost {
  modulators: ModulatorState[];

  constructor(defaults: ModulatorState[]) {
    this.modulators = defaults.map((m) => ({ ...m, connections: [...m.connections] }));
  }

  addModulator(kind: ModulatorKind): ModulatorState {
    const comp = getModulator(kind);
    if (!comp) throw new Error(`unknown modulator kind: ${kind}`);
    const used = new Set(this.modulators.filter((m) => m.kind === kind).map((m) => m.id));
    let n = 1;
    while (used.has(`${comp.idPrefix}${n}`)) n++;
    const fresh = comp.defaultState(`${comp.idPrefix}${n}`);
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
    return this.spawnVoiceFiltered(ctx, bpm, () => true);
  }

  spawnVoiceFiltered(
    ctx: AudioContext,
    bpm: () => number,
    predicate: (m: ModulatorState) => boolean,
  ): Map<string, ModulatorVoice> {
    const out = new Map<string, ModulatorVoice>();
    for (const m of this.modulators) {
      if (!m.enabled || !predicate(m)) continue;
      // Every modulator is built from its component with the LIVE state object,
      // so a rate or waveform edit reaches the running voice. The old code had
      // to special-case lfo/adsr because the plugin SPI could not receive
      // state at all.
      const comp = getModulator(m.kind);
      if (!comp) { warnUnknownKind(m.kind); continue; }
      out.set(m.id, comp.createVoice(ctx, { state: m, bpm }));
    }
    return out;
  }
}

/** Kinds already reported, so a lane that rebinds on every engine swap does not
 *  fill the console with the same line. */
const warnedKinds = new Set<string>();

/** A saved session can name a modulator whose plugin is no longer installed.
 *  Skipping it is right — a missing plugin must not take the session down — but
 *  skipping it SILENTLY is not: the user would see a modulator listed in the
 *  panel doing nothing at all, with no way to tell why. Say it once per kind. */
function warnUnknownKind(kind: string): void {
  if (warnedKinds.has(kind)) return;
  warnedKinds.add(kind);
  console.warn(
    `[modulation] no component registered for modulator kind "${kind}" — ` +
    'its instances are inert. A plugin that used to provide it may be missing.',
  );
}

export interface ParamRange { min: number; max: number; }
