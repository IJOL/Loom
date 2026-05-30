import { getEngine } from '../engines/registry';
import type { FxBus } from '../core/fx';
import type { Sequencer } from '../core/sequencer';
import type { PolySynth } from '../polysynth/polysynth';
import type { InsertChain } from '../plugins/fx/insert-chain';

export interface BpmBroadcasterDeps {
  seq: Sequencer;
  fx: FxBus;
  masterInsertChain: InsertChain;
  // Phase G: polysynth is now a lazy getter — the boot poly lane isn't
  // allocated until applyLoadedSessionState runs. BPM broadcast at boot
  // (before lanes exist) skips null safely.
  getPolysynth(): PolySynth | null;
  getExtraPolys(): Iterable<PolySynth>;
}

export interface BpmBroadcaster {
  broadcast(bpm: number): void;
}

const LANE_HOST_ENGINE_IDS = ['fm', 'karplus', 'subtractive', 'wavetable', 'drums-machine'];

export function createBpmBroadcaster(deps: BpmBroadcasterDeps): BpmBroadcaster {
  const propagateToLaneEngines = (bpm: number): void => {
    for (const id of LANE_HOST_ENGINE_IDS) {
      const eng = getEngine(id) as unknown as { bpm?: number } | undefined;
      if (eng && typeof eng.bpm === 'number') eng.bpm = bpm;
    }
  };
  return {
    broadcast(bpm: number) {
      deps.seq.bpm = bpm;
      deps.fx.setBpmSync(bpm);
      // TODO: propagate BPM to masterInsertChain slots (Task 28 – serialize/sync)
      void deps.masterInsertChain;
      const poly = deps.getPolysynth();
      if (poly) poly.bpm = bpm;
      for (const p of deps.getExtraPolys()) p.bpm = bpm;
      propagateToLaneEngines(bpm);
    },
  };
}
