// src/export/offline-preset.dsp.test.ts
// Regression: the offline render must apply each lane's enginePresetName (the
// factory preset that defines osc/filter/ADSR), exactly like the live host does
// (main.ts applyPresetToEngine on load). Without it, every sounding lane renders
// with the engine DEFAULT sound — the root cause of "the offline take sounds
// nothing like the live loop".
//
// This test seeds two subtractive presets that differ a lot in level + sustain +
// cutoff, renders the same note under each, and asserts the renders diverge.
// BEFORE the fix both ignore the preset → identical default render → fails.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { OfflineSceneRecorder } from './offline-recorder';
import { bootstrapPlugins } from '../app/plugin-bootstrap';
import { emptyLanePlayState, type LanePlayState } from '../session/session-runtime';
import { DEFAULT_METER } from '../core/meter';
import { __resetPresetCache, __seedPresetCache } from '../presets/preset-loader';
import type { SessionState, SessionClip } from '../session/session';
import type { EnginePreset } from '../engines/engine-types';

function rms(ch: Float32Array): number {
  let s = 0;
  for (let i = 0; i < ch.length; i++) s += ch[i] * ch[i];
  return Math.sqrt(s / ch.length);
}

const BASE = {
  'master.tune': 0,
  'osc1.wave': 0, 'osc1.detune': 0,
  'osc2.wave': 1, 'osc2.detune': 7,
  'noise.level': 0,
  'filter.resonance': 0.2, 'filter.envAmount': 0.3, 'filter.keyTrack': 0, 'filter.drive': 0,
  'filter.attack': 0.01, 'filter.decay': 0.3, 'filter.sustain': 0.6, 'filter.release': 0.35,
  'amp.attack': 0.005, 'amp.decay': 0.2,
};

const LOUD: EnginePreset = {
  name: 'Loud', gm: [],
  params: { ...BASE, 'osc1.level': 1, 'osc2.level': 0.8, 'sub.level': 0.6, 'filter.cutoff': 0.95, 'amp.sustain': 0.95, 'amp.release': 0.4 },
};
const QUIET: EnginePreset = {
  name: 'Quiet', gm: [],
  params: { ...BASE, 'osc1.level': 0.12, 'osc2.level': 0, 'sub.level': 0, 'filter.cutoff': 0.12, 'amp.sustain': 0.1, 'amp.release': 0.05 },
};

async function renderWithPreset(presetName: string): Promise<number> {
  const clip: SessionClip = {
    id: 'c', lengthBars: 1,
    notes: [{ start: 0, duration: 96, midi: 48, velocity: 100 }],
  };
  const state: SessionState = {
    lanes: [{ id: 'sub', engineId: 'subtractive', clips: [clip], enginePresetName: `engine:${presetName}` }],
    scenes: [], globalQuantize: '1/1',
  };
  const laneStates = new Map<string, LanePlayState>();
  const lp = emptyLanePlayState('sub'); lp.playing = clip;
  laneStates.set('sub', lp);
  const rec = new OfflineSceneRecorder({ state, laneStates, bpm: 120, meter: DEFAULT_METER, sampleRate: 44100 });
  // record() renders TWO cycles and returns the 2nd (seamless loop), so totalSec
  // must be the clip's loop length — here one bar = 2.0s @ 120 BPM (the real export
  // passes soundingSceneDurationSec). Then the note loops into the 2nd cycle.
  const r = await rec.record(2.0);
  return rms(r.channels[0]);
}

describe('OfflineSceneRecorder applies the lane preset (DSP)', () => {
  beforeAll(() => { bootstrapPlugins(); });
  beforeEach(() => { __resetPresetCache(); __seedPresetCache('subtractive', [LOUD, QUIET]); });

  it('two materially-different presets produce materially-different renders', async () => {
    const loud = await renderWithPreset('Loud');
    const quiet = await renderWithPreset('Quiet');
    // With the preset applied, Loud (high osc levels + sustain 0.95 + open filter)
    // is much louder than Quiet. If the offline render ignores enginePresetName,
    // both fall back to the engine default and these are equal.
    expect(loud).toBeGreaterThan(quiet * 1.5);
  });
});
