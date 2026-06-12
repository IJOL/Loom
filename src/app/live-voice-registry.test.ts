// src/app/live-voice-registry.test.ts
// The live-voice registry lets the stop seams (transport Stop, STOP ALL,
// stopLane/stopAll) immediately silence voices that the trigger created
// fire-and-forget. Without it, a long 'audio' clip keeps playing to the end
// after any Stop because nobody holds a reference to its AudioBufferSourceNode.

import { describe, it, expect, vi } from 'vitest';
import { LiveVoiceRegistry } from './live-voice-registry';
import { createTriggerForLane } from './trigger-dispatch';

/** A fake Voice that records release()/dispose() calls. */
function fakeVoice() {
  return {
    released: [] as number[],
    disposed: 0,
    trigger: vi.fn(),
    release(t: number) { this.released.push(t); },
    connect() {},
    dispose() { this.disposed++; },
    getAudioParams: () => new Map<string, AudioParam>(),
  };
}

describe('LiveVoiceRegistry', () => {
  it('silenceLane releases every voice recorded for that lane, then forgets them', () => {
    const reg = new LiveVoiceRegistry();
    const a = fakeVoice();
    const b = fakeVoice();
    const other = fakeVoice();
    reg.record('audio-1', a);
    reg.record('audio-1', b);
    reg.record('audio-2', other);

    reg.silenceLane('audio-1', 7);

    expect(a.released).toEqual([7]);
    expect(b.released).toEqual([7]);
    expect(other.released).toEqual([]); // untouched lane keeps playing

    // A second silence is a no-op (voices were forgotten).
    reg.silenceLane('audio-1', 9);
    expect(a.released).toEqual([7]);
  });

  it('silenceAll releases voices across every lane and clears the registry', () => {
    const reg = new LiveVoiceRegistry();
    const a = fakeVoice();
    const b = fakeVoice();
    reg.record('audio-1', a);
    reg.record('audio-2', b);

    reg.silenceAll(3);

    expect(a.released).toEqual([3]);
    expect(b.released).toEqual([3]);

    reg.silenceAll(5);
    expect(a.released).toEqual([3]);
    expect(b.released).toEqual([3]);
  });

  it('caps tracked voices per lane so a busy lane cannot leak unboundedly', () => {
    const reg = new LiveVoiceRegistry(2); // cap = 2 for the test
    const voices = [fakeVoice(), fakeVoice(), fakeVoice(), fakeVoice()];
    for (const v of voices) reg.record('poly-1', v);

    reg.silenceAll(0);

    // Only the 2 most-recent are retained; the oldest two were evicted (and
    // self-terminate on their own gate), so they are not released here.
    expect(voices[0].released).toEqual([]);
    expect(voices[1].released).toEqual([]);
    expect(voices[2].released).toEqual([0]);
    expect(voices[3].released).toEqual([0]);
  });
});

describe('createTriggerForLane records live voices into the registry', () => {
  it('a triggered (sample) voice can be silenced via the registry', () => {
    const voice = fakeVoice();
    const reg = new LiveVoiceRegistry();
    const deps = {
      ctx: {} as AudioContext,
      seq: { bpm: 120 } as never,
      laneResources: {
        get: () => ({ engine: { id: 'audio', createVoice: () => voice }, strip: { input: {} } }),
      } as never,
      liveVoices: reg,
    };
    const trigger = createTriggerForLane(deps);

    const sample = { sampleId: 's1', durationSec: 2, mode: 'song' } as never;
    trigger('audio-1', 60, 0, 4, false, false, sample);

    expect(voice.trigger).toHaveBeenCalledTimes(1);

    // Stop seam → registry.silenceLane releases the live voice immediately.
    reg.silenceLane('audio-1', 1.5);
    expect(voice.released).toEqual([1.5]);
  });
});
