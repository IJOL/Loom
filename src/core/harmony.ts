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

/** The same chord in each of its positions: root, 1st, 2nd.
 *
 *  An inversion rotates the lowest voice up an octave. THREE positions for a
 *  triad, not four — a third inversion needs a seventh chord, which this file
 *  does not build; when sevenths arrive this grows a position rather than
 *  changing shape.
 *
 *  Every result stays ascending, because `nearestVoicing` compares voicings
 *  voice by voice and a re-ordered one would compare against the wrong note. */
export function inversions(triad: number[]): number[][] {
  const out: number[][] = [triad];
  let cur = triad;
  for (let i = 1; i < triad.length; i++) {
    const [low, ...rest] = cur;
    cur = [...rest, low + 12];
    out.push(cur);
  }
  return out;
}

/** The voicing of `triad` closest to `prev`, by total semitone movement.
 *
 *  This is what makes a generated chord part sound played rather than computed.
 *  `diatonicTriad` builds every bar from scratch in root position, so a
 *  progression moves the part a long way between bars for no musical reason:
 *  i-VI-III-VII in A minor from base 48 moves 25, then 15, then 21 semitones —
 *  61 across four bars, measured.
 *
 *  Bounded to within an octave of the chord's own root position. Unbounded, a
 *  long progression walks the part out of the register its caller put it in,
 *  one small nearest step at a time — every move locally reasonable and the sum
 *  of them not.
 *
 *  `prev === null` is the first bar and gives root position: there is nothing
 *  to be near, and choosing a voicing then would only move where the part
 *  starts. A `prev` of a different size is left alone for the same reason —
 *  there is no voice-by-voice comparison to make. */
export function nearestVoicing(triad: number[], prev: number[] | null): number[] {
  if (!prev || prev.length !== triad.length) return triad;
  const home = triad[0];
  let best = triad;
  let bestCost = Infinity;
  for (const cand of inversions(triad)) {
    for (const shift of [-12, 0, 12]) {
      const v = cand.map((m) => m + shift);
      if (Math.abs(v[0] - home) > 12) continue;
      let cost = 0;
      for (let i = 0; i < v.length; i++) cost += Math.abs(v[i] - prev[i]);
      if (cost < bestCost) { bestCost = cost; best = v; }
    }
  }
  return best;
}

/** Voice-lead a part that is already written — every simultaneous stack moved
 *  to the inversion nearest a fixed `anchor` chord.
 *
 *  This is the other end of `nearestVoicing` from `renderChordComp`, and it
 *  exists because WEAVE does not go through that function at all. A woven
 *  chordal lane draws its shape on the TONIC and the progression then shifts
 *  every note by the degree of its bar — the right chord, in whatever position
 *  the shift happened to land on, so the part jumps between bars for no musical
 *  reason.
 *
 *  Anchored rather than CHAINED bar to bar, which is what `renderChordComp`
 *  does, and the difference is not style. WEAVE re-derives a lane's notes on
 *  every scheduling ask, over a window that is usually shorter than the
 *  progression: a chain would restart from root position at the top of each
 *  fold, so the seam between folds would jump exactly as before, and the
 *  voicing of a bar would depend on how much of the phrase happened to be in
 *  view. Anchored, every bar is placed against the same reference, so the
 *  answer is the same however the notes arrive — and consecutive bars end up
 *  near each other because both are near the anchor.
 *
 *  Grouped by START rather than by bar: a bar of a stab shape holds four
 *  separate chords, and voicing all twelve notes as one stack would be
 *  meaningless. A stack of ONE is left alone — a bass or a melody is one note
 *  at a time and has no voicing to choose. */
export function revoiceChords(
  notes: readonly NoteEvent[], anchor: number[] | null,
): NoteEvent[] {
  if (!anchor) return [...notes];
  const byStart = new Map<number, NoteEvent[]>();
  for (const n of notes) {
    const at = byStart.get(n.start);
    if (at) at.push(n); else byStart.set(n.start, [n]);
  }
  const moved = new Map<NoteEvent, number>();
  for (const stack of byStart.values()) {
    if (stack.length < 2) continue;
    const ascending = [...stack].sort((a, b) => a.midi - b.midi);
    const voiced = nearestVoicing(ascending.map((n) => n.midi), anchor);
    // nearestVoicing returns its input unchanged when the sizes disagree, so a
    // stack the anchor cannot describe — a four-note chord under a triad —
    // simply stays as written rather than being voiced against the wrong notes.
    ascending.forEach((n, i) => moved.set(n, voiced[i]));
  }
  return notes.map((n) => (moved.has(n) ? { ...n, midi: moved.get(n)! } : n));
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

  // The previous bar's voicing, so each chord is voiced NEAR the last rather
  // than rebuilt in root position — see nearestVoicing. Same degrees, same
  // rhythm, same notes of the scale; only which octave each voice sits in.
  let prevVoicing: number[] | null = null;
  for (let bar = 0; bar < bars; bar++) {
    const triad = nearestVoicing(diatonicTriad(roots[bar], octaveBase, key, scale), prevVoicing);
    prevVoicing = triad;
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
