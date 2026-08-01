// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountDrumEuclidPanel } from './drum-euclid-panel';
import { setDrumEuclidOpen, setDrumEuclidFit } from '../../core/clip-drum-euclid';
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

interface SetupOpts {
  notes?: NoteEvent[];
  lengthBars?: number;
  stepsPerBar?: number;
  /** Omit the resize hook — a host that won't let the clip be resized. */
  noResize?: boolean;
  fit?: boolean;
  /** The fields ship CLOSED; every test about the fields themselves opens them.
   *  'inherit' mounts without touching the flag — how a second editor opens. */
  open?: boolean | 'inherit';
}

function setup(opts: SetupOpts = {}) {
  const host = document.createElement('div');
  let notes: NoteEvent[] = opts.notes ?? [];
  let bars = opts.lengthBars ?? 1;
  let redraws = 0;
  let relayouts = 0;
  if (opts.open !== 'inherit') setDrumEuclidOpen(opts.open ?? true);
  if (opts.fit !== undefined) setDrumEuclidFit(opts.fit);
  const handle = mountDrumEuclidPanel(host, {
    rows: gmDrumRows(),
    labels: DRUM_LANES.map((v) => v.toUpperCase()),
    stepsPerBar: opts.stepsPerBar ?? 16,
    getLengthBars: () => bars,
    setLengthBars: opts.noResize ? undefined : (b) => { bars = b; },
    getNotes: () => notes,
    setNotes: (n) => { notes = n; },
    onChange: () => { redraws++; },
    onToggleOpen: () => { relayouts++; },
  });
  return {
    host, handle,
    notes: () => notes, bars: () => bars,
    redraws: () => redraws, relayouts: () => relayouts,
  };
}

const rail = (host: HTMLElement) => host.querySelector('.drum-euclid-rail') as HTMLButtonElement;
const rowCount = (host: HTMLElement) => host.querySelectorAll('.drum-euclid-row').length;

const fitBox = (host: HTMLElement) =>
  host.querySelector('.drum-euclid-fit input') as HTMLInputElement;

beforeEach(() => { setDrumEuclidOpen(false); setDrumEuclidFit(false); });

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

describe('the Euclidean fields\' vertical rail', () => {
  it('starts folded — the rail is there, the fields are not', () => {
    const s = setup({ open: false });
    expect(rail(s.host)).toBeTruthy();
    expect(rowCount(s.host)).toBe(0);
  });

  it('unfolds the fields when the rail is clicked', () => {
    const s = setup({ open: false });
    rail(s.host).click();
    expect(rowCount(s.host)).toBe(DRUM_LANES.length);
  });

  it('folds them away again on a second click', () => {
    const s = setup({ open: false });
    rail(s.host).click();
    rail(s.host).click();
    expect(rowCount(s.host)).toBe(0);
  });

  it('says whether it is open, for the screen reader and the pointer', () => {
    const s = setup({ open: false });
    expect(rail(s.host).getAttribute('aria-expanded')).toBe('false');
    rail(s.host).click();
    expect(rail(s.host).getAttribute('aria-expanded')).toBe('true');
  });

  it('asks the grid to re-lay out — the fields column changes the viewport width', () => {
    const s = setup({ open: false });
    rail(s.host).click();
    expect(s.relayouts()).toBe(1);
  });

  it('opens the next clip\'s editor the way you left this one', () => {
    const s = setup({ open: false });
    rail(s.host).click();
    const next = setup({ open: 'inherit' });   // a fresh editor, flag untouched
    expect(rowCount(next.host)).toBe(DRUM_LANES.length);
  });

  it('keeps the rail visible while the fields are open', () => {
    const s = setup();
    expect(rail(s.host)).toBeTruthy();
  });
});

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
    const s = setup({ lengthBars: 2, stepsPerBar: 16 });
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

const SNARE = DRUM_LANES.indexOf('snare');

describe('"Fit clip" — growing the clip until the cycle joins end to start', () => {
  it('grows a one-bar clip to five for a five-step cycle', () => {
    const s = setup({ fit: true });
    type(fields(s.host, KICK).steps, 5);
    type(fields(s.host, KICK).hits, 2);
    expect(s.bars()).toBe(5);
  });

  it('fills the length it just grew to', () => {
    const s = setup({ fit: true });
    type(fields(s.host, KICK).steps, 5);
    type(fields(s.host, KICK).hits, 2);
    // 5 bars = 80 steps, a 5-step cycle tiling 16 times, 2 hits each.
    expect(stepsOn(s.notes(), VOICE_MIDI.kick).length).toBe(32);
    expect(Math.max(...stepsOn(s.notes(), VOICE_MIDI.kick))).toBeGreaterThan(64);
  });

  it('re-tiles the voices that were already generating over the new length', () => {
    const s = setup({ fit: true });
    type(fields(s.host, SNARE).hits, 4);              // 4 on the floor, one bar
    expect(stepsOn(s.notes(), VOICE_MIDI.snare).length).toBe(4);
    type(fields(s.host, KICK).steps, 5);
    type(fields(s.host, KICK).hits, 2);               // clip grows to 5 bars
    expect(stepsOn(s.notes(), VOICE_MIDI.snare).length).toBe(20);
  });

  it('repeats what was already drawn across the length it grew to', () => {
    // A hand-drawn hat on step 4 of a one-bar clip: growing to 5 bars has to
    // carry it into the four new bars or the clip stops looping.
    const s = setup({ fit: true, notes: [note(VOICE_MIDI.closedHat, 4)] });
    type(fields(s.host, KICK).steps, 5);
    type(fields(s.host, KICK).hits, 2);
    expect(s.bars()).toBe(5);
    expect(stepsOn(s.notes(), VOICE_MIDI.closedHat)).toEqual([4, 20, 36, 52, 68]);
  });

  it('drops the copies again when it shrinks back', () => {
    const s = setup({ fit: true, notes: [note(VOICE_MIDI.closedHat, 4)] });
    type(fields(s.host, KICK).steps, 5);
    type(fields(s.host, KICK).hits, 2);
    type(fields(s.host, KICK).hits, 0);
    expect(s.bars()).toBe(1);
    expect(stepsOn(s.notes(), VOICE_MIDI.closedHat)).toEqual([4]);
  });

  it('leaves a clip alone when every cycle already fits the bar', () => {
    const s = setup({ fit: true, lengthBars: 2 });
    type(fields(s.host, KICK).hits, 4);
    expect(s.bars()).toBe(2);
  });

  it('shrinks back to the length the clip had once the fields are cleared', () => {
    const s = setup({ fit: true });
    type(fields(s.host, KICK).steps, 5);
    type(fields(s.host, KICK).hits, 2);
    expect(s.bars()).toBe(5);
    type(fields(s.host, KICK).hits, 0);
    expect(s.bars()).toBe(1);
  });

  it('never shrinks below the length the clip already had', () => {
    const s = setup({ fit: true, lengthBars: 4 });
    type(fields(s.host, KICK).hits, 4);
    expect(s.bars()).toBe(4);
  });

  it('does not touch the clip while the check is off', () => {
    const s = setup({ fit: false });
    type(fields(s.host, KICK).steps, 5);
    type(fields(s.host, KICK).hits, 2);
    expect(s.bars()).toBe(1);
  });

  it('fits what is already in the fields the moment you tick it', () => {
    const s = setup({ fit: false });
    type(fields(s.host, KICK).steps, 5);
    type(fields(s.host, KICK).hits, 2);
    expect(s.bars()).toBe(1);
    fitBox(s.host).checked = true;
    fitBox(s.host).dispatchEvent(new Event('change', { bubbles: true }));
    expect(s.bars()).toBe(5);
  });

  it('offers no check when the host cannot resize the clip', () => {
    const s = setup({ noResize: true });
    expect(fitBox(s.host)).toBeNull();
  });

  it('redraws the grid when only the length moved', () => {
    const s = setup({ fit: false });
    type(fields(s.host, KICK).steps, 5);
    type(fields(s.host, KICK).hits, 2);
    const before = s.redraws();
    fitBox(s.host).checked = true;
    fitBox(s.host).dispatchEvent(new Event('change', { bubbles: true }));
    expect(s.redraws()).toBeGreaterThan(before);
  });
});
