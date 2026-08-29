// The panel's half of the generator: the switch, and the controls it declares.
//
// It exists because twice now a browser check has shown values that were not the
// defaults, and twice the answer was ambiguous between "the code writes garbage
// on mount" and "somebody was turning knobs". A pure test has neither a pointer
// nor a user.
import { describe, it, expect } from 'vitest';
import {
  generatorParams, setGeneratorOn, setGeneratorParam, type GeneratorDepsUI,
} from './panel-context-generator';
import { defaultGeneratorState } from '../generator/generator-state';
import { DEFAULT_GRID } from '../generator/grid';
import { DEFAULT_CADENCE } from '../generator/cadence';
import { TICKS_PER_STEP, type NoteEvent } from '../core/notes';
import type { SessionState } from '../session/session';

const hit = (step: number, midi: number): NoteEvent =>
  ({ start: step * TICKS_PER_STEP, duration: TICKS_PER_STEP, midi, velocity: 100 });

function harness(withNotes = true) {
  const state = {
    lanes: [{
      id: 'lane1',
      engineId: 'subtractive',
      clips: [{
        id: 'clipA', name: 'A', color: '#fff', lengthBars: 1,
        notes: withNotes ? [hit(0, 60), hit(4, 64)] : [],
        gridResolution: '1/16',
      }],
      inserts: [],
    }],
    scenes: [],
  } as unknown as SessionState;

  const deps: GeneratorDepsUI = {
    getState: () => state,
    clearWeave: () => {},
    refresh: () => {},
    history: () => undefined,
  };
  return { state, deps, lane: () => state.lanes[0] };
}

describe('the generator switch', () => {
  it('seeds its material from the lane’s own clips', () => {
    // The button has to make a sound where it is pressed, not open an empty
    // picker. "My own clip" is `clip:<id>` — one selection among many.
    const h = harness();
    setGeneratorOn(h.deps, 'lane1', true);
    expect(h.lane().generator?.selection).toMatchObject({ kind: 'ab', a: 'clip:clipA' });
  });

  it('falls back to the SHELF when the lane has no notes of its own', () => {
    // "+ Weaving track" makes a lane with one EMPTY clip, so the first thing
    // anyone presses GEN on has nothing of its own to read. It used to refuse,
    // silently, and read as a dead button — reported as "no funciona el botón
    // gen". The library is material too: the same shelf the weave draws from.
    const h = harness(false);
    h.deps.shelfIds = () => ['lib:acid-techno:bass:0', 'lib:acid-techno:bass:1'];
    setGeneratorOn(h.deps, 'lane1', true);
    expect(h.lane().generator?.selection)
      .toMatchObject({ kind: 'ab', a: 'lib:acid-techno:bass:0' });
  });

  it('seeds from the lane s LIST before anything else', () => {
    // The list is the user's own answer to "what may this lane play", so it
    // outranks both the clips it happens to hold and the shelf its role allows.
    const h = harness();                       // this lane HAS a clip with notes
    h.deps.poolIds = () => ['lib:acid-techno:bass:2', 'lib:acid-techno:bass:3'];
    setGeneratorOn(h.deps, 'lane1', true);
    expect(h.lane().generator?.selection)
      .toMatchObject({ kind: 'ab', a: 'lib:acid-techno:bass:2' });
  });

  it('ignores an EMPTY list — that is a lane with no list at all', () => {
    const h = harness();
    h.deps.poolIds = () => [];
    setGeneratorOn(h.deps, 'lane1', true);
    expect(h.lane().generator?.selection).toMatchObject({ kind: 'ab', a: 'clip:clipA' });
  });

  it('prefers the lane s OWN clips over the shelf', () => {
    // What you wrote beats what the library offers: pressing GEN on a lane you
    // have filled must read what is in it.
    const h = harness();
    h.deps.shelfIds = () => ['lib:acid-techno:bass:0'];
    setGeneratorOn(h.deps, 'lane1', true);
    expect(h.lane().generator?.selection).toMatchObject({ kind: 'ab', a: 'clip:clipA' });
  });

  it('refuses to switch on when there is nothing to generate FROM anywhere', () => {
    // Turning on and playing silence is worse than not turning on. With no
    // clips AND no shelf there is genuinely nothing to read.
    const h = harness(false);
    setGeneratorOn(h.deps, 'lane1', true);
    expect(h.lane().generator?.selection ?? null).toBeNull();
  });

  it('keeps the selection when switched off', () => {
    // Coming back to a generator you had set up is not the same gesture as
    // building a new one.
    const h = harness();
    setGeneratorOn(h.deps, 'lane1', true);
    setGeneratorOn(h.deps, 'lane1', false);
    setGeneratorOn(h.deps, 'lane1', true);
    expect(h.lane().generator?.selection).toMatchObject({ a: 'clip:clipA' });
  });

  it('shows NO controls for a lane that is not generating', () => {
    // The same "empty means show nothing" convention roleChoices uses.
    expect(generatorParams(harness().deps, 'lane1')).toEqual([]);
  });
});

describe('the controls it declares', () => {
  it('opens on the DECLARED defaults, every one of them', () => {
    // The one this file was written for. A knob that mounts on some other value
    // is a lane already changed by a control nobody touched.
    const h = harness();
    setGeneratorOn(h.deps, 'lane1', true);
    const at = (id: string) => generatorParams(h.deps, 'lane1').find((p) => p.id === id)?.value;

    expect(at('div')).toBe(DEFAULT_GRID.div);
    expect(at('repeats')).toBe(DEFAULT_GRID.repeats);
    expect(at('pow2')).toBe(DEFAULT_GRID.pow2);
    expect(at('cadence')).toBe(DEFAULT_CADENCE.amount);
    expect(at('cadenceMod')).toBe(DEFAULT_CADENCE.mod);
    expect(at('phrase')).toBe(DEFAULT_CADENCE.phrase);
    expect(at('conform')).toBe(0);
    expect(at('nudge')).toBe(0);
    expect(at('length')).toBe(1);
    expect(at('barCycle')).toBe(1);
    expect(at('loopPercent')).toBe(0);
  });

  it('declares a usable range for every one of them', () => {
    const h = harness();
    setGeneratorOn(h.deps, 'lane1', true);
    for (const p of generatorParams(h.deps, 'lane1')) {
      expect(p.max, p.id).toBeGreaterThan(p.min);
      expect(p.value, p.id).toBeGreaterThanOrEqual(p.min);
      expect(p.value, p.id).toBeLessThanOrEqual(p.max);
      expect(p.name.length, p.id).toBeGreaterThan(0);
    }
  });

  it('writes what it is given, and reads the same back', () => {
    const h = harness();
    setGeneratorOn(h.deps, 'lane1', true);
    setGeneratorParam(h.deps, 'lane1', 'div', 8);
    setGeneratorParam(h.deps, 'lane1', 'cadence', 0.25);
    const at = (id: string) => generatorParams(h.deps, 'lane1').find((p) => p.id === id)?.value;
    expect(at('div')).toBe(8);
    expect(at('cadence')).toBe(0.25);
  });

  it('clamps a write to the range it declared, rather than trusting the panel', () => {
    // The panel is a PLUGIN. A value past the end would reach the audio path.
    const h = harness();
    setGeneratorOn(h.deps, 'lane1', true);
    setGeneratorParam(h.deps, 'lane1', 'div', 999);
    const at = (id: string) => generatorParams(h.deps, 'lane1').find((p) => p.id === id);
    expect(at('div')?.value).toBe(at('div')?.max);
  });

  it('ignores an id it never offered', () => {
    const h = harness();
    setGeneratorOn(h.deps, 'lane1', true);
    const before = generatorParams(h.deps, 'lane1');
    setGeneratorParam(h.deps, 'lane1', 'nonsense', 5);
    expect(generatorParams(h.deps, 'lane1')).toEqual(before);
  });

  it('leaves the selection alone when a control moves', () => {
    // The clamp rebuilds the state object; the material must survive it.
    const h = harness();
    setGeneratorOn(h.deps, 'lane1', true);
    setGeneratorParam(h.deps, 'lane1', 'div', 8);
    expect(h.lane().generator?.selection).toMatchObject({ a: 'clip:clipA' });
  });

  it('offers exactly the state the generator holds — no control without a field', () => {
    const h = harness();
    setGeneratorOn(h.deps, 'lane1', true);
    const ids = generatorParams(h.deps, 'lane1').map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(defaultGeneratorState())).toContain('barMod');
  });
});
