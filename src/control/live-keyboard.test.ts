// src/control/live-keyboard.test.ts
import { describe, it, expect } from 'vitest';
import { createLiveVoicePool } from './live-keyboard';
import { expandChordForLane } from './live-notefx';
import { getNoteFxChain } from '../notefx/notefx-registry';
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

  it('a grouped noteOn spawns one voice per chord note; noteOff releases all', () => {
    const released: string[] = [];
    const pool = createLiveVoicePool({
      spawnVoice: () => ({ trigger: () => {}, release: () => { released.push('r'); }, dispose: () => {}, connect: () => {}, getAudioParams: () => new Map() }) as Voice,
      now: () => 0,
      defer: (fn) => fn(),
    });
    // playMidis is the FULL list of notes to sound (root + chord notes), keyed
    // by the physical key (60) — NOT appended to it. See the octave-shift test
    // below for why the group key must stay decoupled from the note list.
    pool.noteOn('lane', 60, 100, [60, 64, 67]); // Do major triad, keyed by physical 60
    pool.noteOff('lane', 60);
    expect(released.length).toBe(3); // all three voices released by the single key-up
  });

  it('an octave-shifted chord (root != physical key) still releases fully via the physical key (no stuck notes)', () => {
    const chain = getNoteFxChain('lane-octave-regression');
    const chordFx = chain.addNoteFx('chord');
    chordFx.params.octave = 1; // transposes the WHOLE chord, including the root
    chordFx.enabled = true;

    const released: string[] = [];
    const pool = createLiveVoicePool({
      spawnVoice: () => ({ trigger: () => {}, release: () => { released.push('r'); }, dispose: () => {}, connect: () => {}, getAudioParams: () => new Map() }) as Voice,
      now: () => 0,
      defer: (fn) => fn(),
    });

    const physicalKey = 60;
    const playMidis = expandChordForLane('lane-octave-regression', physicalKey, 100, 120);
    expect(playMidis[0]).not.toBe(physicalKey); // sanity: expansion's root is transposed away from the key

    pool.noteOn('lane-octave-regression', physicalKey, 100, playMidis);
    pool.noteOff('lane-octave-regression', physicalKey); // release by the PHYSICAL key, not the (transposed) root

    expect(released.length).toBe(playMidis.length); // nothing left stuck
  });
});
