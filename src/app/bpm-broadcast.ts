import { getEngine } from '../engines/registry';
import type { FxBus } from '../core/fx';
import type { Sequencer } from '../core/sequencer';
import type { PolySynth } from '../polysynth/polysynth';
import type { InsertChain } from '../plugins/fx/insert-chain';
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
  // Phase G: polysynth is now a lazy getter — the boot poly lane isn't
  // allocated until applyLoadedSessionState runs. BPM broadcast at boot
  // (before lanes exist) skips null safely.
  getPolysynth(): PolySynth | null;
  getExtraPolys(): Iterable<PolySynth>;
  /** Optional: live AudioContext + session-state getter, used to re-render
   *  stretch-mode loop buffers when the tempo changes. When absent, the resync
   *  is a no-op. */
  ctx?: AudioContext;
  getSessionState?: () => import('../session/session').SessionState | null | undefined;
}

export interface BpmBroadcaster {
  broadcast(bpm: number): void;
}

const LANE_HOST_ENGINE_IDS = ['fm', 'karplus', 'subtractive', 'wavetable', 'drums-machine', 'westcoast'];

export function createBpmBroadcaster(deps: BpmBroadcasterDeps): BpmBroadcaster {
  const propagateToLaneEngines = (bpm: number): void => {
    for (const id of LANE_HOST_ENGINE_IDS) {
      const eng = getEngine(id) as unknown as { bpm?: number } | undefined;
      if (eng && typeof eng.bpm === 'number') eng.bpm = bpm;
    }
  };
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
      deps.seq.bpm = bpm;
      deps.fx.setBpmSync(bpm);
      // Broadcast BPM to all insert chains (send buses, per-lane, master).
      for (const send of deps.fx.sends) send.inserts.setBpm(bpm);
      for (const [, res] of deps.laneResources) res.inserts.setBpm(bpm);
      deps.masterInsertChain.setBpm(bpm);
      const poly = deps.getPolysynth();
      if (poly) poly.bpm = bpm;
      for (const p of deps.getExtraPolys()) p.bpm = bpm;
      propagateToLaneEngines(bpm);
      resyncStretches(bpm);
    },
  };
}
