import type { FxBus } from '../core/fx';
import type { Sequencer } from '../core/sequencer';
import type { InsertChain } from '../core/insert-chain';
import type { LaneResourceMap } from '../core/lane-resources';
import { collectStretchJobs } from './stretch-resync';
import { stretchCache } from '../samples/stretch-cache';
import { stretchBuffer } from '../samples/timestretch';
import { sampleCache } from '../samples/sample-cache';
import { collectWarpJobs } from './warp-resync';
import { warpCache } from '../samples/warp-cache';
import { warpStretch, warpKey } from '../samples/warp-stretch';

export interface BpmBroadcasterDeps {
  seq: Sequencer;
  fx: FxBus;
  masterInsertChain: InsertChain;
  /** Lane resources map — forwarded to per-lane insert chains when BPM changes. */
  laneResources: LaneResourceMap;
  /** Optional: live AudioContext + session-state getter, used to re-render
   *  stretch-mode loop buffers when the tempo changes. When absent, the resync
   *  is a no-op. */
  ctx?: AudioContext;
  getSessionState?: () => import('../session/session').SessionState | null | undefined;
}

export interface BpmBroadcaster {
  broadcast(bpm: number): void;
}

export function createBpmBroadcaster(deps: BpmBroadcasterDeps): BpmBroadcaster {
  let resyncTimer: ReturnType<typeof setTimeout> | null = null;
  const resyncStretches = (bpm: number): void => {
    if (!deps.ctx || !deps.getSessionState) return;
    if (resyncTimer) clearTimeout(resyncTimer);
    resyncTimer = setTimeout(() => {
      const state = deps.getSessionState?.();
      if (!state) return;
      const jobs = collectStretchJobs(state, bpm, deps.seq.meter);
      for (const job of jobs) {
        const buf = sampleCache.get(job.sampleId);
        if (!buf) continue;
        void stretchCache.ensure(job.sampleId, job.ratio, () => stretchBuffer(deps.ctx!, buf, job.ratio));
      }
      for (const job of collectWarpJobs(state, bpm, deps.seq.meter)) {
        const buf = sampleCache.get(job.sampleId);
        if (!buf) continue;
        void warpCache.ensure(warpKey(job.sampleId, job.markers, job.gate), () => warpStretch(deps.ctx!, buf, job.markers, job.gate));
      }
    }, 120);
  };
  return {
    broadcast(bpm: number) {
      // Every tempo change comes through here, which makes this the only place
      // one can be refused — and a tempo that is not a number has to be, because
      // of what it does downstream. Note times are `(60 / bpm) / 96` per tick,
      // so a NaN tempo makes every note's gate NaN, on EVERY lane at once; and a
      // gate of NaN is a voice that can neither reach its own gate-off nor be
      // released by a stop, since every comparison against NaN is false. One
      // bad tempo would lock the whole instrument into noise until reload.
      //
      // The paths that reach here are the ones that read a tempo from somewhere
      // else — a MIDI file, a detected loop, a save, a demo — and `clampBpm` is
      // `Math.max/min`, which passes NaN through untouched.
      //
      // Keeping the tempo we have is the honest answer: there is no sensible
      // number to invent, and the caller asked for one that does not exist.
      if (!Number.isFinite(bpm)) return;
      deps.seq.bpm = bpm;
      // Broadcast BPM to all insert chains (send buses, per-lane, master).
      for (const send of deps.fx.sends) send.inserts.setBpm(bpm);
      for (const [, res] of deps.laneResources) res.inserts.setBpm(bpm);
      deps.masterInsertChain.setBpm(bpm);
      resyncStretches(bpm);
    },
  };
}
