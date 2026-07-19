// src/export/offline-automation.dsp.test.ts
// Regression: the offline render must apply clip automation (envelopes), so a
// filter.cutoff sweep is heard. The live host updates the base value per rAF; a
// new voice captures filter.cutoff at creation, so the audible result is
// per-note (early notes dark, later notes bright). The offline render reproduces
// that by applying the automation base value before each trigger, in time order.
//
// Setup: a subtractive lane whose cutoff envelope ramps 0.05 -> 0.95 over the
// bar, with notes spread across it. With automation applied, the LAST quarter of
// the render (cutoff ~0.9) is much brighter than the FIRST quarter (cutoff ~0.1).
// Without it (envelope ignored), every note uses the preset's fixed cutoff and
// the quarters match.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { OfflineSceneRecorder } from './offline-recorder';
import { bootstrapPlugins } from '../app/plugin-bootstrap';
import { emptyLanePlayState, type LanePlayState } from '../session/session-runtime';
import { DEFAULT_METER } from '../core/meter';
import { __resetPresetCache, __seedPresetCache } from '../presets/preset-loader';
import type { SessionState, SessionClip } from '../session/session';
import type { EnginePreset } from '../engines/engine-types';

/** Proxy for high-frequency content (brightness): mean abs first difference.
 *  A higher filter cutoff lets more harmonics through → higher value. */
function brightness(ch: Float32Array): number {
  let s = 0;
  for (let i = 1; i < ch.length; i++) s += Math.abs(ch[i] - ch[i - 1]);
  return s / Math.max(1, ch.length - 1);
}

// A harmonically-rich preset (saw oscs) with NO filter envelope, so the BASE
// cutoff — driven by clip automation — fully dictates the timbre.
const RICH: EnginePreset = {
  name: 'Rich', gm: [],
  params: {
    'master.tune': 0,
    'osc1.wave': 0, 'osc1.level': 0.9, 'osc1.detune': 0,
    'osc2.wave': 0, 'osc2.level': 0.6, 'osc2.detune': 7,
    'sub.level': 0, 'noise.level': 0,
    'filter.cutoff': 0.5, 'filter.resonance': 0.1, 'filter.envAmount': 0,
    'filter.keyTrack': 0, 'filter.drive': 0,
    'filter.attack': 0.005, 'filter.decay': 0.2, 'filter.sustain': 1, 'filter.release': 0.1,
    'amp.attack': 0.005, 'amp.decay': 0.2, 'amp.sustain': 0.9, 'amp.release': 0.08,
  },
};

// Envelope ramp 0.05 -> 0.95 over the bar (256 sub-steps = 16 steps * 16 sub-res).
const RAMP = Array.from({ length: 256 }, (_, i) => 0.05 + (0.9 * i) / 255);

function makeClip(): SessionClip {
  // 8 notes, one every 2 steps (every 96 ticks) across the 1-bar clip.
  const notes = Array.from({ length: 8 }, (_, k) => ({ start: k * 96, duration: 80, midi: 48, velocity: 100 }));
  return { color: '#f4b8b8', gridResolution: '1/16',
    id: 'c', lengthBars: 1, notes,
    envelopes: [{ paramId: 'sub.filter.cutoff', values: RAMP, enabled: true, stepped: false }],
  };
}

async function renderQuarters(): Promise<{ q1: number; q4: number }> {
  const clip = makeClip();
  const state: SessionState = { name: 'Test', masterInserts: [], musicality: { key: 9, scale: 'minor', style: 'acid-techno', lock: false }, sends: [],
    lanes: [{ inserts: [], id: 'sub', engineId: 'subtractive', clips: [clip], enginePresetName: 'engine:Rich' }],
    scenes: [], globalQuantize: '1/1',
  };
  const laneStates = new Map<string, LanePlayState>();
  const lp = emptyLanePlayState('sub'); lp.playing = clip;
  laneStates.set('sub', lp);
  const rec = new OfflineSceneRecorder({ state, laneStates, bpm: 120, meter: DEFAULT_METER, sampleRate: 44100 });
  const r = await rec.record(2.0); // 1 bar at 120 BPM = 2s
  const ch = r.channels[0];
  const q = Math.floor(ch.length / 4);
  return { q1: brightness(ch.subarray(0, q)), q4: brightness(ch.subarray(3 * q)) };
}

describe('OfflineSceneRecorder applies clip automation (DSP)', () => {
  beforeAll(() => { bootstrapPlugins(); });
  beforeEach(() => { __resetPresetCache(); __seedPresetCache('subtractive', [RICH]); });

  it('a rising cutoff envelope makes the last quarter brighter than the first', async () => {
    const { q1, q4 } = await renderQuarters();
    // With automation applied, late notes (cutoff ~0.9) are far brighter than
    // early notes (cutoff ~0.1). Without it, both quarters use the preset's
    // fixed cutoff (0.5) and are roughly equal (ratio ~1).
    expect(q4).toBeGreaterThan(q1 * 2);
  });
});
