// src/notefx/chord-processor.ts
import type { NoteFxEvent, NoteFxContext, NoteFxProcessor } from './notefx-types';
import { snapToScale, chordTonesOf, snapToPitchClasses } from '../core/musicality';

export type ChordType = 'maj' | 'min' | 'maj7' | 'min7' | 'sus2' | 'sus4' | 'dim' | 'free';

export interface ChordProcessorParams {
  chordType: ChordType;
  /** OCT is opt-in. While this is false the octave control is bypassed entirely —
   *  a note-FX must never transpose the played note away behind your back. */
  octaveOn: boolean;
  /** -2..+2 octave shift applied to the whole chord. Only read when `octaveOn`
   *  is true — switching it on is you asking for the transpose. */
  octave: number;
  /** Free voicing: three semitone offsets from the played note, read only when
   *  chordType is 'free'. Karst's chord machine is built this way — a base plus
   *  three intervals rather than a chord NAME — and it is the more expressive
   *  shape: a named chord can only ever be one of seven, while three numbers reach
   *  any voicing, including the ones with no name.
   *
   *  0 means "no note", not "unison": a doubled root is never what you wanted,
   *  and being able to dial a two-note voicing is. */
  i1: number; i2: number; i3: number;
  /** Snap every note this produces to the session's key and scale.
   *
   *  This is what lets free intervals be safe. In C major, a maj triad on D is
   *  D-F#-A and out of key; conformed it is D-F-A, the chord the key actually
   *  has. Karst does the same thing one layer lower — a pitch_conform inside
   *  every oscillator — which it can afford because its engine knows the scale.
   *  Ours does not: the worklet has no tonality, so this is the layer where the
   *  question can be asked at all.
   *
   *  Off by default. A note-FX must not move your notes until you ask. */
  conform: 'off' | 'scale' | 'chord';
}

export const CHORD_PROCESSOR_DEFAULTS: ChordProcessorParams = {
  // The free intervals default to a major triad, so switching CHORD to 'free'
  // changes nothing until a knob moves.
  chordType: 'maj', octaveOn: false, octave: 0,
  i1: 4, i2: 7, i3: 0, conform: 'off',
};

/** The named voicings. 'free' is deliberately absent: it has no table, which
 *  is the whole point of it. */
const CHORD_INTERVALS: Record<Exclude<ChordType, 'free'>, number[]> = {
  maj:  [0, 4, 7],
  min:  [0, 3, 7],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  dim:  [0, 3, 6],
};

export class ChordProcessor implements NoteFxProcessor {
  constructor(private params: ChordProcessorParams) {}

  /** The offsets this voicing adds to the played note, root first. */
  private intervals(): number[] {
    if (this.params.chordType !== 'free') return CHORD_INTERVALS[this.params.chordType];
    const { i1, i2, i3 } = this.params;
    // The root always sounds; a zeroed interval is a voice switched off.
    return [0, ...[i1, i2, i3].map((n) => Math.round(n)).filter((n) => n !== 0)];
  }

  process(input: NoteFxEvent[], ctx: NoteFxContext): NoteFxEvent[] {
    const intervals = this.intervals();
    // Conforming needs something to conform TO. Without a tonality this stays
    // off rather than guessing a key — a wrong key is worse than no key.
    const tonal = ctx.key !== undefined && ctx.scale !== undefined;
    const want = this.params.conform ?? 'off';
    // CHORD asked for with no progression falls back to SCALE rather than to
    // nothing: the song may not name a chord, but it still has a key, and a
    // note in the key is nearer what was asked for than a note outside it.
    const mode = !tonal || want === 'off' ? 'off'
      : want === 'chord' && ctx.chordDegree === undefined ? 'scale' : want;
    const tones = mode === 'chord'
      ? chordTonesOf(ctx.key!, ctx.scale!, Math.round(ctx.chordDegree!))
      : [];
    // Bypassed unless explicitly switched on: with the switch OFF the chord is
    // rooted on the note you played, which is the default.
    const shift = this.params.octaveOn ? Math.round(this.params.octave) * 12 : 0;
    const out: NoteFxEvent[] = [];
    for (const e of input) {
      // Two intervals can land on the same degree once conformed (a 4 and a 5
      // both snap to the same note in some scales), and a doubled note is a
      // wasted voice that only makes the chord louder.
      const seen = new Set<number>();
      for (const iv of intervals) {
        const raw = e.note + iv + shift;
        const note = mode === 'chord' ? snapToPitchClasses(raw, tones)
          : mode === 'scale' ? snapToScale(raw, ctx.key!, ctx.scale!)
            : raw;
        if (seen.has(note)) continue;
        seen.add(note);
        out.push({ note, time: e.time, gate: e.gate, accent: e.accent, velocity: e.velocity });
      }
    }
    return out;
  }
}
