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

const atStart = (ns: NoteEvent[], start: number) => ns.find((n) => n.start === start);

export function blendMelody(
  a: NoteEvent[], b: NoteEvent[], x: number, barTicks: number,
  key: number, scale: ScaleId, octaveBase: number,
): NoteEvent[] {
  // Pair by ONSET alone. blendRhythm identifies a hit by (start, midi) because
  // in percussion the pitch picks the drum; two melodies rarely agree on a
  // pitch, so the same rule here would leave every note unpaired and nothing
  // would ever interpolate. Flattening the pitch to a constant before handing
  // the patterns over is what reduces the key to the onset.
  const flat = (ns: NoteEvent[]) => ns.map((n) => ({ ...n, midi: 0 }));
  const skeleton = blendRhythm(flat(a), flat(b), x, barTicks);

  return skeleton.map((slot) => {
    const na = atStart(a, slot.start);
    const nb = atStart(b, slot.start);
    // An onset that exists in only one pattern has nothing to interpolate
    // towards, so it keeps its own pitch and merely enters or leaves.
    if (!na) return nb ? { ...nb } : slot;
    if (!nb) return { ...na };

    const da = midiToScaleDegree(na.midi, key, scale, octaveBase);
    const db = midiToScaleDegree(nb.midi, key, scale, octaveBase);
    const degree = Math.round(da * (1 - x) + db * x);
    // WHOSE note this is, for anything riding on it — chiefly the layer that
    // sends each loop to its own instrument. The pitch is interpolated either
    // way; this only decides which side the surviving object came from.
    //
    // It used to be `...na` always, so a bar where the two loops agree on every
    // onset came out entirely attributed to A: with a LAYERS lane, every note
    // played on A's instrument at every position of the fader and the crossfade
    // never handed the SOUND over at all. Measured: at x = 0.5 with two loops,
    // 25 of 25 notes claimed layer 0.
    //
    // Ordered by metric weight, which is the rule the whole blend already runs
    // on: weak positions hand over first and the downbeat last, so the
    // instrument crosses in the same order the rhythm does. `x > 0` keeps the A
    // end exactly A's, and `>=` makes the B end exactly B's.
    const owner = x > 0 && x >= metricWeight(slot.start, barTicks) ? nb : na;
    return {
      ...owner,
      midi: scaleDegreeToMidi(degree, octaveBase, key, scale),
      velocity: Math.round(na.velocity * (1 - x) + nb.velocity * x),
      duration: Math.max(1, Math.round(na.duration * (1 - x) + nb.duration * x)),
    };
  });
}
