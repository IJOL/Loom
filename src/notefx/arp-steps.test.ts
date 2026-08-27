import { describe, it, expect } from 'vitest';
import {
  parseArpSteps, formatArpSteps, stepNote, arpStepSequence,
  DEFAULT_ARP_STEPS, REST,
} from './arp-steps';
import { generateArpSequence, ARP_PROCESSOR_DEFAULTS, ArpProcessor } from './arp-processor';
import { inScale } from '../core/musicality';
import type { NoteFxEvent } from './notefx-types';

const POOL = [60, 62, 64, 65, 67];

describe('reading a written pattern', () => {
  it('reads numbers separated by spaces or commas', () => {
    expect(parseArpSteps('0 2 4')).toEqual([0, 2, 4]);
    expect(parseArpSteps('0,2,4')).toEqual([0, 2, 4]);
    expect(parseArpSteps('  0   2  ')).toEqual([0, 2]);
  });

  it('reads a dot as a rest', () => {
    expect(parseArpSteps('0 . 2')).toEqual([0, REST, 2]);
  });

  it('keeps NEGATIVE indices, because they are real positions', () => {
    // -1 is the top of the pool, an octave below where the walk starts. The
    // first sketch used -1 as the rest token, which would have stolen the only
    // way to reach it.
    expect(parseArpSteps('-1 0 -2')).toEqual([-1, 0, -2]);
  });

  it('treats anything unreadable as a rest rather than throwing', () => {
    // Somebody is TYPING into this. A pattern that threw halfway through a
    // number would silence the lane on its way to being valid.
    expect(parseArpSteps('0 x 2')).toEqual([0, REST, 2]);
    expect(parseArpSteps('')).toEqual([]);
  });

  it('writes back what it read', () => {
    for (const src of ['0 2 4', '0 . 2', '-1 3 .']) {
      expect(formatArpSteps(parseArpSteps(src))).toBe(src);
    }
  });
});

describe('a step over a pool', () => {
  it('plays the position it names', () => {
    expect(stepNote(0, POOL)).toBe(60);
    expect(stepNote(2, POOL)).toBe(64);
  });

  it('is silent on a rest', () => {
    expect(stepNote(REST, POOL)).toBeNull();
  });

  it('WRAPS, so a pattern outlives the pool it was written against', () => {
    // The pool grows and shrinks under the pattern as the scale, the octaves
    // and the played note change. Falling off the end would make a written
    // pattern a thing you have to rewrite every time you touch SCALE.
    expect(stepNote(5, POOL)).toBe(stepNote(0, POOL));
    expect(stepNote(7, POOL)).toBe(stepNote(2, POOL));
  });

  it('wraps a negative from the TOP', () => {
    expect(stepNote(-1, POOL)).toBe(POOL[POOL.length - 1]);
  });

  it('is silent against an empty pool rather than throwing', () => {
    expect(stepNote(0, [])).toBeNull();
  });
});

describe('the sequence', () => {
  it('cycles the pattern to fill the count', () => {
    expect(arpStepSequence(parseArpSteps('0 2'), POOL, 5))
      .toEqual([60, 64, 60, 64, 60]);
  });

  it('plays NOTHING for an empty pattern, rather than falling back', () => {
    // Clearing the box is a thing somebody does on purpose. Answering it with
    // notes they did not write is worse than silence.
    expect(arpStepSequence([], POOL, 3)).toEqual([null, null, null]);
  });

  it('answers the same pattern the same way, every time', () => {
    const s = parseArpSteps('3 . 1 4');
    expect(arpStepSequence(s, POOL, 8)).toEqual(arpStepSequence(s, POOL, 8));
  });
});

describe('through the arp itself', () => {
  const tonality = { key: 0, scale: 'major' as const };

  it('is the plain upward walk at its default, so switching PATTERN changes nothing', () => {
    // You are handed what you already had rather than an empty box.
    const written = generateArpSequence(60, 'steps', 1, 'global', 4, tonality, DEFAULT_ARP_STEPS);
    const walked = generateArpSequence(60, 'up', 1, 'global', 4, tonality);
    expect(written).toEqual(walked);
  });

  it('plays the written shape instead of a walk', () => {
    const out = generateArpSequence(60, 'steps', 1, 'global', 4, tonality, '2 0 2 0');
    expect(out[0]).toBe(out[2]);
    expect(out[1]).toBe(out[3]);
    expect(out[0]).not.toBe(out[1]);
  });

  it('stays in the key, like every other pattern', () => {
    // It picks positions on the pool, and the pool is what the key gave it.
    const out = generateArpSequence(64, 'steps', 2, 'global', 12, tonality, '0 3 1 5 2');
    for (const n of out) expect(n !== null && inScale(n, 0, 'major')).toBe(true);
  });

  it('survives a transpose — the same shape, moved', () => {
    // The whole reason the steps are INDICES. An absolute-note editor already
    // exists and it is the piano roll.
    const at = (root: number) =>
      generateArpSequence(root, 'steps', 1, 'major', 5, undefined, '0 2 1 4 3');
    const low = at(60);
    const high = at(67);
    expect(low.map((n, i) => (high[i] ?? 0) - (n ?? 0))).toEqual([7, 7, 7, 7, 7]);
  });
});

describe('rests through the processor', () => {
  const note = (gate: number): NoteFxEvent =>
    ({ note: 60, time: 0, gate, accent: false });

  const run = (steps: string, gate = 1) => new ArpProcessor({
    ...ARP_PROCESSOR_DEFAULTS, pattern: 'steps', rate: 'free', rateFreeHz: 8, steps,
  }).process([note(gate)], { bpm: 120, key: 0, scale: 'major' });

  it('emits nothing where the pattern rests', () => {
    expect(run('0 . 2 .').length).toBeLessThan(run('0 1 2 3').length);
  });

  it('leaves the HOLE where it was — a rest is not a shorter run', () => {
    // Splicing rests out would turn a written rhythm into the same notes
    // played faster, which is the opposite of what the box is for.
    const withRests = run('0 . . 3');
    const solid = run('0 1 2 3');
    // Eight slots fit under this gate, so a four-step pattern cycles twice:
    // two hits per pass, four in all — not two.
    expect(solid).toHaveLength(8);
    expect(withRests).toHaveLength(4);
    // And every surviving hit keeps the SLOT it was written in. This is the
    // claim: splicing the rests out would leave four hits too, back to back,
    // and read as the same notes played faster.
    expect(withRests.map((n) => n.time))
      .toEqual([solid[0], solid[3], solid[4], solid[7]].map((n) => n.time));
  });

  it('falls silent on a pattern of nothing but rests', () => {
    expect(run('. . . .')).toEqual([]);
  });
});
