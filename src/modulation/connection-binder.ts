// Stateful connection binder: maintains the set of GainNode bridges between
// modulator outputs and destination AudioParams. Calling apply() with the
// current modulator state diffs against the active set, creating new gains
// and disposing removed ones, so the audio graph stays in sync with state
// changes made AFTER voice creation.

import type { ModulationConnection, ModulatorState, ModulatorVoice } from './types';
import type { ParamRange } from './modulation-host';

function lookupBare<T>(map: Record<string, T>, key: string): T | undefined {
  if (map[key] !== undefined) return map[key];
  const dot = key.indexOf('.');
  if (dot >= 0) {
    const tail = key.slice(dot + 1);
    if (map[tail] !== undefined) return map[tail];
  }
  return undefined;
}

interface ActiveBinding {
  gain: GainNode;
  depth: number;
  range: { min: number; max: number };
  paramId: string;
}

export class ConnectionBinder {
  private bindings = new Map<string, ActiveBinding>();   // key: `${modId}.${connId}`

  activeCount(): number {
    return this.bindings.size;
  }

  apply(
    voiceMods: Map<string, ModulatorVoice>,
    modulators: ModulatorState[],
    voiceParamMap: Record<string, AudioParam>,
    paramRanges: Record<string, ParamRange>,
    ctx: AudioContext,
  ): void {
    const wanted = new Set<string>();

    for (const mod of modulators) {
      if (!mod.enabled) continue;
      const src = voiceMods.get(mod.id);
      if (!src) continue;
      for (const conn of mod.connections) {
        const key = `${mod.id}.${conn.id}`;
        const dest = lookupBare(voiceParamMap, conn.paramId);
        const range = lookupBare(paramRanges, conn.paramId);
        if (!dest || !range) continue;
        wanted.add(key);

        let active = this.bindings.get(key);
        if (!active) {
          const gain = ctx.createGain();
          gain.gain.value = conn.depth * (range.max - range.min);
          src.output.connect(gain);
          gain.connect(dest);
          this.bindings.set(key, { gain, depth: conn.depth, range, paramId: conn.paramId });
        } else {
          // Reuse the existing gain node — just update gain.value when depth changes.
          const newVal = conn.depth * (range.max - range.min);
          if (active.depth !== conn.depth) {
            active.gain.gain.value = newVal;
            active.depth = conn.depth;
          }
        }
      }
    }

    // Disconnect + dispose bindings no longer wanted.
    for (const [key, active] of [...this.bindings]) {
      if (!wanted.has(key)) {
        active.gain.disconnect();
        this.bindings.delete(key);
      }
    }
  }

  /** Disposes all active bindings (used when the host voice itself is disposed). */
  disposeAll(): void {
    for (const [, active] of this.bindings) {
      active.gain.disconnect();
    }
    this.bindings.clear();
  }
}
// Convenience export for the case where the caller manages its own
// connection list (e.g. legacy bindVoiceModulation callers from before the
// binder was introduced).
export type { ModulationConnection };
