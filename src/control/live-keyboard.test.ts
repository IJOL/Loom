// src/control/live-keyboard.test.ts
import { describe, it, expect } from 'vitest';
import { createLiveVoicePool } from './live-keyboard';
import type { Voice } from '../engines/engine-types';

function fakeVoice() {
  const calls: string[] = [];
  const v: Voice = {
    trigger: (midi, time, opts) => calls.push(`trigger ${midi} v=${opts.velocity} gate=${opts.gateDuration}`),
    release: (t) => calls.push(`release @${t}`),
    connect: () => {},
    dispose: () => calls.push('dispose'),
    getAudioParams: () => new Map(),
  };
  return { v, calls };
}

describe('live-keyboard voice pool', () => {
  it('noteOn spawns a voice and triggers with a long gate + velocity', () => {
    const fv = fakeVoice();
    const pool = createLiveVoicePool({ spawnVoice: () => fv.v, now: () => 10, defer: () => {} });
    pool.noteOn('lane-a', 60, 90);
    expect(fv.calls[0]).toContain('trigger 60 v=90');
    expect(fv.calls[0]).toContain('gate='); // a large gate, not 0.25
  });

  it('noteOff releases the held voice then defers dispose', () => {
    const fv = fakeVoice();
    const deferred: Array<() => void> = [];
    const pool = createLiveVoicePool({ spawnVoice: () => fv.v, now: () => 5, defer: (fn) => deferred.push(fn) });
    pool.noteOn('lane-a', 60, 90);
    pool.noteOff('lane-a', 60);
    expect(fv.calls).toContain('release @5');
    expect(fv.calls).not.toContain('dispose'); // not yet
    deferred.forEach((fn) => fn());
    expect(fv.calls).toContain('dispose');
  });

  it('sustain ON defers note-off releases until sustain OFF', () => {
    const fv = fakeVoice();
    const deferred: Array<() => void> = [];
    const pool = createLiveVoicePool({ spawnVoice: () => fv.v, now: () => 0, defer: (fn) => deferred.push(fn) });
    pool.setSustain(true);
    pool.noteOn('lane-a', 60, 90);
    pool.noteOff('lane-a', 60);          // held by pedal
    expect(fv.calls).not.toContain('release @0');
    pool.setSustain(false);              // pedal up → release now
    expect(fv.calls).toContain('release @0');
  });

  it('re-pressing a still-held note releases the old voice first (no stuck notes)', () => {
    let n = 0;
    const voices = [fakeVoice(), fakeVoice()];
    const pool = createLiveVoicePool({ spawnVoice: () => voices[n++].v, now: () => 0, defer: () => {} });
    pool.noteOn('lane-a', 60, 90);
    pool.noteOn('lane-a', 60, 100);
    expect(voices[0].calls).toContain('release @0');
  });

  it('panic releases all held voices', () => {
    const fv = fakeVoice();
    const pool = createLiveVoicePool({ spawnVoice: () => fv.v, now: () => 7, defer: () => {} });
    pool.noteOn('lane-a', 60, 90);
    pool.noteOn('lane-a', 64, 90);
    pool.panic();
    expect(fv.calls.filter((c) => c.startsWith('release')).length).toBe(2);
  });
});
