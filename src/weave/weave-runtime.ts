// Turns a lane's weave into the predicate the scheduler asks, once per note.
//
// The blend is computed once per distinct weight set and cached, because
// tickLane asks this for EVERY note in the look-ahead window. Refolding four
// patterns per note would put the crossfade inside the audio budget, which is
// the one place in Loom where being clever costs dropouts.

import type { NoteEvent } from '../core/notes';
import { blendLoops, type BlendOptions } from './blend-clip';
import { laneWeights, type LaneWeaveConfig } from './weave-state';

const hitKey = (tick: number, midi: number) => `${tick}:${midi}`;

export type WeaveGate = (
  note: { midi: number },
  scheduleTime: number,
  clipTick: number,
) => boolean;

export function createWeaveGate(cfg: LaneWeaveConfig, o: BlendOptions): WeaveGate {
  let cacheKey = '';
  let allowed = new Set<string>();

  const refresh = () => {
    const weights = laneWeights(cfg);
    // Rounding keeps a continuously moving fader from busting the cache on
    // every animation frame. 1e-3 of a crossfade is finer than any audible
    // step, and coarse enough that a slow sweep refolds tens of times rather
    // than thousands.
    const key = weights.map((w) => w.weight.toFixed(3)).join(',') + `|${o.barTicks}`;
    if (key === cacheKey) return;
    cacheKey = key;
    allowed = new Set(
      blendLoops(weights, o).map((n: NoteEvent) => hitKey(n.start % o.barTicks, n.midi)),
    );
  };

  return (note, _scheduleTime, clipTick) => {
    refresh();
    // The scheduler counts ticks from the clip start and keeps counting across
    // iterations; the blend only ever describes one bar.
    const inBar = ((clipTick % o.barTicks) + o.barTicks) % o.barTicks;
    return allowed.has(hitKey(inBar, note.midi));
  };
}
