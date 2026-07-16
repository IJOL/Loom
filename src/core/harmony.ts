// src/core/harmony.ts
// Pure chord-accompaniment helpers — no DOM, no audio.
// Produces diatonic triads voiced to accompany a melody clip.

import { TICKS_PER_STEP, type NoteEvent } from './notes';
import { scaleDegreeToMidi, midiToScaleDegree, scaleIntervals, type ScaleId, type StyleId } from './musicality';

// ── Rhythmic pattern table ────────────────────────────────────────────────────
// Each entry: list of [stepOffset, durationSteps] within one 4/4 bar.
// Scale step positions by barTicks/16 so non-4/4 meters still work (barTicks
// is always the canonical bar length from the project meter).
interface HitPattern { stepOffset: number; durationSteps: number; }

// Four comping shapes, shared by the styles that comp alike. Named so the table
// below reads as "what the chords do", not as a wall of numbers.
const OFFBEAT_STABS   = [2, 6, 10, 14].map((s) => ({ stepOffset: s, durationSteps: 1 }));
const PULSING_EIGHTHS = [0, 2, 4, 6, 8, 10, 12, 14].map((s) => ({ stepOffset: s, durationSteps: 1 }));
const SPARSE_STABS    = [{ stepOffset: 0, durationSteps: 2 }, { stepOffset: 8, durationSteps: 2 }];
const SUSTAINED       = [{ stepOffset: 0, durationSteps: 16 }];
// syncopated: downbeat + 16th ahead of beat 3 (step 9) + offbeat before bar end
const SYNCOPATED      = [{ stepOffset: 0, durationSteps: 1 }, { stepOffset: 9, durationSteps: 1 }, { stepOffset: 14, durationSteps: 1 }];

const STYLE_PATTERNS: Record<StyleId, HitPattern[]> = {
  house:           OFFBEAT_STABS,
  'deep-house':    OFFBEAT_STABS,
  garage:          OFFBEAT_STABS,
  techno:          SPARSE_STABS,
  'acid-techno':   SPARSE_STABS,
  'dub-techno':    OFFBEAT_STABS,
  trance:          PULSING_EIGHTHS,
  psytrance:       PULSING_EIGHTHS,
  edm:             PULSING_EIGHTHS,
  synthwave:       PULSING_EIGHTHS,
  electro:         SPARSE_STABS,
  breakbeat:       SYNCOPATED,
  'drum-and-bass': SYNCOPATED,
  jungle:          SYNCOPATED,
  dubstep:         SPARSE_STABS,
  idm:             SYNCOPATED,
  glitch:          SYNCOPATED,
  downtempo:       SUSTAINED,
  'lo-fi':         SUSTAINED,
  ambient:         SUSTAINED,
};

// ── Public API ────────────────────────────────────────────────────────────────

/** Diatonic triad: scale degrees [root, root+2, root+4] voiced as MIDI pitches. */
export function diatonicTriad(
  rootDegree: number,
  octaveBase: number,
  key: number,
  scale: ScaleId,
): number[] {
  return [0, 2, 4].map((offset) => scaleDegreeToMidi(rootDegree + offset, octaveBase, key, scale));
}

/**
 * Per bar, pick the chord root degree (0-based scale degree class) that best
 * harmonises the melody notes in that bar. Strategy: count scale-degree pitch
 * classes across notes whose `start` falls in [bar*barTicks, (bar+1)*barTicks).
 * The most frequent degree class is the root. Empty bar → repeat previous root
 * (or tonic 0 for the very first bar).
 */
export function melodyToChordRoots(
  notes: readonly NoteEvent[],
  key: number,
  scale: ScaleId,
  barTicks: number,
  bars: number,
): number[] {
  const scaleLen = scaleIntervals(scale).length;
  const roots: number[] = [];
  let lastRoot = 0;

  for (let bar = 0; bar < bars; bar++) {
    const lo = bar * barTicks;
    const hi = lo + barTicks;

    // Count the scale-degree pitch class of each note in this bar.
    const freq = new Map<number, number>();
    for (const n of notes) {
      if (n.start < lo || n.start >= hi) continue;
      // midiToScaleDegree returns a degree that may span multiple octaves;
      // reduce to pitch-class within the scale (0 … scaleLen-1).
      const deg = midiToScaleDegree(n.midi, key, scale, 0);
      const pc = ((deg % scaleLen) + scaleLen) % scaleLen;
      freq.set(pc, (freq.get(pc) ?? 0) + 1);
    }

    if (freq.size === 0) {
      // Empty bar: reuse previous chord root.
      roots.push(lastRoot);
    } else {
      // Pick the degree class with the highest frequency; ties break by lowest pc.
      let bestPc = -1;
      let bestCount = -1;
      for (const [pc, count] of freq) {
        if (count > bestCount || (count === bestCount && pc < bestPc)) {
          bestPc = pc;
          bestCount = count;
        }
      }
      lastRoot = bestPc;
      roots.push(bestPc);
    }
  }

  return roots;
}

/**
 * Build the chord accompaniment NoteEvent[] for `bars` bars.
 * One diatonic triad per bar (from melodyToChordRoots), voiced at `octaveBase`,
 * with a per-style rhythmic pattern.
 */
export function renderChordComp(
  notes: readonly NoteEvent[],
  opts: {
    key: number;
    scale: ScaleId;
    style: StyleId;
    bars: number;
    barTicks: number;
    octaveBase: number;
  },
): NoteEvent[] {
  const { key, scale, style, bars, barTicks, octaveBase } = opts;
  const stepTicks = barTicks / 16; // size of one 16th-note step in ticks
  const clipEnd = bars * barTicks;

  const roots = melodyToChordRoots(notes, key, scale, barTicks, bars);
  const pattern = STYLE_PATTERNS[style] ?? STYLE_PATTERNS['acid-techno'];
  const out: NoteEvent[] = [];

  for (let bar = 0; bar < bars; bar++) {
    const triad = diatonicTriad(roots[bar], octaveBase, key, scale);
    let firstHitInBar = true;
    for (const hit of pattern) {
      const start = bar * barTicks + hit.stepOffset * stepTicks;
      const duration = hit.durationSteps * stepTicks;
      if (start >= clipEnd) continue;
      const actualDur = Math.min(duration, clipEnd - start);
      const velocity = firstHitInBar ? 115 : 95;
      firstHitInBar = false;
      for (const midi of triad) {
        out.push({ start, duration: actualDur, midi, velocity });
      }
    }
  }

  return out;
}
