// src/control/live-keyboard.ts
import type { Voice } from '../engines/engine-types';

export interface LiveVoicePoolDeps {
  /** Spawn a fresh engine voice for a lane, routed to its output. null if lane gone. */
  spawnVoice: (laneId: string) => Voice | null;
  /** Current audio time (ctx.currentTime). */
  now: () => number;
  /** Defer disposal until the release tail has finished (default: setTimeout ~300ms). */
  defer: (fn: () => void) => void;
}

export interface LiveVoicePool {
  noteOn(laneId: string, midi: number, velocity: number): void;
  noteOff(laneId: string, midi: number): void;
  setSustain(on: boolean): void;
  panic(): void;
}

// Gate far in the future so the amp envelope holds at sustain until we release().
const HELD_GATE_SECONDS = 3600;

export function createLiveVoicePool(deps: LiveVoicePoolDeps): LiveVoicePool {
  const held = new Map<string, Voice>();          // key = `${laneId}:${midi}`
  const sustained = new Set<string>();            // keys waiting for pedal-up
  let sustainOn = false;

  const keyOf = (laneId: string, midi: number) => `${laneId}:${midi}`;

  function releaseVoice(key: string): void {
    const v = held.get(key);
    if (!v) return;
    held.delete(key);
    const t = deps.now();
    v.release(t);
    deps.defer(() => v.dispose());
  }

  return {
    noteOn(laneId, midi, velocity) {
      const key = keyOf(laneId, midi);
      if (held.has(key)) releaseVoice(key);       // retrigger a stuck/held key cleanly
      const voice = deps.spawnVoice(laneId);
      if (!voice) return;
      voice.trigger(midi, deps.now(), { gateDuration: HELD_GATE_SECONDS, velocity });
      held.set(key, voice);
    },
    noteOff(laneId, midi) {
      const key = keyOf(laneId, midi);
      if (sustainOn) { sustained.add(key); return; }
      releaseVoice(key);
    },
    setSustain(on) {
      sustainOn = on;
      if (!on) {
        for (const key of sustained) releaseVoice(key);
        sustained.clear();
      }
    },
    panic() {
      for (const key of Array.from(held.keys())) releaseVoice(key);
      sustained.clear();
    },
  };
}
