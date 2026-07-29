// src/notefx/chord-processor.ts
import type { NoteFxEvent, NoteFxContext, NoteFxProcessor } from './notefx-types';

export type ChordType = 'maj' | 'min' | 'maj7' | 'min7' | 'sus2' | 'sus4' | 'dim';

export interface ChordProcessorParams {
  chordType: ChordType;
  /** OCT is opt-in. While this is false the octave control is bypassed entirely —
   *  a note-FX must never transpose the played note away behind your back. */
  octaveOn: boolean;
  /** -2..+2 octave shift applied to the whole chord. Only read when `octaveOn`
   *  is true — switching it on is you asking for the transpose. */
  octave: number;
}

export const CHORD_PROCESSOR_DEFAULTS: ChordProcessorParams = {
  chordType: 'maj', octaveOn: false, octave: 0,
};

const CHORD_INTERVALS: Record<ChordType, number[]> = {
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

  process(input: NoteFxEvent[], _ctx: NoteFxContext): NoteFxEvent[] {
    const intervals = CHORD_INTERVALS[this.params.chordType];
    // Bypassed unless explicitly switched on: with the switch OFF the chord is
    // rooted on the note you played, which is the default.
    const shift = this.params.octaveOn ? Math.round(this.params.octave) * 12 : 0;
    const out: NoteFxEvent[] = [];
    for (const e of input) {
      for (const iv of intervals) {
        out.push({ note: e.note + iv + shift, time: e.time, gate: e.gate, accent: e.accent });
      }
    }
    return out;
  }
}
