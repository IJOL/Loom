import { describe, it, expect, beforeAll } from 'vitest';
import '../../test/setup';
import { LFOVoice } from './lfo-voice';
import { makeDefaultLFO } from './types';

// The LFO trigger mode controls whether the LFO phase resets on every
// note-on or runs free. The retrigger behavior produces a "stuttered" sweep
// that's barely audible at high note rates (the LFO never completes a cycle
// before being reset). Free mode is the classic analog-synth LFO behavior
// and what most users expect; it's also the only way an LFO can produce a
// slow audible sweep over many notes.

function makeCtx() {
  return new AudioContext();
}

describe('LFOVoice — trigger mode', () => {
  let ctx: AudioContext;
  beforeAll(() => { ctx = makeCtx(); });

  it('defaults to free-running: trigger() does NOT reset the oscillator phase', () => {
    const state = makeDefaultLFO('lfo1');
    expect(state.trigger).toBe('free'); // default
    const v = new LFOVoice(ctx, state, () => 120);
    const before = (v as unknown as { startedAt: number }).startedAt;
    v.trigger(ctx.currentTime + 0.5, { gateDuration: 0.1 });
    const after = (v as unknown as { startedAt: number }).startedAt;
    expect(after).toBe(before);
    v.dispose();
  });

  it('with trigger="note" mode, trigger() resets startedAt + recreates oscillator', () => {
    const state = makeDefaultLFO('lfo1');
    state.trigger = 'note';
    const v = new LFOVoice(ctx, state, () => 120);
    const before = (v as unknown as { startedAt: number }).startedAt;
    const triggerTime = ctx.currentTime + 0.5;
    v.trigger(triggerTime, { gateDuration: 0.1 });
    const after = (v as unknown as { startedAt: number }).startedAt;
    expect(after).toBe(triggerTime);
    expect(after).not.toBe(before);
    v.dispose();
  });
});
