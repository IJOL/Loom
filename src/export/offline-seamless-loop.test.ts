// src/export/offline-seamless-loop.test.ts
//
// The offline WAV export must loop SEAMLESSLY like the live scene. Rendering a
// single musical cycle and cutting it at the exact bar length is NOT seamless:
// release/decay/reverb tails of notes near the loop end are chopped, and the loop
// start ramps up with no overlapping tail from the previous cycle — an audible
// jump when the WAV repeats. Fix: render TWO cycles and return the SECOND one. The
// 2nd cycle is steady-state (cycle-1's tails already overlap its start), so it
// loops seamlessly — at the SAME exact musical length.
//
// That "SAME exact musical length" is load-bearing: `totalSec` must be the period
// the scheduler actually loops on, or the "second cycle" is not a cycle at all.

import { describe, it, expect, beforeAll, vi } from 'vitest';
// The melodic engines these scenes use ship as PLUGINS, so no renderer arrives
// by side-effect import any more. In production the offline exporter calls
// importPluginDspOnMainThread (plugin-host/plugin-dsp.ts); here `test/plugin-dsp`
// installs the same Loom global and the plugin dsp registers through it.
import '../../test/plugin-dsp';
// …and the manifest half, which is what puts the engine in the registry the
// recorder resolves lanes through. In production loadPlugins does both.
import { registerPluginEngine } from '../../test/plugin-fixtures';
import '../../plugins/tb303/dsp';
import { OfflineSceneRecorder } from './offline-recorder';
import { clipDurationSec } from './scene-duration';
import { bootstrapPlugins } from '../app/plugin-bootstrap';
import { emptyLanePlayState, type LanePlayState } from '../session/session-runtime';
import { DEFAULT_METER, ticksPerBar } from '../core/meter';
import type { SessionState, SessionClip } from '../session/session';

const SR = 44100;

function rms(a: Float32Array, from: number, to: number): number {
  let s = 0; const n = Math.max(1, to - from);
  for (let i = from; i < to; i++) s += a[i] * a[i];
  return Math.sqrt(s / n);
}

/** Render `clip` on a tb303 lane for `totalSec`, returning the cycle the
 *  recorder hands back plus the FULL two-cycle buffer it cut it from. */
async function renderTwoCycles(clip: SessionClip, totalSec: number, bpm = 120) {
  const state: SessionState = { name: 'Test', masterInserts: [], musicality: { key: 9, scale: 'minor', style: 'acid-techno', lock: false }, sends: [],
    lanes: [{ inserts: [], id: 'tb-303-1', engineId: 'tb303', clips: [clip] }],
    scenes: [], globalQuantize: '1/1',
  };
  const laneStates = new Map<string, LanePlayState>();
  const lp = emptyLanePlayState('tb-303-1'); lp.playing = clip;
  laneStates.set('tb-303-1', lp);

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
    const rec = new OfflineSceneRecorder({ state, laneStates, bpm, meter: DEFAULT_METER, sampleRate: SR });
    const rendered = await rec.record(totalSec);
    expect(full).not.toBeNull();
    const cycleFrames = Math.round(totalSec * SR);
    return {
      rendered,
      full: full! as AudioBuffer,
      firstCycle: (full! as AudioBuffer).getChannelData(0).slice(0, cycleFrames),
      cycleFrames,
    };
  } finally {
    spy.mockRestore();
  }
}

describe('OfflineSceneRecorder seamless loop', () => {
  beforeAll(() => { bootstrapPlugins(); registerPluginEngine('tb303'); });

  it('renders two cycles and returns the SECOND, at the exact musical length', async () => {
    // A tb303 note whose gate crosses the loop boundary (starts at 1.75s of a 2s
    // bar and holds ~1s). Cycle 1 starts silent (before the note); cycle 2 starts
    // WITH that held note still sounding — so the two cycles differ at their start,
    // and returning cycle 2 is what makes the loop seamless.
    const clip: SessionClip = { color: '#a8e8b8', gridResolution: '1/16',
      id: 'c', lengthBars: 1,
      notes: [{ start: 336, duration: 192, midi: 40, velocity: 110 }],
    };
    const totalSec = 2.0;   // one bar @ 120 BPM 4/4
    const { rendered, full, firstCycle, cycleFrames } = await renderTwoCycles(clip, totalSec);

    // Rendered TWO cycles...
    expect(full.length).toBe(cycleFrames * 2);
    // ...returned ONE cycle (exact musical length preserved, warp stays 1.0)...
    expect(rendered.channels[0].length).toBe(cycleFrames);
    // ...and it is the SECOND cycle, byte-for-byte, not the first.
    const second = full.getChannelData(0).slice(cycleFrames, cycleFrames * 2);
    expect(Array.from(rendered.channels[0])).toEqual(Array.from(second));

    // Validity: the returned (2nd) cycle starts WITH the crossing note's tail,
    // whereas cycle 1 starts silent — so cycle 2 has real energy at its start.
    const win = Math.round(0.05 * SR);
    expect(rms(rendered.channels[0], 0, win)).toBeGreaterThan(rms(firstCycle, 0, win) * 2);
  });

  it('the returned cycle starts at the same musical phase as the first', async () => {
    // An imported MIDI that halves its tempo half way: the real iteration is
    // 2 bars @120 + 2 bars @60, half again as long as the constant-bpm answer.
    // The scheduler already times its notes off the map, so a short window makes
    // cycle 2 begin mid-phrase — the exported WAV starts in the middle of a bar
    // and cuts the end off. Both cycles must open on the downbeat.
    const BAR = ticksPerBar(DEFAULT_METER);
    const clip: SessionClip = { color: '#f4e0a8', gridResolution: '1/16',
      id: 'tm', lengthBars: 4,
      notes: [{ start: 0, duration: 48, midi: 40, velocity: 110 }],
      tempoMap: [{ tick: 0, bpm: 120 }, { tick: 2 * BAR, bpm: 60 }],
    };
    // The window the app uses (main.ts → soundingSceneDurationSec → this).
    const totalSec = clipDurationSec(clip, DEFAULT_METER, 120);
    const { rendered, firstCycle } = await renderTwoCycles(clip, totalSec);

    const win = Math.round(0.05 * SR);
    const late = Math.round(1.5 * SR);
    // The probe measures a real attack: cycle 1's opening dwarfs its own tail.
    expect(rms(firstCycle, 0, win)).toBeGreaterThan(rms(firstCycle, late, late + win) * 2);
    // And the returned cycle opens on the same downbeat, not part-way through it.
    expect(rms(rendered.channels[0], 0, win) / rms(firstCycle, 0, win)).toBeGreaterThan(0.5);
  });
});
