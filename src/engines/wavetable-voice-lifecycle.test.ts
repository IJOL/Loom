// Wavetable voice lifecycle — self-pruning unit tests.
// Uses real AudioContext via node-web-audio-api (globalized by test/setup.ts).
//
// FAILING TESTS: these assert that a WavetableVoice ends itself after its note
// completes (gate + release), so the engine's activeVoices list drains back to
// zero. Today the voice starts oscA/oscB in trigger() but NEVER schedules
// stop(), so the oscillators run forever — the 'ended' self-prune listener in
// createVoice is dead code and activeVoiceCount() only ever shrinks via the
// steal-on-overflow path. That makes voices immortal (CPU leak) and forces a
// hard, click-prone steal once the cap is hit.
//
// FM (fm.ts) and Karplus (karplus.ts) already schedule their own stop and
// self-prune; this is the missing parity for Wavetable.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WavetableEngine } from './wavetable';

/** Wait `ms` milliseconds (real wall-clock time, needed for osc.stop to fire). */
function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Drive the standalone amp envelope short so voices finish quickly. In these
 *  tests no lane is bound, so the voice uses its built-in ADSR (amp.* knobs). */
function shortEnvelope(engine: WavetableEngine): void {
  engine.setBaseValue('amp.attack', 0.005);
  engine.setBaseValue('amp.decay', 0.005);
  engine.setBaseValue('amp.release', 0.005);
}

describe('Wavetable voice lifecycle — self-pruning', () => {
  let ctx: AudioContext;
  let output: AudioNode;
  let engine: WavetableEngine;

  beforeEach(() => {
    ctx = new (globalThis as any).AudioContext();
    output = ctx.destination;
    engine = new WavetableEngine();
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('activeVoiceCount() drops to 0 after all triggered voices complete their release', async () => {
    shortEnvelope(engine);

    for (let i = 0; i < 4; i++) {
      const voice = engine.createVoice(ctx, output);
      // 1-ms gate; with a 5-ms amp release the note is done in well under 50 ms.
      voice.trigger(60 + i, ctx.currentTime, { gateDuration: 0.001 });
    }

    expect(engine.activeVoiceCount()).toBe(4); // sanity: all 4 tracked immediately

    // Wait far beyond gate + release. Every oscillator should have stopped and
    // fired 'ended' by now, pruning its voice from activeVoices.
    await wait(200);

    expect(engine.activeVoiceCount()).toBe(0);
  });

  it('completed voices do not pollute the active count for a subsequent batch', async () => {
    // Keep the default cap (8): 4 completed + 4 live = 8, which does NOT exceed
    // the cap, so the only way the count returns to 4 is genuine self-pruning of
    // the first (completed) batch — not a steal.
    shortEnvelope(engine);

    for (let i = 0; i < 4; i++) {
      const voice = engine.createVoice(ctx, output);
      voice.trigger(60, ctx.currentTime, { gateDuration: 0.001 });
    }

    await wait(200); // First batch fully completes (gate + release ≈ 11 ms).

    for (let i = 0; i < 4; i++) {
      const voice = engine.createVoice(ctx, output);
      voice.trigger(62, ctx.currentTime, { gateDuration: 10.0 });
    }

    expect(engine.activeVoiceCount()).toBe(4);
  });
});
