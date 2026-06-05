// src/export/offline-recorder.dsp.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { OfflineSceneRecorder } from './offline-recorder';
import { bootstrapPlugins } from '../app/plugin-bootstrap';
import { emptyLanePlayState, type LanePlayState } from '../session/session-runtime';
import { DEFAULT_METER } from '../core/meter';
import type { SessionState, SessionClip } from '../session/session';

function rms(ch: Float32Array): number {
  let s = 0;
  for (let i = 0; i < ch.length; i++) s += ch[i] * ch[i];
  return Math.sqrt(s / ch.length);
}

describe('OfflineSceneRecorder (DSP)', () => {
  beforeAll(() => { bootstrapPlugins(); });

  it('renders a non-silent stereo buffer of the requested length for a tb303 scene', async () => {
    const clip: SessionClip = {
      id: 'c', lengthBars: 1,
      notes: [
        { start: 0, duration: 24, midi: 40, velocity: 110 },
        { start: 48, duration: 24, midi: 43, velocity: 110 },
      ],
    };
    const state: SessionState = {
      lanes: [{ id: 'tb-303-1', engineId: 'tb303', clips: [clip] }],
      scenes: [], globalQuantize: '1/1',
    };
    const laneStates = new Map<string, LanePlayState>();
    const lp = emptyLanePlayState('tb-303-1'); lp.playing = clip;
    laneStates.set('tb-303-1', lp);

    const rec = new OfflineSceneRecorder({ state, laneStates, bpm: 120, meter: DEFAULT_METER, sampleRate: 44100 });
    // 1.5s is well within the first bar (bar = 2s at 120 BPM) so tickLane only
    // schedules iteration k=0; the 1-bar clip does NOT loop within the window.
    // Notes fire at 0s and 0.25s; the final 0.25s window (1.25-1.5s) is decay.
    const totalSec = 1.5;
    const rendered = await rec.record(totalSec);

    expect(rendered.channels).toHaveLength(2);
    expect(rendered.sampleRate).toBe(44100);
    // length within one render quantum of the request (44100 * 1.5 = 66150)
    expect(Math.abs(rendered.channels[0].length - Math.ceil(totalSec * 44100))).toBeLessThan(256);
    // non-silent
    expect(rms(rendered.channels[0])).toBeGreaterThan(1e-4);
    // first 40% (notes playing) louder than the last 0.25s (decayed tail)
    const ch = rendered.channels[0];
    const head = ch.subarray(0, Math.floor(ch.length * 0.4));
    const tail = ch.subarray(ch.length - Math.floor(0.25 * 44100));
    expect(rms(head)).toBeGreaterThan(rms(tail));
  });
});
