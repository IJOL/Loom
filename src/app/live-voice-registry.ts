// src/app/live-voice-registry.ts
// Per-lane registry of LIVE voices created by the trigger dispatch.
//
// Voices are created fire-and-forget by createTriggerForLane, so the stop
// paths (transport Stop, STOP ALL, stopLane/stopAll) had nothing to silence:
// short gated notes self-terminate via their gate, but a long 'audio' channel
// clip schedules a whole-loop AudioBufferSourceNode that nobody references, so
// it kept playing to the end after any Stop. This registry hands the stop seams
// a handle to release() those still-sounding voices immediately.
//
// Leak safety: gated voices self-terminate but are never explicitly unrecorded,
// so the per-lane set is bounded by a cap and evicts the oldest beyond it.
// release() on an already-finished voice is a harmless no-op (the engines guard
// their source stop with try/catch), so over-retaining is safe; under-retaining
// only risks a long voice slipping the cap — which is why the cap is generous.

import type { Voice } from '../engines/engine-types';

const DEFAULT_CAP = 64;

/** Minimal surface used by the stop seams to silence live voices. */
export interface VoiceSilencer {
  silenceLane(laneId: string, now: number): void;
  silenceAll(now: number): void;
}

export class LiveVoiceRegistry implements VoiceSilencer {
  /** Insertion-ordered live voices per lane (oldest first). */
  private byLane = new Map<string, Voice[]>();

  constructor(private readonly capPerLane = DEFAULT_CAP) {}

  /** Track a newly-created voice for a lane. Beyond the per-lane cap the oldest
   *  tracked voice is dropped (it has almost certainly self-terminated by gate). */
  record(laneId: string, voice: Voice): void {
    let arr = this.byLane.get(laneId);
    if (!arr) { arr = []; this.byLane.set(laneId, arr); }
    arr.push(voice);
    if (arr.length > this.capPerLane) arr.splice(0, arr.length - this.capPerLane);
  }

  /** Silence one lane. Prefers the engine's whole-lane seam when it has one:
   *  `release()` is now strictly per-voice (so a live key-up can't kill a held
   *  chord), which means releasing only the voices WE track would leave any the
   *  cap above already evicted still sounding. `silenceLane()` doesn't care what
   *  we tracked. Engines without it fall back to a per-voice sweep. */
  silenceLane(laneId: string, now: number): void {
    const arr = this.byLane.get(laneId);
    if (!arr) return;
    silence(arr, now);
    this.byLane.delete(laneId);
  }

  /** Silence every lane, then forget them all. */
  silenceAll(now: number): void {
    for (const arr of this.byLane.values()) silence(arr, now);
    this.byLane.clear();
  }
}

/** One lane's worth of voices. Uses the whole-lane seam once if it exists,
 *  otherwise releases each voice individually. */
function silence(voices: readonly Voice[], now: number): void {
  const laneSeam = voices.find((v) => typeof v.silenceLane === 'function');
  if (laneSeam) {
    try { laneSeam.silenceLane!(); } catch { /* already gone */ }
    // Voices of OTHER engine kinds can share a lane entry (an engine swap mid-
    // session), so sweep the rest too. Releasing an already-silent voice is a
    // documented no-op.
  }
  for (const v of voices) {
    if (v === laneSeam) continue;
    try { v.release(now); } catch { /* already gone */ }
  }
}
