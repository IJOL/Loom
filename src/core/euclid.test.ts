import { describe, it, expect } from 'vitest';
import { euclid, euclidNotes, euclidNotesAt } from './euclid';
import { TICKS_PER_STEP } from './notes';
import { VOICE_MIDI } from '../engines/drum-gm-map';

const show = (p: boolean[]) => p.map((h) => (h ? 'x' : '.')).join('');
const steps = (notes: { start: number }[]) => notes.map((n) => n.start / TICKS_PER_STEP);

// Circular distances between consecutive onsets — the quantity a Euclidean
// rhythm is defined to equalise.
function onsetGaps(p: boolean[]): number[] {
  const onsets = p.flatMap((hit, i) => (hit ? [i] : []));
  return onsets.map((at, i) =>
    i === onsets.length - 1 ? p.length - at + onsets[0] : onsets[i + 1] - at,
  );
}

describe('euclid', () => {
  it('E(3,8) is the tresillo', () => {
    expect(show(euclid(3, 8))).toBe('x..x..x.');
  });

  it('E(5,8) is the cinquillo', () => {
    expect(show(euclid(5, 8))).toBe('x.xx.xx.');
  });

  it('E(2,5) spreads two hits over five', () => {
    expect(show(euclid(2, 5))).toBe('x.x..');
  });

  it('E(4,16) is four on the floor', () => {
    expect(show(euclid(4, 16))).toBe('x...x...x...x...');
  });

  it('E(4,4) hits every step', () => {
    expect(show(euclid(4, 4))).toBe('xxxx');
  });

  it('E(0,8) is silent', () => {
    expect(show(euclid(0, 8))).toBe('........');
  });

  it('E(8,8) is all hits', () => {
    expect(show(euclid(8, 8))).toBe('xxxxxxxx');
  });

  it('rotation shifts the pattern cyclically', () => {
    expect(show(euclid(3, 8, 1))).toBe('..x..x.x');
  });

  it('a full rotation is the identity', () => {
    expect(euclid(3, 8, 8)).toEqual(euclid(3, 8));
  });

  it('negative rotation wraps to the far end', () => {
    expect(euclid(3, 8, -1)).toEqual(euclid(3, 8, 7));
  });

  it('rotation preserves the hit count', () => {
    for (let r = -8; r <= 8; r++) {
      expect(euclid(3, 8, r).filter(Boolean).length).toBe(3);
    }
  });

  it('places exactly the hits asked for, whatever k and n', () => {
    for (let n = 1; n <= 32; n++) {
      for (let k = 0; k <= n; k++) {
        const p = euclid(k, n);
        expect(p.length).toBe(n);
        expect(p.filter(Boolean).length).toBe(k);
      }
    }
  });

  // The defining property: a Euclidean rhythm is maximally even, so the gaps
  // between onsets take at most two sizes and those differ by exactly one.
  it('spaces the hits as evenly as possible', () => {
    for (let n = 2; n <= 32; n++) {
      for (let k = 1; k <= n; k++) {
        const sizes = [...new Set(onsetGaps(euclid(k, n)))].sort((a, b) => a - b);
        expect(sizes.length).toBeLessThanOrEqual(2);
        if (sizes.length === 2) expect(sizes[1] - sizes[0]).toBe(1);
      }
    }
  });

  it('clamps more hits than steps down to every step', () => {
    expect(show(euclid(10, 4))).toBe('xxxx');
  });

  it('has nothing to fill when there are no steps', () => {
    expect(euclid(3, 0)).toEqual([]);
  });

  it('survives nonsense input instead of throwing', () => {
    for (const [k, n] of [[-1, 8], [3, -8], [NaN, 8], [3, NaN], [2.5, 8.5]]) {
      expect(() => euclid(k, n)).not.toThrow();
    }
  });
});

describe('euclidNotes', () => {
  it('lays the hits on the voice GM midi, one per step', () => {
    const notes = euclidNotes({ voice: 'kick', hits: 4, steps: 16 });
    expect(notes.length).toBe(4);
    for (const n of notes) expect(n.midi).toBe(VOICE_MIDI.kick);
    expect(steps(notes)).toEqual([0, 4, 8, 12]);
  });

  it('fills one cycle when no clip length is given', () => {
    expect(euclidNotes({ voice: 'kick', hits: 3, steps: 8 })).toEqual(
      euclidNotes({ voice: 'kick', hits: 3, steps: 8 }, 8),
    );
  });

  // A cycle that does not divide the clip keeps wrapping — this is the whole
  // point of a 5-step voice in a 16-step clip.
  it('tiles a cycle that does not divide the clip', () => {
    const notes = euclidNotes({ voice: 'closedHat', hits: 3, steps: 5 }, 16);
    expect(steps(notes)).toEqual([0, 2, 4, 5, 7, 9, 10, 12, 14, 15]);
  });

  it('carries the rotation through to the notes', () => {
    const notes = euclidNotes({ voice: 'kick', hits: 3, steps: 8, rotation: 1 }, 8);
    expect(steps(notes)).toEqual([2, 5, 7]);
  });

  it('writes un-accented notes by default', () => {
    for (const n of euclidNotes({ voice: 'snare', hits: 3, steps: 8 })) {
      expect(n.velocity).toBeLessThan(100); // notes.ts: >= 100 reads as an accent
    }
  });

  it('takes an accent velocity', () => {
    for (const n of euclidNotes({ voice: 'snare', hits: 3, steps: 8, velocity: 115 })) {
      expect(n.velocity).toBeGreaterThanOrEqual(100);
    }
  });

  it('keeps each hit inside its own step', () => {
    for (const n of euclidNotes({ voice: 'openHat', hits: 5, steps: 8 })) {
      expect(n.duration).toBeGreaterThan(0);
      expect(n.duration).toBeLessThanOrEqual(TICKS_PER_STEP);
    }
  });

  it('writes nothing when the voice has no hits', () => {
    expect(euclidNotes({ voice: 'kick', hits: 0, steps: 16 })).toEqual([]);
  });
});

describe('euclidNotesAt', () => {
  // A sampler pad is any midi with no DrumVoice behind it, so the drum grid
  // generates by the row's note; euclidNotes is this with the GM lookup done.
  it('lays the cycle on any midi, DrumVoice or not', () => {
    const notes = euclidNotesAt(61, { hits: 2, steps: 4 });
    expect(steps(notes)).toEqual([0, 2]);
    for (const n of notes) expect(n.midi).toBe(61);
  });

  it('is what euclidNotes writes for a voice', () => {
    expect(euclidNotes({ voice: 'snare', hits: 3, steps: 8 }, 16))
      .toEqual(euclidNotesAt(VOICE_MIDI.snare, { hits: 3, steps: 8 }, 16));
  });
});
