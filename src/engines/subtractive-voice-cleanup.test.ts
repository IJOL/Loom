// Regression: a polyhost note's PER-VOICE modulators (the per-note ADSR
// ConstantSourceNodes spawned by createVoice) must be disposed once the note's
// tail ends during free-running playback — NOT only when the transport stops.
//
// Before the fix, polyhost voices created per-voice modulator voices on every
// note and never tore them down during playback (Subtractive disposed none; FM/
// Wavetable/Westcoast only on voice-steal, leaking voices that ended below the
// cap). A dense multi-lane arrangement then accumulated hundreds of running
// ConstantSourceNodes that starved the Web Audio render thread (audio
// "entrecortado" → silence-with-active-VU, worsening over minutes). The SHARED
// modulators (free-running LFOs) must stay alive — only per-note voices are
// one-shot.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { SubtractiveEngine } from './subtractive';
import { FMEngine } from './fm';
import { KarplusEngine } from './karplus';
import { WavetableEngine } from './wavetable';
import { WestEngine } from './westcoast';
import { PolySynth } from '../polysynth/polysynth';
import { setCurrentLaneForVoice } from '../modulation/active-mods';
import { _resetLaneBindingsForTesting } from '../modulation/voice-mod-binding';
import type { SynthEngine } from './engine-types';
import type { ModulationHostImpl } from '../modulation/modulation-host';

/** Spy every spawnVoiceFiltered call and record per-batch whether each spawned
 *  modulator voice's dispose() is called. createVoice spawns the SHARED batch
 *  first (lazy-init engineModVoices) then the PER-VOICE batch, so the last batch
 *  is the per-note one and batch[0] is the shared one. */
function captureModBatches(host: ModulationHostImpl): { disposed: boolean }[][] {
  const batches: { disposed: boolean }[][] = [];
  const orig = host.spawnVoiceFiltered.bind(host);
  (host as unknown as { spawnVoiceFiltered: typeof host.spawnVoiceFiltered }).spawnVoiceFiltered = (
    ctx, bpm, pred,
  ) => {
    const voices = orig(ctx, bpm, pred);
    const batch: { disposed: boolean }[] = [];
    for (const v of voices.values()) {
      const rec = { disposed: false };
      const inner = v.dispose.bind(v);
      v.dispose = () => { rec.disposed = true; inner(); };
      batch.push(rec);
    }
    batches.push(batch);
    return voices;
  };
  return batches;
}

const CASES: { name: string; laneId: string; make: (ctx: AudioContext) => SynthEngine }[] = [
  {
    name: 'Subtractive', laneId: 'sub-1',
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
];

describe('Polyhost per-note modulator lifecycle (no leak during free-running playback)', () => {
  beforeEach(() => {
    _resetLaneBindingsForTesting();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => { vi.useRealTimers(); });

  for (const c of CASES) {
    it(`${c.name}: disposes a note's per-voice modulators after its tail, keeps shared ones`, () => {
      const ctx = new OfflineAudioContext(1, 128, 44100) as unknown as AudioContext;
      const engine = c.make(ctx);
      // Guarantee a per-voice ADSR exists regardless of engine defaults.
      engine.modulators.addModulator('adsr');
      const batches = captureModBatches(engine.modulators as ModulationHostImpl);

      setCurrentLaneForVoice(c.laneId);
      const voice = engine.createVoice(ctx, ctx.destination);
      voice.trigger(60, 0, { gateDuration: 0.1, accent: false });
      setCurrentLaneForVoice(null);

      const perVoice = batches[batches.length - 1];
      expect(perVoice.length, 'a per-voice ADSR voice should have spawned').toBeGreaterThan(0);
      expect(perVoice.some((r) => r.disposed), 'not disposed mid-note (still in its tail)').toBe(false);

      // Advance well past any reasonable note lifetime (gate 0.1s + release tail).
      vi.advanceTimersByTime(15000);

      expect(perVoice.every((r) => r.disposed), 'every per-voice modulator disposed after the tail').toBe(true);
    });
  }
});
