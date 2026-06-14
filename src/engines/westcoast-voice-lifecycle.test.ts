// src/engines/westcoast-voice-lifecycle.test.ts
// Regression: a West voice that ends naturally must FREE its audio nodes.
//
// The voice has three persistent ConstantSourceNodes (bias, contour, cutoffBase)
// started in the constructor. Before this fix they were stopped ONLY in
// dispose(), which is called only on voice-stealing or engine teardown — NEVER
// when a note ends on its own. A still-"playing" ConstantSource that has a path
// to the destination keeps its whole subgraph alive, including the expensive
// oversample-'4x' WaveShaper. So every note in a loop leaked a live 4x-WaveShaper
// chain → CPU climbed without bound → the audio crackled even on a simple pattern.
//
// The fix schedules stop() on those ConstantSources in trigger() (alongside the
// oscillators), so when the note ends the playing-source path is cut and the
// subgraph becomes GC-eligible. This test asserts the voice schedules at least
// the 3 per-voice ConstantSource stops on trigger. Spy counts stop() CALLS.
import { describe, it, expect } from 'vitest';
import '../../test/setup';
import { WestEngine } from './westcoast';

describe('West voice lifecycle — no audio-node leak', () => {
  it('a triggered voice schedules stop() on its ConstantSources (bias/contour/cutoffBase)', async () => {
    const SR = 44100;
    const ctx = new OfflineAudioContext(1, SR, SR); // 1 second
    let stops = 0;
    const orig = ctx.createConstantSource.bind(ctx);
    (ctx as unknown as { createConstantSource: () => ConstantSourceNode }).createConstantSource = () => {
      const n = orig();
      const realStop = n.stop.bind(n);
      (n as unknown as { stop: (t?: number) => void }).stop = (t?: number) => {
        stops++;
        return realStop(t as number);
      };
      return n;
    };
    const out = ctx.createGain();
    out.connect(ctx.destination);

    const engine = new WestEngine();
    const voice = engine.createVoice(ctx as unknown as AudioContext, out);
    voice.trigger(48, 0, { gateDuration: 0.1 });

    // bias + contour + cutoffBase must each be scheduled to stop (>= 3).
    // Before the fix: 0 (the per-voice ConstantSources were never stopped on a
    // natural note-end; the modBus ConstantSources are engine-lived and don't count).
    expect(stops).toBeGreaterThanOrEqual(3);

    // Render must still succeed (no throw from the scheduled stops).
    const buf = await ctx.startRendering();
    expect(buf.length).toBe(SR);
  });
});
