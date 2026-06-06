// src/export/offline-reimport-sync.dsp.test.ts
//
// Regression for the "offline export no cuadra / cortado al principio" bug.
// Root cause: an audio-channel clip built from a render we just made re-ran
// loop tempo DETECTION (autocorrelation), which guesses a wrong multiple — so
// the clip warp-stretches the audio and lands on the wrong bar count, drifting
// off the grid. Fix: feed the KNOWN project BPM (addAudioChannel({knownBpm})).
// At a bar-aligned length that yields warp ratio 1.0 and the exact bar count.
import { describe, it, expect, beforeAll } from 'vitest';
import { OfflineSceneRecorder } from './offline-recorder';
import { detectLoop } from '../samples/loop-analysis';
import { audioChannelClip } from '../session/session';
import { bootstrapPlugins } from '../app/plugin-bootstrap';
import { emptyLanePlayState, type LanePlayState } from '../session/session-runtime';
import { DEFAULT_METER, quartersPerBar } from '../core/meter';
import type { SessionState, SessionClip } from '../session/session';

function asBuffer(ch: Float32Array, sr: number): AudioBuffer {
  return { duration: ch.length / sr, numberOfChannels: 1, sampleRate: sr,
    getChannelData: () => ch } as unknown as AudioBuffer;
}

describe('offline render → audio-channel re-import sync', () => {
  beforeAll(() => { bootstrapPlugins(); });

  it('locks to the grid with knownBpm (warp ≈ 1.0); auto-detect mis-warps the same render', async () => {
    const bpm = 130, sr = 44100, musicBars = 4;
    const barSec = quartersPerBar(DEFAULT_METER) * (60 / bpm);
    const musicSec = musicBars * barSec;

    // A 1-bar clip with a hit on every quarter, looped to 4 bars by the window.
    const clip: SessionClip = { id: 'c', lengthBars: 1, notes: [
      { start: 0,  duration: 12, midi: 36, velocity: 120 },
      { start: 24, duration: 12, midi: 36, velocity: 120 },
      { start: 48, duration: 12, midi: 36, velocity: 120 },
      { start: 72, duration: 12, midi: 36, velocity: 120 },
    ] };
    const state: SessionState = {
      lanes: [{ id: 'tb-303-1', engineId: 'tb303', clips: [clip] }],
      scenes: [], globalQuantize: '1/1',
    };
    const laneStates = new Map<string, LanePlayState>();
    const lp = emptyLanePlayState('tb-303-1'); lp.playing = clip;
    laneStates.set('tb-303-1', lp);

    // Offline export renders EXACTLY the bar-aligned musical length (no tail).
    const rec = new OfflineSceneRecorder({ state, laneStates, bpm, meter: DEFAULT_METER, sampleRate: sr });
    const rendered = await rec.record(musicSec);
    const buf = asBuffer(rendered.channels[0], sr);

    // FIX path — knownBpm: exact bar count, warp ratio 1.0 (no stretch → in sync).
    const fixed = audioChannelClip({
      name: 'take', sampleId: 's', durationSec: buf.duration, originalBpm: bpm, projectMeter: DEFAULT_METER,
    });
    expect(fixed.sample!.originalBpm).toBe(bpm);
    expect(fixed.lengthBars).toBe(musicBars);
    const warpFixed = (fixed.lengthBars * barSec) / buf.duration;
    expect(Math.abs(warpFixed - 1)).toBeLessThan(0.01);

    // BUG path — auto-detect: detection does NOT recover the true tempo of our
    // own render, so the resulting clip warps far from 1.0 (relative assertion).
    const detected = detectLoop(buf, DEFAULT_METER).originalBpm;
    expect(Math.abs(detected - bpm)).toBeGreaterThan(1);
    const auto = audioChannelClip({
      name: 'take', sampleId: 's', durationSec: buf.duration, originalBpm: detected, projectMeter: DEFAULT_METER,
    });
    const warpAuto = (auto.lengthBars * barSec) / buf.duration;
    expect(Math.abs(warpAuto - 1)).toBeGreaterThan(Math.abs(warpFixed - 1) + 0.05);
  });
});
