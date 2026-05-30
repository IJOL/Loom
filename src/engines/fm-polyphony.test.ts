// FM polyphony — voice-tracking unit tests.
// Uses real AudioContext via node-web-audio-api (globalized by test/setup.ts).
//
// FAILING TESTS: these tests assert that voices which complete their release
// naturally are removed from activeVoices so the count stays accurate.
//
// The engine currently ONLY removes voices from activeVoices via the
// steal-on-overflow path (stealOldest). There is no self-removal hook when an
// oscillator's stop() fires or when the release phase completes. As a result
// activeVoices grows monotonically and never shrinks below its peak unless a
// new trigger overflows the cap.
//
// Consequence tested here:
//   - After triggering N voices with very short gates and waiting for them to
//     finish, activeVoiceCount() should be 0. It stays at N instead.
//   - With maxVoices=4 cap, creating 4 voices that complete then creating 4
//     fresh ones must leave count=4, not 8. It is 8 instead.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FMEngine } from './fm';

/** Wait `ms` milliseconds (real wall-clock time, needed for osc.stop to fire). */
function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('FM polyphony — voice tracking', () => {
  let ctx: AudioContext;
  let output: AudioNode;
  let engine: FMEngine;

  beforeEach(() => {
    ctx = new (globalThis as any).AudioContext();
    output = ctx.destination;
    engine = new FMEngine();
  });

  afterEach(async () => {
    await ctx.close();
  });

  // Test 1 — FAILING:
  // Voices triggered with a very short gate (1 ms) and very short release (5 ms)
  // should be gone from activeVoices by the time they finish. After waiting
  // well past the release tail the count should be 0, not 4.
  it('activeVoiceCount() drops to 0 after all triggered voices complete their release', async () => {
    // Use very short envelopes so voices finish quickly.
    engine.setBaseValue('op1.release', 0.005);
    engine.setBaseValue('op2.release', 0.005);
    engine.setBaseValue('op3.release', 0.005);
    engine.setBaseValue('op4.release', 0.005);

    for (let i = 0; i < 4; i++) {
      const voice = engine.createVoice(ctx, output);
      // Trigger at the current time with a 1-ms gate.
      voice.trigger(60 + i, ctx.currentTime, { gateDuration: 0.001 });
    }

    expect(engine.activeVoiceCount()).toBe(4); // sanity: all 4 tracked immediately

    // Wait 200 ms — well beyond gate + release (≈ 6 ms total). All oscillators
    // have called stop() by now, but the engine never removes them.
    await wait(200);

    // FAILS: activeVoiceCount() returns 4 because there is no self-removal on
    // natural completion. It will be 0 only once the missing hook is added.
    expect(engine.activeVoiceCount()).toBe(0);
  });

  // Test 2 — FAILING:
  // With the DEFAULT maxVoices=6 cap, trigger 4 voices that finish quickly,
  // wait for completion, then trigger 4 live voices. Without self-removal the
  // 4 completed voices still occupy activeVoices, so the count becomes 8.
  // The overflow-steal fires to bring it back to 6, but 2 of those completed
  // zombies remain — final count is 6, not 4. The test asserts 4.
  it('completed voices do not pollute the active count for a subsequent batch', async () => {
    // Keep the default cap (6) — high enough that the second batch of 4 plus
    // 4 completed zombies (= 8) triggers only a 2-voice steal, leaving 6.
    engine.setBaseValue('op1.release', 0.005);
    engine.setBaseValue('op2.release', 0.005);
    engine.setBaseValue('op3.release', 0.005);
    engine.setBaseValue('op4.release', 0.005);

    // First batch — 4 voices with near-instant gate + release.
    for (let i = 0; i < 4; i++) {
      const voice = engine.createVoice(ctx, output);
      voice.trigger(60, ctx.currentTime, { gateDuration: 0.001 });
    }

    await wait(200); // First batch has fully completed (gate + release ≈ 6 ms).

    // Second batch — 4 new long-lived voices.
    for (let i = 0; i < 4; i++) {
      const voice = engine.createVoice(ctx, output);
      voice.trigger(62, ctx.currentTime, { gateDuration: 10.0 });
    }

    // FAILS: without self-removal the 4 completed voices are still in
    // activeVoices, raising the count to 8. The overflow-steal (cap=6) trims
    // 2 oldest (both completed), leaving 6 — not 4. The missing fix is a
    // self-removal callback when osc.stop fires so completed voices leave the
    // list before the next createVoice push.
    expect(engine.activeVoiceCount()).toBe(4);
  });
});
