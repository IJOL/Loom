import { describe, it, expect } from 'vitest';
import { applyEuclidToRow } from './euclid-row';
import { gmDrumRows, noteDrumRows } from './drum-grid-editing';
import { VOICE_MIDI } from '../engines/drum-gm-map';
import { DRUM_LANES, type DrumVoice } from './drums';
import { TICKS_PER_STEP, type NoteEvent } from './notes';

const rows = gmDrumRows();
const rowOf = (v: DrumVoice) => DRUM_LANES.indexOf(v);
const KICK = rowOf('kick'), SNARE = rowOf('snare'), CH = rowOf('closedHat');

const note = (midi: number, step: number, velocity = 90): NoteEvent =>
  ({ midi, start: step * TICKS_PER_STEP, duration: TICKS_PER_STEP, velocity });

/** Steps occupied on one midi, in order — the shape a drummer would read out. */
const stepsOn = (notes: readonly NoteEvent[], midi: number): number[] =>
  notes.filter((n) => n.midi === midi).map((n) => n.start / TICKS_PER_STEP).sort((a, b) => a - b);

describe('applyEuclidToRow', () => {
  it('paints four on the floor onto the kick row', () => {
    const out = applyEuclidToRow([], KICK, { hits: 4, steps: 16 }, 16, rows);
    expect(stepsOn(out, VOICE_MIDI.kick)).toEqual([0, 4, 8, 12]);
  });

  it('leaves every other voice untouched', () => {
    const snare = note(VOICE_MIDI.snare, 4);
    const hat = note(VOICE_MIDI.closedHat, 2);
    const out = applyEuclidToRow([snare, hat], KICK, { hits: 4, steps: 16 }, 16, rows);
    expect(out).toContain(snare);
    expect(out).toContain(hat);
  });

  it('replaces the row\'s own hits instead of stacking onto them', () => {
    const before = [note(VOICE_MIDI.kick, 1), note(VOICE_MIDI.kick, 3), note(VOICE_MIDI.kick, 9)];
    const out = applyEuclidToRow(before, KICK, { hits: 4, steps: 16 }, 16, rows);
    expect(stepsOn(out, VOICE_MIDI.kick)).toEqual([0, 4, 8, 12]);
  });

  // 35 is GM's other bass drum: a different midi that draws on the SAME kick row.
  // Filtering by midi alone would leave it behind as a phantom hit.
  it('clears the row\'s alias notes too, not just its canonical midi', () => {
    const out = applyEuclidToRow([note(35, 7)], KICK, { hits: 4, steps: 16 }, 16, rows);
    expect(out.some((n) => n.midi === 35)).toBe(false);
  });

  it('tiles a cycle that does not divide the clip, so it phases', () => {
    const out = applyEuclidToRow([], CH, { hits: 3, steps: 5 }, 16, rows);
    expect(stepsOn(out, VOICE_MIDI.closedHat)).toEqual([0, 2, 4, 5, 7, 9, 10, 12, 14, 15]);
  });

  it('keeps a cycle longer than the clip inside the clip', () => {
    const out = applyEuclidToRow([], SNARE, { hits: 8, steps: 32 }, 16, rows);
    expect(out.length).toBeGreaterThan(0);
    for (const n of out) expect(n.start).toBeLessThan(16 * TICKS_PER_STEP);
  });

  it('carries the rotation through to the notes', () => {
    const out = applyEuclidToRow([], KICK, { hits: 3, steps: 8, rotation: 1 }, 8, rows);
    expect(stepsOn(out, VOICE_MIDI.kick)).toEqual([2, 5, 7]);
  });

  it('paints at the velocity it is given', () => {
    const out = applyEuclidToRow([], KICK, { hits: 2, steps: 8, velocity: 115 }, 8, rows);
    for (const n of out) expect(n.velocity).toBe(115);
  });

  // A pad row on a sample kit has no DrumVoice — it is addressed by its own note.
  it('addresses a sampler pad row by the row\'s own note', () => {
    const pads = noteDrumRows([60, 61, 62]);
    const out = applyEuclidToRow([], 1, { hits: 2, steps: 4 }, 4, pads);
    expect(stepsOn(out, 61)).toEqual([0, 2]);
  });

  // Zero hits means "this row is not generating", NOT "silence this row" — else
  // touching steps/rotate on an untouched row would wipe hand-drawn hits.
  it('leaves the clip alone when the row asks for no hits', () => {
    const before = [note(VOICE_MIDI.kick, 1), note(VOICE_MIDI.snare, 4)];
    const out = applyEuclidToRow(before, KICK, { hits: 0, steps: 16 }, 16, rows);
    expect(out).toEqual(before);
  });

  it('leaves the clip alone when the cycle has no steps', () => {
    const before = [note(VOICE_MIDI.kick, 1)];
    const out = applyEuclidToRow(before, KICK, { hits: 4, steps: 0 }, 16, rows);
    expect(out).toEqual(before);
  });

  it('survives nonsense input instead of throwing', () => {
    for (const [h, s] of [[NaN, 16], [4, NaN], [-1, 16], [4, -16], [2.5, 8.5]]) {
      expect(() => applyEuclidToRow([], KICK, { hits: h, steps: s }, 16, rows)).not.toThrow();
    }
  });
});
