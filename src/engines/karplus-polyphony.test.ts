// TDD RED: Karplus polyphony limiting.
//
// KarplusEngine currently has zero voice tracking — every note-on
// unconditionally allocates a fresh KarplusVoice (delay line + loop filter +
// noise burst) with no cap. These tests assert the behaviour we WANT:
// a `maxVoices` property and an `activeVoiceCount()` method on KarplusEngine,
// with oldest-voice stealing when the cap is exceeded.
//
// Both tests will FAIL until the feature is implemented because:
//   - `engine.maxVoices` does not exist on KarplusEngine
//   - `engine.activeVoiceCount()` does not exist on KarplusEngine
//   - No voice-tracking list exists in KarplusEngine
//
// Do NOT implement the feature here — keep this file as the RED anchor.

import { describe, it, expect, beforeEach } from 'vitest';
import { KarplusEngine } from './karplus';
import { OfflineAudioContext } from 'node-web-audio-api';

// Shared helper: create a minimal OfflineAudioContext just large enough to
// satisfy the Web Audio constructor (1 frame is fine — we never render).
function makeCtx(): AudioContext {
  return new OfflineAudioContext(1, 128, 44100) as unknown as AudioContext;
}

// Trigger a note through the engine at time=0 with a short gate.
// We use createVoice + voice.trigger so the engine has a chance to track the
// allocation internally (which is where the cap logic must live).
function fireNote(engine: KarplusEngine, ctx: AudioContext, midi = 60): void {
  const voice = engine.createVoice(ctx, ctx.destination);
  voice.trigger(midi, 0, { gateDuration: 1.0 });
}

describe('KarplusEngine polyphony limiting', () => {
  let engine: KarplusEngine;
  let ctx: AudioContext;

  beforeEach(() => {
    engine = new KarplusEngine();
    ctx = makeCtx();
  });

  it('caps active voices at maxVoices=4, stealing the oldest when exceeded', () => {
    // Set the cap. This property does not yet exist on KarplusEngine — test
    // will throw / produce wrong count until implemented.
    (engine as unknown as { maxVoices: number }).maxVoices = 4;

    // Fire 6 distinct notes.
    for (let midi = 60; midi < 66; midi++) {
      fireNote(engine, ctx, midi);
    }

    // Only the 4 most-recent voices should remain active; the 2 oldest should
    // have been stolen (dispose() called and removed from the tracking list).
    expect((engine as unknown as { activeVoiceCount(): number }).activeVoiceCount()).toBe(4);
  });

  it('maxVoices=1 gives monophonic behaviour — each new note steals the previous', () => {
    (engine as unknown as { maxVoices: number }).maxVoices = 1;

    fireNote(engine, ctx, 60);
    expect((engine as unknown as { activeVoiceCount(): number }).activeVoiceCount()).toBe(1);

    fireNote(engine, ctx, 62);
    // The C4 voice should have been stolen; only D4 remains.
    expect((engine as unknown as { activeVoiceCount(): number }).activeVoiceCount()).toBe(1);

    fireNote(engine, ctx, 64);
    // D4 stolen; only E4 remains.
    expect((engine as unknown as { activeVoiceCount(): number }).activeVoiceCount()).toBe(1);
  });
});
