// Crossfade two melodic patterns.
//
// The onsets hand over exactly like a rhythm. What is different here is the
// PITCH, which walks in scale DEGREES rather than in semitones: degree 1 of A
// reaches degree 5 of B through 3, and never through anything outside the
// scale. That is what makes this unable to detune by construction — there is no
// correction pass afterwards because there is nothing to correct.
//
// Interpolating semitones instead would walk through every note between the
// two, in the key or not, and the halfway point of a crossfade would be exactly
// where it sounded worst.

import type { NoteEvent } from '../core/notes';
import { midiToScaleDegree, scaleDegreeToMidi, type ScaleId } from '../core/musicality';
import { blendRhythm } from './blend-rhythm';
import { metricWeight } from './metric-weight';

/** Every note struck at `start`, lowest first.
 *
 *  ALL of them, not the first. Reading one was the bug behind "los acordes
 *  desaparecen antes de nada": a pad's three-note chord came out as a single
 *  interpolated note the moment the dial left an end, so a lane lost its
 *  harmony to a control nobody had moved far.
 *
 *  Sorted by pitch so the two sides pair voice for voice — bass with bass, top
 *  with top. Pairing in array order instead would cross the voices whenever one
 *  pattern happened to list its chord downwards. */
const allAtStart = (ns: NoteEvent[], start: number) =>
  ns.filter((n) => n.start === start).sort((p, q) => p.midi - q.midi);

export function blendMelody(
  a: NoteEvent[], b: NoteEvent[], x: number, barTicks: number,
  key: number, scale: ScaleId, octaveBase: number,
): NoteEvent[] {
  // Pair by ONSET alone. blendRhythm identifies a hit by (start, midi) because
  // in percussion the pitch picks the drum; two melodies rarely agree on a
  // pitch, so the same rule here would leave every note unpaired and nothing
  // would ever interpolate. Flattening the pitch to a constant before handing
  // the patterns over is what reduces the key to the onset.
  //
  // ONE entry per onset, whatever its chord holds. Flattening a three-note
  // chord to three identical hits made the skeleton carry it three times, and
  // every copy then resolved to the same interpolated pitch: three notes in
  // unison, which is a chord to a test that counts them and one note to an ear.
  const flat = (ns: NoteEvent[]) => {
    const seen = new Set<number>();
    const out: NoteEvent[] = [];
    for (const n of ns) {
      if (seen.has(n.start)) continue;
      seen.add(n.start);
      out.push({ ...n, midi: 0 });
    }
    return out;
  };
  const skeleton = blendRhythm(flat(a), flat(b), x, barTicks);

  return skeleton.flatMap((slot) => {
    const asAt = allAtStart(a, slot.start);
    const bsAt = allAtStart(b, slot.start);
    // An onset that exists in only one pattern has nothing to interpolate
    // towards, so it keeps its own pitches and merely enters or leaves.
    if (asAt.length === 0) return bsAt.length ? bsAt.map((n) => ({ ...n })) : [slot];
    if (bsAt.length === 0) return asAt.map((n) => ({ ...n }));

    const voices = Math.max(asAt.length, bsAt.length);
    const out: NoteEvent[] = [];
    for (let v = 0; v < voices; v++) {
      const na = asAt[v];
      const nb = bsAt[v];
      // Uneven chords are the ordinary case — a pad against a bass line. A
      // voice only one side has crosses on its own, and they go one at a time
      // rather than all at once: spread across the journey by index, so the
      // chord thins and thickens instead of switching size in one step. The
      // same staggering the onsets already use, applied inside the chord.
      if (!na || !nb) {
        const lone = na ?? nb!;
        const extras = Math.abs(asAt.length - bsAt.length);
        const k = v - Math.min(asAt.length, bsAt.length);
        const at = (k + 1) / (extras + 1);
        const keep = na ? x < 1 - at + 1e-9 : x >= at - 1e-9;
        if (keep) out.push({ ...lone });
        continue;
      }

      const da = midiToScaleDegree(na.midi, key, scale, octaveBase);
      const db = midiToScaleDegree(nb.midi, key, scale, octaveBase);
      const degree = Math.round(da * (1 - x) + db * x);
      // WHOSE note this is, for anything riding on it — chiefly the layer that
      // sends each loop to its own instrument. The pitch is interpolated either
      // way; this only decides which side the surviving object came from.
      //
      // It used to be `...na` always, so a bar where the two loops agree on
      // every onset came out entirely attributed to A: with a LAYERS lane,
      // every note played on A's instrument at every position of the fader and
      // the crossfade never handed the SOUND over at all. Measured: at x = 0.5
      // with two loops, 25 of 25 notes claimed layer 0.
      //
      // Ordered by metric weight, which is the rule the whole blend already
      // runs on: weak positions hand over first and the downbeat last, so the
      // instrument crosses in the same order the rhythm does. `x > 0` keeps the
      // A end exactly A's, and `>=` makes the B end exactly B's.
      const owner = x > 0 && x >= metricWeight(slot.start, barTicks) ? nb : na;
      out.push({
        ...owner,
        midi: scaleDegreeToMidi(degree, octaveBase, key, scale),
        velocity: Math.round(na.velocity * (1 - x) + nb.velocity * x),
        duration: Math.max(1, Math.round(na.duration * (1 - x) + nb.duration * x)),
      });
    }
    return out;
  });
}
