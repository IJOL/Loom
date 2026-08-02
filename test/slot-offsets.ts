// test/slot-offsets.ts
// Wire a STANDALONE renderer the way the VoiceManager does, for tests that build
// one directly instead of going through a lane.
//
// Why it is needed: modulation offsets are addressed by the lane's ParamIndex,
// and a renderer learns that numbering in setLiveValues. A renderer that never
// received one has every slot at -1 and correctly ignores modulation — which is
// right in production (the VoiceManager always hands it over before the first
// sample) but silently turns a hand-built test renderer deaf.
//
// The live array is seeded FROM the same params the renderer was constructed
// with, so attaching it changes nothing the test was measuring: the live value
// and the trigger snapshot agree.
import { buildParamIndex } from '../src/audio-dsp/param-index';
import type { ParamBag, ParamIndex, VoiceRenderer } from '../src/audio-dsp/types';

export interface SlotHarness {
  index: ParamIndex;
  live: Float64Array;
  /** Build a modulation-offset array from a name-keyed literal. Call it OUTSIDE
   *  the render loop: it allocates, and the audio path never does. */
  mo(offsets: Record<string, number>): Float64Array;
}

/** `output.trim` is included for the same reason the lane seeds it: fm and
 *  karplus read it live and no engine declares it. */
export function attachSlots(v: VoiceRenderer, params: ParamBag): SlotHarness {
  const index = buildParamIndex([...Object.keys(params), 'output.trim']);
  const live = new Float64Array(index.length);
  for (const id in params) live[index.slot[id]] = params[id];
  v.setLiveValues?.(live, index);
  return {
    index,
    live,
    mo(offsets: Record<string, number>): Float64Array {
      const a = new Float64Array(index.length);
      for (const k in offsets) {
        const s = index.slot[k];
        if (s === undefined) throw new Error(`no slot for modulation target '${k}' — the test's params do not declare it`);
        a[s] = offsets[k];
      }
      return a;
    },
  };
}
