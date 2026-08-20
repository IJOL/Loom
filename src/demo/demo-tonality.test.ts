// A demo's declared key has to be the key its notes are actually in.
//
// It is metadata, so nothing crashes when it is wrong — it just quietly poisons
// everything that reads `musicality`: the weave blends its degrees in the wrong
// scale, scale-lock pulls notes to the wrong pitches, and a follower harmonises
// a melody it has first flattened into a key that is not there. Minimal Techno
// was declared A minor and played in C minor, which put 23 of its 96 melodic
// notes outside the scale before anything even looked at them.
//
// The rule is deliberately NOT "the declared key must fit". Music that modulates
// or is chromatic has no single key, and demanding one would be demanding the
// wrong thing: Giant Steps changes key every two bars by design, and its best
// possible single key covers 64% of its notes. What is a defect is a demo where
// a key fits nearly everything and the declared one does not — that is a label
// nobody checked, not a piece that travels.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { scaleIntervals, type ScaleId } from '../core/musicality';

const SCALES: ScaleId[] = ['minor', 'major', 'dorian', 'phrygian', 'mixolydian', 'lydian'];

/** A demo below this many melodic notes cannot say anything about a key. */
const ENOUGH_NOTES = 20;
/** A key this good exists ⇒ the piece HAS a key, so the label has no excuse. */
const UNAMBIGUOUS = 0.9;
/** …and the declared one may not be worse than this. The gap leaves room for a
 *  couple of passing tones without leaving room for a wrong label. */
const ACCEPTABLE = 0.8;

interface Demo { musicality?: { key: number; scale: ScaleId }; lanes?: unknown[] }

function pitchClasses(s: Demo): Map<number, number> {
  const out = new Map<number, number>();
  for (const lane of (s.lanes ?? []) as { engineId?: string; clips?: ({ notes?: { midi: number }[] } | null)[] }[]) {
    // Percussion is skipped: a drum note picks a voice, not a pitch, so its
    // "pitch class" is an index into a kit and says nothing about the key.
    if (lane.engineId === 'drums-machine') continue;
    for (const clip of lane.clips ?? []) {
      for (const n of clip?.notes ?? []) {
        const pc = ((n.midi % 12) + 12) % 12;
        out.set(pc, (out.get(pc) ?? 0) + 1);
      }
    }
  }
  return out;
}

const fitOf = (pcs: Map<number, number>, key: number, scale: ScaleId): number => {
  const inScale = new Set(scaleIntervals(scale).map((i) => (key + i) % 12));
  let inside = 0, total = 0;
  for (const [pc, count] of pcs) { total += count; if (inScale.has(pc)) inside += count; }
  return total === 0 ? 0 : inside / total;
};

const files = readdirSync('public/demos').filter((f) => f.endsWith('.json') && !f.startsWith('_'));

describe('every demo declares the key it is actually in', () => {
  it.each(files)('%s', (file) => {
    const s: Demo = JSON.parse(readFileSync(`public/demos/${file}`, 'utf8'));
    if (!s.musicality || !s.lanes) return;
    const pcs = pitchClasses(s);
    const total = [...pcs.values()].reduce((a, b) => a + b, 0);
    if (total < ENOUGH_NOTES) return;

    let best = 0;
    for (let key = 0; key < 12; key++) {
      for (const scale of SCALES) best = Math.max(best, fitOf(pcs, key, scale));
    }
    // The piece may genuinely have no single key. Nothing to hold it to.
    if (best < UNAMBIGUOUS) return;

    const declared = fitOf(pcs, s.musicality.key, s.musicality.scale);
    expect(declared).toBeGreaterThanOrEqual(ACCEPTABLE);
  });
});
