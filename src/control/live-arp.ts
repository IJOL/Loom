// Live arpeggiator: while a key is held on a lane whose arp note-FX is enabled,
// run the existing scale-arp (generateArpSequence) from the held note in real
// time, synced to tempo. Mono (last note wins). Octaves forced to 1 ("from the
// current note, no octave expansion"). Each step honours the arp GATE.
import { generateArpSequence, type ArpProcessorParams } from '../notefx/arp-processor';
import { syncDivToHz } from '../core/sync-div';
import { getNoteFxChain } from '../notefx/notefx-registry';
import type { Voice } from '../engines/engine-types';

/** Seconds between arp steps for the given params + bpm (mirrors ArpProcessor). */
export function arpIntervalSec(p: ArpProcessorParams, bpm: number): number {
  if (p.rate === 'free') return 1 / Math.max(0.001, p.rateFreeHz);
  const hz = syncDivToHz(bpm, p.rate);
  return hz > 0 ? 1 / hz : 1 / Math.max(0.001, p.rateFreeHz);
}

/** The lane's enabled arp note-FX params with octaves forced to 1 (live: arp the
 *  held note within one octave), or null when no arp note-FX is enabled. */
export function liveArpParamsFor(laneId: string): ArpProcessorParams | null {
  const chain = getNoteFxChain(laneId);
  const arp = chain?.noteFx.find((s) => s.enabled && s.kind === 'arp');
  if (!arp) return null;
  return { ...(arp.params as unknown as ArpProcessorParams), octaves: 1 };
}

// Pre-generate this many steps and cycle (periodic for up/down/updown; a fixed
// loop for random/cosmic — fine for v1). 32 steps ≈ 4s at 1/16 @ 120bpm.
const SEQ_LEN = 32;

export interface LiveArpDeps {
  spawnVoice: (laneId: string) => Voice | null;
  now: () => number;
  bpm: () => number;
  /** Injectable for tests (default real timers). */
  setTimer?: (fn: () => void, ms: number) => number;
  clearTimer?: (id: number) => void;
  defer?: (fn: () => void, ms: number) => void;   // schedule the voice dispose
}

export interface LiveArp {
  /** Start (or restart, mono) the arp from `root` on `laneId`. Returns false if
   *  the lane has no arp enabled — the caller should then sound the note normally. */
  start(laneId: string, root: number, velocity: number): boolean;
  /** Stop the arp iff it is the one started by this (laneId, key). */
  stop(laneId: string, key: number): void;
  isRunning(): boolean;
  panic(): void;
}

export function createLiveArp(deps: LiveArpDeps): LiveArp {
  const setTimer = deps.setTimer ?? ((fn, ms) => setInterval(fn, ms) as unknown as number);
  const clearTimer = deps.clearTimer ?? ((id) => clearInterval(id));
  const defer = deps.defer ?? ((fn, ms) => { setTimeout(fn, ms); });

  let running: { laneId: string; key: number; timer: number } | null = null;

  function halt(): void {
    if (!running) return;
    clearTimer(running.timer);
    running = null;
  }

  return {
    start(laneId, root, velocity) {
      const params = liveArpParamsFor(laneId);
      if (!params) return false;
      halt();                                   // mono: a new key restarts the arp
      const interval = arpIntervalSec(params, deps.bpm());
      const gateSec = Math.max(0.01, interval * params.gate);
      const seq = generateArpSequence(root, params.pattern, 1, params.scale, SEQ_LEN);
      let i = 0;
      const step = (): void => {
        const note = seq[i % seq.length] ?? root;
        i++;
        const v = deps.spawnVoice(laneId);
        if (v) {
          v.trigger(note, deps.now(), { gateDuration: gateSec, velocity });
          defer(() => v.dispose(), (gateSec + 0.25) * 1000);
        }
      };
      step();                                   // first step immediately
      running = { laneId, key: root, timer: setTimer(step, interval * 1000) };
      return true;
    },
    stop(laneId, key) {
      if (running && running.laneId === laneId && running.key === key) halt();
    },
    isRunning: () => running != null,
    panic: halt,
  };
}
