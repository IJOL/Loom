// src/export/offline-seamless-loop.test.ts
//
// The offline WAV export must loop SEAMLESSLY like the live scene. Rendering a
// single musical cycle and cutting it at the exact bar length is NOT seamless:
// release/decay/reverb tails of notes near the loop end are chopped, and the loop
// start ramps up with no overlapping tail from the previous cycle — an audible
// jump when the WAV repeats. Fix: render TWO cycles and return the SECOND one. The
// 2nd cycle is steady-state (cycle-1's tails already overlap its start), so it
// loops seamlessly — at the SAME exact musical length.

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { OfflineSceneRecorder } from './offline-recorder';
import { bootstrapPlugins } from '../app/plugin-bootstrap';
import { emptyLanePlayState, type LanePlayState } from '../session/session-runtime';
import { DEFAULT_METER } from '../core/meter';
import type { SessionState, SessionClip } from '../session/session';

function rms(a: Float32Array, from: number, to: number): number {
  let s = 0; const n = Math.max(1, to - from);
  for (let i = from; i < to; i++) s += a[i] * a[i];
  return Math.sqrt(s / n);
}

describe('OfflineSceneRecorder seamless loop', () => {
  beforeAll(() => { bootstrapPlugins(); });

  it('renders two cycles and returns the SECOND, at the exact musical length', async () => {
    // A tb303 note whose gate crosses the loop boundary (starts at 1.75s of a 2s
    // bar and holds ~1s). Cycle 1 starts silent (before the note); cycle 2 starts
    // WITH that held note still sounding — so the two cycles differ at their start,
    // and returning cycle 2 is what makes the loop seamless.
    const clip: SessionClip = { color: '#a8e8b8', gridResolution: '1/16',
      id: 'c', lengthBars: 1,
      notes: [{ start: 336, duration: 192, midi: 40, velocity: 110 }],
    };
    const state: SessionState = { name: 'Test', masterInserts: [], musicality: { key: 9, scale: 'minor', style: 'acid-techno', lock: false }, sends: [],
      lanes: [{ inserts: [], id: 'tb-303-1', engineId: 'tb303', clips: [clip] }],
      scenes: [], globalQuantize: '1/1',
    };
    const laneStates = new Map<string, LanePlayState>();
    const lp = emptyLanePlayState('tb-303-1'); lp.playing = clip;
    laneStates.set('tb-303-1', lp);

    const sr = 44100;
    const totalSec = 2.0;   // one bar @ 120 BPM 4/4
    const cycleFrames = Math.round(totalSec * sr);

    // Capture the FULL rendered buffer (both cycles) to prove which half is returned.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proto = (globalThis as any).OfflineAudioContext.prototype;
    const orig = proto.startRendering;
    let full: AudioBuffer | null = null;
    const spy = vi.spyOn(proto, 'startRendering').mockImplementation(async function (this: unknown) {
      const buf = await (orig as () => Promise<AudioBuffer>).call(this);
      full = buf;
      return buf;
    });

    try {
      const rec = new OfflineSceneRecorder({ state, laneStates, bpm: 120, meter: DEFAULT_METER, sampleRate: sr });
      const rendered = await rec.record(totalSec);

      expect(full).not.toBeNull();
      // Rendered TWO cycles...
      expect(full!.length).toBe(cycleFrames * 2);
      // ...returned ONE cycle (exact musical length preserved, warp stays 1.0)...
      expect(rendered.channels[0].length).toBe(cycleFrames);
      // ...and it is the SECOND cycle, byte-for-byte, not the first.
      const second = full!.getChannelData(0).slice(cycleFrames, cycleFrames * 2);
      expect(Array.from(rendered.channels[0])).toEqual(Array.from(second));

      // Validity: the returned (2nd) cycle starts WITH the crossing note's tail,
      // whereas cycle 1 starts silent — so cycle 2 has real energy at its start.
      const win = Math.round(0.05 * sr);
      const firstCycle = full!.getChannelData(0).slice(0, cycleFrames);
      const startEnergy2nd = rms(rendered.channels[0], 0, win);
      const startEnergy1st = rms(firstCycle, 0, win);
      expect(startEnergy2nd).toBeGreaterThan(startEnergy1st * 2);
    } finally {
      spy.mockRestore();
    }
  });
});
