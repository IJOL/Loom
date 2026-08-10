// The SOUND fader, landed on the two layer gains. A second axis beside the
// weave: which notes play is one question, what they are played on is another.
import { describe, it, expect } from 'vitest';
import { createWeaveSound } from './weave-sound';
import { defaultWeaveState, type WeaveState } from '../weave/weave-state';
import type { AutomationTarget } from '../automation/automation-targets';

const dest = (id: string): AutomationTarget =>
  ({ id, label: id, laneId: id.split('.')[0], laneName: 'L', min: 0, max: 1 });

/** A LAYERS lane with two filled slots, plus an ordinary lane beside it. */
const CATALOGUE: AutomationTarget[] = [
  dest('lane1.l0.gain'), dest('lane1.l1.gain'),
  dest('lane2.filter.cutoff'),
];

function harness(catalogue = CATALOGUE) {
  const written = new Map<string, number>();
  const sound = createWeaveSound({
    destinations: () => catalogue,
    write: (id, v) => { written.set(id, v); },
  });
  return { written, sound };
}

/** A lane weaving two loops AND carrying a sound fader — the ordinary case,
 *  and the one that shows the two axes are independent. */
function fading(x: number): WeaveState {
  const s = defaultWeaveState();
  s.lanes.lane1 = {
    weave: { kind: 'ab', a: 'clip:a', b: 'clip:b', x: 0.25 },
    locked: false, harmonyLeader: false, sound: x,
  };
  return s;
}

describe('createWeaveSound', () => {
  it('sends the fader to the two layer gains', () => {
    const h = harness();
    h.sound.apply(fading(0));
    expect(h.written.get('lane1.l0.gain')).toBe(1);
    expect(h.written.get('lane1.l1.gain')).toBe(0);
  });

  it('is independent of where the LOOP crossfade sits', () => {
    // The whole point: the notes come from the weave, the sound from here. A
    // lane a quarter of the way between two loops can be played entirely by
    // its second instrument.
    const h = harness();
    h.sound.apply(fading(1));
    expect(h.written.get('lane1.l0.gain')).toBe(0);
    expect(h.written.get('lane1.l1.gain')).toBe(1);
  });

  it('crosses at constant power rather than summing to one', () => {
    const h = harness();
    h.sound.apply(fading(0.5));
    const a = h.written.get('lane1.l0.gain')!;
    const b = h.written.get('lane1.l1.gain')!;
    expect(a * a + b * b).toBeCloseTo(1, 6);
    expect(a).toBeCloseTo(b, 6);
  });

  it('does nothing on a lane that has no layers', () => {
    // A sound fader on an ordinary lane is inert rather than an error or an
    // invented param: the catalogue simply has no such destination.
    const s = defaultWeaveState();
    s.lanes.lane2 = { weave: null, locked: false, harmonyLeader: false, sound: 0.5 };
    const h = harness();
    expect(h.sound.apply(s)).toBe(0);
    expect(h.written.size).toBe(0);
  });

  it('treats ABSENT as "no fader", which is not the same as zero', () => {
    // Absent means the lane routes each note to the layer of the loop it came
    // from — the other way of using a rack. Writing gains for it would fight
    // that routing.
    const s = defaultWeaveState();
    s.lanes.lane1 = {
      weave: { kind: 'ab', a: 'clip:a', b: 'clip:b', x: 0.5 },
      locked: false, harmonyLeader: false,
    };
    const h = harness();
    h.sound.apply(s);
    expect(h.written.size).toBe(0);
  });

  it('puts both layers back to unity when a fader is cleared', () => {
    // The same trailing edge Space needed. A lane whose fader is removed would
    // otherwise keep whatever balance it left, with no control on screen
    // governing it and no way to tell why an instrument had gone quiet.
    const h = harness();
    h.sound.apply(fading(1));
    expect(h.written.get('lane1.l0.gain')).toBe(0);

    h.sound.apply(defaultWeaveState());
    expect(h.written.get('lane1.l0.gain')).toBe(1);
    expect(h.written.get('lane1.l1.gain')).toBe(1);
  });

  it('says it only once', () => {
    const h = harness();
    h.sound.apply(fading(1));
    h.sound.apply(defaultWeaveState());
    h.written.clear();
    h.sound.apply(defaultWeaveState());
    expect(h.written.size).toBe(0);
  });
});
