// The one door every tempo change comes through.
//
// It is the only place a tempo can be refused, and one has to be refusable:
// note times are `(60 / bpm) / 96` per tick, so a tempo that is not a number
// makes every note's gate NaN on EVERY lane at once — and a gate of NaN is a
// voice that can neither reach its own gate-off nor be released by a stop,
// because every comparison against NaN is false. That is the lock-up this
// branch exists for, at the widest possible blast radius.
//
// The paths that reach here read their tempo from somewhere else — a MIDI file,
// a detected loop, a save, a demo — and `clampBpm` is Math.max/min, which hands
// NaN back untouched.
import { describe, it, expect, vi } from 'vitest';
import { createBpmBroadcaster } from './bpm-broadcast';
import type { Sequencer } from '../core/sequencer';
import type { FxBus } from '../core/fx';
import type { InsertChain } from '../core/insert-chain';
import type { LaneResourceMap } from '../core/lane-resources';

function harness(startBpm = 120) {
  const seq = { bpm: startBpm } as Sequencer;
  const laneChain = { setBpm: vi.fn() } as unknown as InsertChain;
  const sendChain = { setBpm: vi.fn() } as unknown as InsertChain;
  const masterChain = { setBpm: vi.fn() } as unknown as InsertChain;
  const b = createBpmBroadcaster({
    seq,
    fx: { sends: [{ inserts: sendChain }] } as unknown as FxBus,
    masterInsertChain: masterChain,
    laneResources: new Map([['lane-1', { inserts: laneChain }]]) as unknown as LaneResourceMap,
  });
  return { b, seq, laneChain, sendChain, masterChain };
}

describe('bpm broadcast', () => {
  it('carries a real tempo to the sequencer and every insert chain', () => {
    const { b, seq, laneChain, sendChain, masterChain } = harness();
    b.broadcast(137.5);
    expect(seq.bpm).toBe(137.5);
    expect(laneChain.setBpm).toHaveBeenCalledWith(137.5);
    expect(sendChain.setBpm).toHaveBeenCalledWith(137.5);
    expect(masterChain.setBpm).toHaveBeenCalledWith(137.5);
  });

  for (const bad of [NaN, Infinity, -Infinity]) {
    it(`refuses ${bad} and keeps the tempo it had`, () => {
      const { b, seq, laneChain, masterChain } = harness(128);
      b.broadcast(bad);
      expect(seq.bpm).toBe(128);
      // And nothing downstream is told either: half a broadcast would leave the
      // delays and the sequencer disagreeing about what a bar is.
      expect(laneChain.setBpm).not.toHaveBeenCalled();
      expect(masterChain.setBpm).not.toHaveBeenCalled();
    });
  }
});
