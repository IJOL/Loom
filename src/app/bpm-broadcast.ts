import { getEngine } from '../engines/registry';
import type { FxBus, FilterChain } from '../core/fx';
import type { Sequencer } from '../core/sequencer';
import type { PolySynth } from '../polysynth/polysynth';

export interface BpmBroadcasterDeps {
  seq: Sequencer;
  fx: FxBus;
  filterChain: FilterChain;
  polysynth: PolySynth;
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
      deps.filterChain.updateBpm(bpm);
      deps.polysynth.bpm = bpm;
      for (const p of deps.getExtraPolys()) p.bpm = bpm;
      propagateToLaneEngines(bpm);
    },
  };
}
