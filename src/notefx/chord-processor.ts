// src/notefx/chord-processor.ts
import type { NoteFxEvent, NoteFxContext, NoteFxProcessor } from './notefx-types';
import { snapToPitchClasses, scaleIntervals, type ScaleId } from '../core/musicality';

export type ChordType = 'maj' | 'min' | 'maj7' | 'min7' | 'sus2' | 'sus4' | 'dim' | 'free' | 'diatonic';

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
  /** Diatonic mode: how many thirds to stack, 1..5. Only read when chordType
   *  is 'diatonic' — the named voicings already say how many notes they are. */
  notes: number;
  /** Diatonic voicing controls, all read only in 'diatonic' mode. They mirror
   *  Reason's Scales & Chords one for one, except ALTER, which is a toggle
   *  here rather than a momentary button: our note-FX processes scheduled
   *  notes, not a finger held on a pad. */
  inversion: number;      // 0..4 — rotate that many chord tones up an octave
  open: boolean;          // spread: every second tone up an octave
  addOctUp: boolean;      // double the root an octave up
  addOctDown: boolean;    // double the root an octave down
  color: boolean;         // add the tone two thirds above the stack's top (add9/11/13)
  alter: boolean;         // push the top tone a semitone out of the scale
  /** The card's own tonality. 'session' follows the toolbar (what ctx carries);
   *  fxKey may name a root ('0'..'11'), fxScale a named scale or 'custom'. The
   *  session is the default on purpose — two tonalities that CAN disagree
   *  should only disagree because you asked. */
  fxKey: string;
  fxScale: string;
  /** Custom scale, read only when fxScale is 'custom': a 12-bit mask of
   *  intervals RELATIVE TO THE KEY (bit 0 = the root), painted on the card's
   *  mini keyboard. Relative, so changing the key transposes the shape instead
   *  of erasing it. Defaults to major — switching to custom changes nothing
   *  until a key is painted, the same deal the free intervals get. */
  customMask: number;
  /** Snap every note this produces to the session's key and scale.
   *
   *  This is what lets free intervals be safe. In C major, a maj triad on D is
   *  D-F#-A and out of key; conformed it is D-F-A, the chord the key actually
   *  has. Karst does the same thing one layer lower — a pitch_conform inside
   *  every oscillator — which it can afford because its engine knows the scale.
   *  Ours does not: the worklet has no tonality, so this is the layer where the
   *  question can be asked at all.
   *
   *  'filter' is Reason's "Filter Notes: on": the out-of-scale note goes
   *  SILENT instead of being corrected.
   *
   *  Off by default. A note-FX must not move your notes until you ask. */
  conform: 'off' | 'scale' | 'chord' | 'filter';
}

export const CHORD_PROCESSOR_DEFAULTS: ChordProcessorParams = {
  // The free intervals default to a major triad, so switching CHORD to 'free'
  // changes nothing until a knob moves.
  chordType: 'maj', octaveOn: false, octave: 0,
  i1: 4, i2: 7, i3: 0, notes: 3, conform: 'off',
  inversion: 0, open: false, addOctUp: false, addOctDown: false, color: false, alter: false,
  fxKey: 'session', fxScale: 'session',
  customMask: 0b101010110101, // major: {0,2,4,5,7,9,11}
};

/** The named voicings. 'free' is deliberately absent: it has no table, which
 *  is the whole point of it. So is 'diatonic': its intervals come from the
 *  scale, not from a table. */
const CHORD_INTERVALS: Record<Exclude<ChordType, 'free' | 'diatonic'>, number[]> = {
  maj:  [0, 4, 7],
  min:  [0, 3, 7],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  dim:  [0, 3, 6],
};

/** The card's effective tonality: a root plus SORTED intervals (0-11, relative
 *  to it). One shape whether it came from the session, a named override or the
 *  painted mask, so everything downstream asks this and nothing asks which. */
interface Tonality { key: number; intervals: number[] }

function resolveTonality(p: ChordProcessorParams, ctx: NoteFxContext): Tonality | undefined {
  const fxKey = p.fxKey ?? 'session';
  const key = fxKey === 'session' ? ctx.key : Number(fxKey);
  if (key === undefined || Number.isNaN(key)) return undefined;
  const src = p.fxScale ?? 'session';
  if (src === 'custom') {
    const mask = Math.round(p.customMask ?? 0) & 0xfff;
    const ivs: number[] = [];
    for (let pc = 0; pc < 12; pc++) if (mask & (1 << pc)) ivs.push(pc);
    // An empty mask is not a scale; better no tonality than one with no notes.
    return ivs.length === 0 ? undefined : { key, intervals: ivs };
  }
  const scale = src === 'session' ? ctx.scale : (src as ScaleId);
  if (scale === undefined) return undefined;
  return { key, intervals: scaleIntervals(scale) };
}

const pcsOf = (t: Tonality): number[] =>
  t.intervals.map((iv) => (((t.key + iv) % 12) + 12) % 12);

/** Degree index → midi, over the tonality's own intervals (root at degree 0,
 *  octave 0 = midi of the root pitch class below 12). Same walk that
 *  scaleDegreeToMidi does for a ScaleId; this one takes the resolved shape so
 *  a painted mask is a scale like any other. */
function degToMidi(t: Tonality, deg: number): number {
  const n = t.intervals.length;
  const oct = Math.floor(deg / n);
  const idx = ((deg % n) + n) % n;
  return (((t.key % 12) + 12) % 12) + t.intervals[idx] + 12 * oct;
}

/** Midi → degree index, snapping to the tonality first (ties up, same as
 *  snapToScale, so the diatonic root lands where the piano-roll lock would). */
function midiToDeg(t: Tonality, midi: number): number {
  const snapped = snapToPitchClasses(midi, pcsOf(t));
  const k = ((t.key % 12) + 12) % 12;
  const rel = snapped - k;
  const oct = Math.floor(rel / 12);
  const idx = t.intervals.indexOf(rel - 12 * oct);
  return oct * t.intervals.length + idx;
}

/** The pitch classes of the chord stacked on `degree` — every other degree of
 *  the tonality, `size` tones. What chordTonesOf does for a ScaleId. */
function chordPcs(t: Tonality, degree: number, size = 3): number[] {
  const pcs = pcsOf(t);
  const out: number[] = [];
  for (let i = 0; i < size; i++) {
    const idx = (((degree + i * 2) % pcs.length) + pcs.length) % pcs.length;
    if (!out.includes(pcs[idx])) out.push(pcs[idx]);
  }
  return out;
}

export class ChordProcessor implements NoteFxProcessor {
  constructor(private params: ChordProcessorParams) {}

  /** The offsets this voicing adds to the played note, root first. */
  private intervals(): number[] {
    if (this.params.chordType !== 'free' && this.params.chordType !== 'diatonic') {
      return CHORD_INTERVALS[this.params.chordType];
    }
    const { i1, i2, i3 } = this.params;
    // The root always sounds; a zeroed interval is a voice switched off.
    return [0, ...[i1, i2, i3].map((n) => Math.round(n)).filter((n) => n !== 0)];
  }

  /** Diatonic: stack thirds WITHIN the scale from the played note's degree, so
   *  the degree decides the quality — I major, ii minor, vii° diminished,
   *  without a chord table anywhere. Reason's Scales & Chords works this way. */
  private processDiatonic(input: NoteFxEvent[], t: Tonality): NoteFxEvent[] {
    const p = this.params;
    const notes = Math.min(5, Math.max(1, Math.round(p.notes ?? 3)));
    const shift = p.octaveOn ? Math.round(p.octave) * 12 : 0;
    const pcs = pcsOf(t);
    const out: NoteFxEvent[] = [];
    for (const e of input) {
      const deg = midiToDeg(t, e.note);
      const root = degToMidi(t, deg);
      let stack = Array.from({ length: notes }, (_, i) => degToMidi(t, deg + i * 2));
      if (p.alter && stack.length > 0) {
        // One tone, a semitone out of the scale. Up first — the raised top is
        // the classic outside colour (aug on a major, maj7-ish on a minor) —
        // and down when up happens to land back IN the scale.
        const top = stack[stack.length - 1];
        const up = (((top + 1) % 12) + 12) % 12;
        stack[stack.length - 1] = pcs.includes(up) ? top - 1 : top + 1;
      }
      const inv = Math.min(stack.length - 1, Math.max(0, Math.round(p.inversion ?? 0)));
      for (let i = 0; i < inv; i++) stack[i] += 12;
      stack.sort((a, b) => a - b);
      if (p.open) {
        stack = stack.map((n, i) => (i % 2 === 1 ? n + 12 : n)).sort((a, b) => a - b);
      }
      if (p.color) {
        // Two thirds above the TOP of the tertian stack, pre-voicing: the
        // add9 / add11 / add13 that Reason's Add Color reaches per notes count.
        stack.push(degToMidi(t, deg + (notes - 1) * 2 + 4));
      }
      if (p.addOctUp) stack.push(root + 12);
      if (p.addOctDown) stack.push(root - 12);
      stack.sort((a, b) => a - b);
      const seen = new Set<number>();
      for (const n of stack) {
        if (seen.has(n)) continue;
        seen.add(n);
        out.push({ ...e, note: n + shift });
      }
    }
    return out;
  }

  process(input: NoteFxEvent[], ctx: NoteFxContext): NoteFxEvent[] {
    // Tonality resolves ONCE — session, override or painted mask — and no code
    // below asks which it was. Without one, diatonic passes notes through
    // rather than guessing a key: a wrong key is worse than no key.
    const t = resolveTonality(this.params, ctx);
    if (this.params.chordType === 'diatonic') {
      return t === undefined ? input : this.processDiatonic(input, t);
    }
    const intervals = this.intervals();
    const want = this.params.conform ?? 'off';
    // CHORD asked for with no progression falls back to SCALE rather than to
    // nothing: the song may not name a chord, but it still has a key, and a
    // note in the key is nearer what was asked for than a note outside it.
    const mode = t === undefined || want === 'off' ? 'off'
      : want === 'chord' && ctx.chordDegree === undefined ? 'scale' : want;
    const pcs = t === undefined ? [] : pcsOf(t);
    const tones = mode === 'chord' ? chordPcs(t!, Math.round(ctx.chordDegree!)) : [];
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
        // 'filter' silences the out-of-scale note instead of moving it —
        // Reason's "Filter Notes: on" applied to what the chord produces.
        if (mode === 'filter' && !pcs.includes(((raw % 12) + 12) % 12)) continue;
        const note = mode === 'chord' ? snapToPitchClasses(raw, tones)
          : mode === 'scale' ? snapToPitchClasses(raw, pcs)
            : raw;
        if (seen.has(note)) continue;
        seen.add(note);
        out.push({ note, time: e.time, gate: e.gate, accent: e.accent, velocity: e.velocity });
      }
    }
    return out;
  }
}
