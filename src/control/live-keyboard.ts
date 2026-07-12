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
  /**
   * `keyMidi` is the PHYSICAL key pressed and is used ONLY to identify the
   * voice group — it decouples key identity from what actually sounds.
   * `playMidis` is the full list of notes to spawn a voice for (e.g. a chord
   * note-FX expansion); it defaults to `[keyMidi]` when omitted. This
   * decoupling matters because a chord note-FX can transpose its root away
   * from the physical key (a nonzero `octave` param), so `playMidis[0]` may
   * not equal `keyMidi` — `noteOff(laneId, keyMidi)` must still find and
   * release the whole group.
   */
  noteOn(laneId: string, keyMidi: number, velocity: number, playMidis?: number[]): void;
  noteOff(laneId: string, keyMidi: number): void;
  setSustain(on: boolean): void;
  panic(): void;
}

// Gate far in the future so the amp envelope holds at sustain until we release().
const HELD_GATE_SECONDS = 3600;

export function createLiveVoicePool(deps: LiveVoicePoolDeps): LiveVoicePool {
  const groups = new Map<string, Voice[]>();      // key = `${laneId}:${keyMidi}` (physical key)
  const sustained = new Set<string>();            // keys waiting for pedal-up
  let sustainOn = false;

  const keyOf = (laneId: string, keyMidi: number) => `${laneId}:${keyMidi}`;

  function releaseGroup(key: string): void {
    const vs = groups.get(key);
    if (!vs) return;
    groups.delete(key);
    const t = deps.now();
    for (const v of vs) {
      v.release(t);
      deps.defer(() => v.dispose());
    }
  }

  return {
    noteOn(laneId, keyMidi, velocity, playMidis) {
      const key = keyOf(laneId, keyMidi);
      if (groups.has(key)) releaseGroup(key);      // retrigger a stuck/held key cleanly
      const midis = playMidis && playMidis.length ? playMidis : [keyMidi];
      const vs: Voice[] = [];
      for (const m of midis) {
        const voice = deps.spawnVoice(laneId);
        if (!voice) continue;
        voice.trigger(m, deps.now(), { gateDuration: HELD_GATE_SECONDS, velocity });
        vs.push(voice);
      }
      if (vs.length) groups.set(key, vs);
    },
    noteOff(laneId, keyMidi) {
      const key = keyOf(laneId, keyMidi);
      if (sustainOn) { sustained.add(key); return; }
      releaseGroup(key);
    },
    setSustain(on) {
      sustainOn = on;
      if (!on) {
        for (const key of sustained) releaseGroup(key);
        sustained.clear();
      }
    },
    panic() {
      for (const key of Array.from(groups.keys())) releaseGroup(key);
      sustained.clear();
    },
  };
}
