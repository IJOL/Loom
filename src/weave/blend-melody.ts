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
    return {
      ...na,
      midi: scaleDegreeToMidi(degree, octaveBase, key, scale),
      velocity: Math.round(na.velocity * (1 - x) + nb.velocity * x),
      duration: Math.max(1, Math.round(na.duration * (1 - x) + nb.duration * x)),
    };
  });
}
