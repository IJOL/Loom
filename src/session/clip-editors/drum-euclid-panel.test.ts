// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { mountDrumEuclidPanel } from './drum-euclid-panel';
import { gmDrumRows, noteDrumRows } from '../../core/drum-grid-editing';
import { VOICE_MIDI } from '../../engines/drum-gm-map';
import { DRUM_LANES } from '../../core/drums';
import { DEFAULT_VELOCITY } from '../../core/velocity-gain';
import { TICKS_PER_STEP, type NoteEvent } from '../../core/notes';

const KICK = DRUM_LANES.indexOf('kick');

const note = (midi: number, step: number): NoteEvent =>
  ({ midi, start: step * TICKS_PER_STEP, duration: TICKS_PER_STEP, velocity: 90 });

const stepsOn = (notes: readonly NoteEvent[], midi: number): number[] =>
  notes.filter((n) => n.midi === midi).map((n) => n.start / TICKS_PER_STEP).sort((a, b) => a - b);

function setup(opts: { notes?: NoteEvent[]; totalSteps?: number; defaultSteps?: number } = {}) {
  const host = document.createElement('div');
  let notes: NoteEvent[] = opts.notes ?? [];
  let redraws = 0;
  const handle = mountDrumEuclidPanel(host, {
    rows: gmDrumRows(),
    labels: DRUM_LANES.map((v) => v.toUpperCase()),
    totalSteps: opts.totalSteps ?? 16,
    defaultSteps: opts.defaultSteps ?? 16,
    getNotes: () => notes,
    setNotes: (n) => { notes = n; },
    onChange: () => { redraws++; },
  });
  return { host, handle, notes: () => notes, redraws: () => redraws };
}

function fields(host: HTMLElement, row: number) {
  const el = host.querySelectorAll('.drum-euclid-row')[row];
  const [hits, steps, rot] = [...el.querySelectorAll('input')];
  return { hits, steps, rot };
}

/** What the browser fires when a number field is committed (Enter, blur, spinner,
 *  arrow key) — the event AutoHistory hangs its undo checkpoint on. */
const type = (input: HTMLInputElement, v: string | number): void => {
  input.value = String(v);
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

describe('the drum grid\'s per-voice Euclidean fields', () => {
  it('gives every voice row its own hits / steps / rotate fields', () => {
    const { host } = setup();
    const rows = host.querySelectorAll('.drum-euclid-row');
    expect(rows.length).toBe(DRUM_LANES.length);
    for (const r of rows) expect(r.querySelectorAll('input').length).toBe(3);
  });

  it('starts the steps field at one bar, so typing 4 hits reads as four on the floor', () => {
    const { host } = setup();
    expect(fields(host, KICK).steps.value).toBe('16');
  });

  it('paints four on the floor when you type 4 hits on the kick', () => {
    const s = setup();
    type(fields(s.host, KICK).hits, 4);
    expect(stepsOn(s.notes(), VOICE_MIDI.kick)).toEqual([0, 4, 8, 12]);
  });

  it('leaves the other voices\' notes untouched', () => {
    const snare = note(VOICE_MIDI.snare, 4);
    const s = setup({ notes: [snare] });
    type(fields(s.host, KICK).hits, 4);
    expect(s.notes()).toContain(snare);
  });

  it('re-paints the row when the rotation changes', () => {
    const s = setup();
    type(fields(s.host, KICK).hits, 4);
    type(fields(s.host, KICK).rot, 1);
    expect(stepsOn(s.notes(), VOICE_MIDI.kick)).toEqual([3, 7, 11, 15]);
  });

  it('fills a two-bar clip by tiling the one-bar cycle', () => {
    const s = setup({ totalSteps: 32, defaultSteps: 16 });
    type(fields(s.host, KICK).hits, 4);
    expect(stepsOn(s.notes(), VOICE_MIDI.kick)).toEqual([0, 4, 8, 12, 16, 20, 24, 28]);
  });

  it('keeps a row\'s drawn notes until that row is asked for hits', () => {
    const drawn = note(VOICE_MIDI.kick, 1);
    const s = setup({ notes: [drawn] });
    type(fields(s.host, KICK).steps, 8);
    type(fields(s.host, KICK).rot, 2);
    expect(s.notes()).toEqual([drawn]);
  });

  it('paints at the same velocity as a hit drawn by hand', () => {
    const s = setup();
    type(fields(s.host, KICK).hits, 4);
    for (const n of s.notes()) expect(n.velocity).toBe(DEFAULT_VELOCITY);
  });

  it('paints while the change event is still dispatching, where undo hooks', () => {
    // AutoHistory checkpoints in a microtask off this same `change` event. A
    // debounced paint (mpump uses a 50ms timer) would land after that checkpoint
    // and lose its undo step, so the paint must be synchronous.
    vi.useFakeTimers();
    const s = setup();
    type(fields(s.host, KICK).hits, 4);
    expect(s.notes().length).toBe(4);
    vi.useRealTimers();
  });

  it('redraws the grid after painting', () => {
    const s = setup();
    type(fields(s.host, KICK).hits, 4);
    expect(s.redraws()).toBeGreaterThan(0);
  });

  it('rebuilds its rows when the kit view swaps', () => {
    const s = setup();
    s.handle.setModel(noteDrumRows([60, 61]), ['HI', 'LO']);
    expect(s.host.querySelectorAll('.drum-euclid-row').length).toBe(2);
  });

  it('paints a swapped-in pad row on that pad\'s own note', () => {
    const s = setup();
    s.handle.setModel(noteDrumRows([60, 61]), ['HI', 'LO']);
    type(fields(s.host, 1).hits, 2);
    expect(stepsOn(s.notes(), 61)).toEqual([0, 8]);
  });
});
