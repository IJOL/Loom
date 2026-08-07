// The two macros that rewrite notes. The other four move params.

import { TICKS_PER_STEP, type NoteEvent } from '../core/notes';
import { metricWeight } from './metric-weight';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A note has to be at least this long to be worth splitting: an eighth splits
 *  into two sixteenths, a sixteenth into nothing anyone would hear as a note. */
const SPLITTABLE = TICKS_PER_STEP * 2;

/** Below the neutral, thin out weakest-first. Above it, subdivide.
 *
 *  Thickening NEVER invents a pitch — it only splits a note that is already
 *  there — so the bar can only ever contain pitches it already contained. That
 *  is what keeps density from quietly transposing anything. */
function applyDensity(notes: NoteEvent[], density: number, barTicks: number): NoteEvent[] {
  if (density === 0.5 || notes.length === 0) return notes;

  if (density < 0.5) {
    // 0 keeps only the strongest, 0.5 keeps everything.
    const floor = (0.5 - density) * 2;
    const kept = notes.filter((n) => metricWeight(n.start, barTicks) >= floor * 0.95);
    // An empty bar reads as a dead lane rather than as a sparse one, so the
    // strongest hit always survives however far the knob goes down.
    if (kept.length > 0) return kept;
    const strongest = notes.reduce(
      (best, n) => (metricWeight(n.start, barTicks) > metricWeight(best.start, barTicks) ? n : best),
      notes[0],
    );
    return [strongest];
  }

  const amount = (density - 0.5) * 2;
  const out: NoteEvent[] = [];
  for (const n of notes) {
    // WEAKEST first: filling the gaps between beats reads as the bar getting
    // busier, whereas subdividing the downbeat first reads as the groove being
    // tampered with. The downbeat only splits once the knob is near the top.
    //
    // The epsilon is not decoration: (0.95 - 0.5) * 2 is 0.8999999999999999 in
    // binary floating point, so a note weighted exactly 0.9 would never split
    // no matter how close the knob got.
    if (n.duration >= SPLITTABLE && metricWeight(n.start, barTicks) <= amount + 1e-9) {
      const half = Math.floor(n.duration / 2);
      out.push({ ...n, duration: half });
      out.push({ ...n, start: n.start + half, duration: n.duration - half });
    } else {
      out.push(n);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Scales velocity around the neutral.
 *
 *  The 0.55..1.45 span is chosen so a note written at 99 stays under 100 at the
 *  neutral. Accent is `velocity >= 100` everywhere in Loom, so a macro that
 *  quietly crossed that line for every note would change the SOUND of the
 *  engine — filter envelope, punch — and not merely its loudness. */
function applyEnergy(notes: NoteEvent[], energy: number): NoteEvent[] {
  if (energy === 0.5) return notes;
  const gain = 0.55 + energy * 0.9;
  return notes.map((n) => ({ ...n, velocity: clamp(Math.round(n.velocity * gain), 1, 127) }));
}

export function applyNoteMacros(
  notes: NoteEvent[],
  macros: { density: number; energy: number },
  barTicks: number,
): NoteEvent[] {
  return applyEnergy(applyDensity(notes, macros.density, barTicks), macros.energy);
}
