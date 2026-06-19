// Regression: disposing a lane (via "New" or a stem "Replace") must fully tear
// down that lane's engine — including the SHARED modulator voices (free-running
// LFO/ADSR oscillators in engineModVoices) and the lane's modulation bridges.
// Before the fix, polyhost engines left these alive: engine.dispose() was either
// empty (TB-303, FM, Karplus, Drums) or only nulled an unrelated field
// (Subtractive, Wavetable, Westcoast), so a shared LFO kept running and its gain
// bridges kept routing after the lane was gone — "New / Replace doesn't clean
// the LFO/ADSR".

import { describe, it, expect, beforeEach } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { TB303Engine } from './tb303';
import { SubtractiveEngine } from './subtractive';
import { FMEngine } from './fm';
import { KarplusEngine } from './karplus';
import { WavetableEngine } from './wavetable';
import { WestEngine } from './westcoast';
import { DrumsEngine } from './drums-engine';
import { PolySynth } from '../polysynth/polysynth';
import { FxBus } from '../core/fx';
import { setCurrentLaneForVoice } from '../modulation/active-mods';
import {
  _resetLaneBindingsForTesting,
  _getEngineBindingForTesting,
} from '../modulation/voice-mod-binding';
import type { SynthEngine } from './engine-types';
import type { ModulationHostImpl } from '../modulation/modulation-host';

/** Spy the FIRST spawnVoiceFiltered call (which produces the shared
 *  engineModVoices) and record whether each voice's dispose() gets called.
 *  spawnVoice() delegates to spawnVoiceFiltered() internally, so spying the
 *  filtered method captures every engine style. */
function captureSharedModVoices(host: ModulationHostImpl): { disposed: boolean }[] {
  const records: { disposed: boolean }[] = [];
  let captured = false;
  const orig = host.spawnVoiceFiltered.bind(host);
  host.spawnVoiceFiltered = (ctx, bpm, pred) => {
    const voices = orig(ctx, bpm, pred);
    if (!captured) {
      captured = true;
      for (const v of voices.values()) {
        const rec = { disposed: false };
        const inner = v.dispose.bind(v);
        v.dispose = () => { rec.disposed = true; inner(); };
        records.push(rec);
      }
    }
    return voices;
  };
  return records;
}

/** Per-engine factory: build a ready-to-trigger engine with a shared LFO and the
 *  minimal wiring its createVoice needs, plus the lane id to bind under. */
const CASES: { name: string; laneId: string; make: (ctx: AudioContext) => SynthEngine }[] = [
  { name: 'TB-303', laneId: 'tb-303-1', make: () => new TB303Engine() },
  {
    name: 'Subtractive', laneId: 'subtractive-1',
    make: (ctx) => {
      const e = new SubtractiveEngine();
      (e as unknown as { setPolySynth(p: PolySynth): void }).setPolySynth(new PolySynth(ctx, ctx.destination));
      return e;
    },
  },
  { name: 'FM',        laneId: 'fm-1',        make: () => new FMEngine() },
  { name: 'Karplus',   laneId: 'karplus-1',   make: () => new KarplusEngine() },
  { name: 'Wavetable', laneId: 'wavetable-1', make: () => new WavetableEngine() },
  { name: 'Westcoast', laneId: 'westcoast-1', make: () => new WestEngine() },
  {
    name: 'Drums', laneId: 'drums-1',
    make: (ctx) => {
      const e = new DrumsEngine();
      e.setSharedFx(new FxBus(ctx, ctx.destination));
      return e;
    },
  },
];

describe('engine.dispose() tears down shared modulators (New / stem-Replace cleanup)', () => {
  beforeEach(() => { _resetLaneBindingsForTesting(); });

  for (const c of CASES) {
    it(`${c.name}: disposes shared LFO/ADSR voices and drops the lane modulation binding`, () => {
      const ctx = new OfflineAudioContext(1, 128, 44100) as unknown as AudioContext;
      const engine = c.make(ctx);
      // Guarantee at least one shared LFO regardless of engine defaults.
      engine.modulators.addModulator('lfo');
      const records = captureSharedModVoices(engine.modulators as ModulationHostImpl);

      setCurrentLaneForVoice(c.laneId);
      engine.createVoice(ctx, ctx.destination); // spawns engineModVoices + binds the lane
      setCurrentLaneForVoice(null);

      expect(records.length, 'a shared LFO should have spawned a voice').toBeGreaterThan(0);
      expect(_getEngineBindingForTesting(c.laneId), 'engine binding exists before dispose').toBeDefined();

      engine.dispose();

      expect(records.every((r) => r.disposed), 'every shared modulator voice is disposed').toBe(true);
      expect(_getEngineBindingForTesting(c.laneId), 'lane modulation binding is gone after dispose').toBeUndefined();
    });
  }
});
