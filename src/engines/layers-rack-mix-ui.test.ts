/** @vitest-environment jsdom */
// The MIX control on the rack: does the gesture reach the gains, and does it
// only ever reach the slots that hold an instrument?
//
// The browser cannot answer either. A fader moves whether or not its write
// lands — which is the same blind spot that let the preset dropdown look right
// while the sound never changed — and an empty slot written to is silent by
// definition, so nothing on screen would say it happened.
import { describe, it, expect, beforeEach } from 'vitest';
import './layers-engine';
import '../plugins/modulators/lfo';
import '../plugins/modulators/adsr';
import { LAYERS_ENGINE_ID } from './layers-engine';
import { buildLayersRack, wireLayersRack } from './layers-rack-ui';
import { __resetPresetCache } from '../presets/preset-loader';
import { getEngine, registerEngine } from './registry';
import { createDescriptorEngine } from './descriptor-engine';
import { ModulationHostImpl } from '../modulation/modulation-host';
import type { LayerSpec } from '../audio-dsp/layers/layer-spec';
import type { SessionLane, SessionState } from '../session/session';
import type { EngineUIContext, SynthEngine } from './engine-types';

const SLOT_ENGINE = 'subtractive';

if (!getEngine(SLOT_ENGINE)) {
  registerEngine(createDescriptorEngine({
    id: SLOT_ENGINE, name: 'Subtractive', polyphony: 'poly',
    params: [{ id: 'filter.cutoff', label: 'Cutoff', kind: 'continuous', min: 0, max: 20000, default: 800 }],
    presets: () => [],
  }));
}

const slot = (engineId: string, gain = 1): LayerSpec => ({ engineId, lo: 0, hi: 127, gain });

/** A rack of four slots, `filled` of them holding an instrument. */
function harness(rack: LayerSpec[], base: Record<string, number> = {}) {
  const written: [string, number][] = [];
  const engine = {
    id: LAYERS_ENGINE_ID,
    setBaseValue: (id: string, v: number) => { written.push([id, v]); },
    getBaseValue: (id: string) => base[id] ?? 0,
    modulators: new ModulationHostImpl([]),
  } as unknown as SynthEngine;

  const lane = {
    id: 'lane1', engineId: LAYERS_ENGINE_ID, clips: [], inserts: [],
    engineState: { params: {}, layers: rack },
  } as unknown as SessionLane;
  const state = { lanes: [lane], masterInserts: [], sends: [] } as unknown as SessionState;

  let repaints = 0;
  wireLayersRack({
    setRack: (laneId, layers) => {
      const t = state.lanes.find((x) => x.id === laneId);
      if (t) t.engineState = { ...t.engineState, layers };
    },
    repaint: () => { repaints += 1; },
  });

  const host = document.createElement('div');
  const ctx = { laneId: lane.id, sessionState: state } as unknown as EngineUIContext;
  buildLayersRack(host, ctx, engine);
  return { host, ctx, engine, lane, written, repaints: () => repaints };
}

const fader = (host: HTMLElement) => host.querySelector('.layers-mix-fader') as HTMLInputElement | null;
const pad = (host: HTMLElement) => host.querySelector('.layers-mix-pad') as HTMLElement | null;

/** Move the fader the way a hand does: set it, then say so. */
function drag(host: HTMLElement, to: number): void {
  const f = fader(host);
  if (!f) throw new Error('no fader on this rack');
  f.value = String(to);
  f.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => { __resetPresetCache(); });

describe('which control the rack offers', () => {
  it('offers none for a rack holding one instrument — there is nothing to balance it against', () => {
    const { host } = harness([slot(SLOT_ENGINE), slot(''), slot(''), slot('')]);
    expect(fader(host)).toBeNull();
    expect(pad(host)).toBeNull();
  });

  it('offers a fader for two', () => {
    const { host } = harness([slot(SLOT_ENGINE), slot(SLOT_ENGINE), slot(''), slot('')]);
    expect(fader(host)).not.toBeNull();
    expect(pad(host)).toBeNull();
  });

  it('offers a fader for three', () => {
    const { host } = harness([slot(SLOT_ENGINE), slot(SLOT_ENGINE), slot(SLOT_ENGINE), slot('')]);
    expect(fader(host)).not.toBeNull();
    expect(pad(host)).toBeNull();
  });

  it('offers a square once all four are loaded', () => {
    const { host } = harness([0, 1, 2, 3].map(() => slot(SLOT_ENGINE)));
    expect(pad(host)).not.toBeNull();
    expect(fader(host)).toBeNull();
  });
});

describe('what the fader writes', () => {
  it('hands the far end its whole sound and silences the near one', () => {
    const h = harness([slot(SLOT_ENGINE), slot(''), slot(SLOT_ENGINE), slot('')]);
    drag(h.host, 1);
    expect(Object.fromEntries(h.written)).toEqual({ 'l0.gain': 0, 'l2.gain': 1 });
  });

  it('never writes a slot that holds nothing', () => {
    const h = harness([slot(SLOT_ENGINE), slot(''), slot(SLOT_ENGINE), slot('')]);
    drag(h.host, 0.5);
    expect(h.written.map(([id]) => id)).toEqual(['l0.gain', 'l2.gain']);
  });

  it('mirrors the write into the lane, so the balance survives a reload', () => {
    const h = harness([slot(SLOT_ENGINE), slot(SLOT_ENGINE), slot(''), slot('')]);
    drag(h.host, 1);
    expect(h.lane.engineState?.params?.['l1.gain']).toBe(1);
  });

  it('does not repaint mid-drag — a repaint rebuilds the editor under the pointer', () => {
    const h = harness([slot(SLOT_ENGINE), slot(SLOT_ENGINE), slot(''), slot('')]);
    drag(h.host, 0.4);
    expect(h.repaints()).toBe(0);
  });

  it('repaints when the hand lets go, so the slot\u2019s own Gain knob catches up', () => {
    const h = harness([slot(SLOT_ENGINE), slot(SLOT_ENGINE), slot(''), slot('')]);
    drag(h.host, 0.4);
    fader(h.host)!.dispatchEvent(new Event('change', { bubbles: true }));
    expect(h.repaints()).toBe(1);
  });
});

describe('where the fader comes up', () => {
  it('reads its position off the gains rather than a second copy of the balance', () => {
    const { host } = harness(
      [slot(SLOT_ENGINE), slot(''), slot(SLOT_ENGINE), slot('')],
      { 'l0.gain': 0, 'l2.gain': 1 },
    );
    expect(Number(fader(host)!.value)).toBeCloseTo(1, 6);
  });

  it('comes up at the near end on a freshly converted rack, where slot 2 is silent', () => {
    const { host } = harness(
      [slot(SLOT_ENGINE), slot(SLOT_ENGINE), slot(''), slot('')],
      { 'l0.gain': 1, 'l1.gain': 0 },
    );
    expect(Number(fader(host)!.value)).toBeCloseTo(0, 6);
  });
});

/** Draw on the square the way a hand does. jsdom measures every element as a
 *  zero-sized box, so the surface is given a real one — the arithmetic under
 *  test is entirely about where in that box the pointer landed. */
function draw(host: HTMLElement, fx: number, fy: number): void {
  const surface = pad(host);
  if (!surface) throw new Error('no square on this rack');
  surface.getBoundingClientRect = () => ({
    left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0,
    toJSON: () => ({}),
  }) as DOMRect;
  const at = (type: string) => new MouseEvent(type, {
    bubbles: true, clientX: fx * 100, clientY: fy * 100,
  });
  surface.dispatchEvent(at('pointerdown'));
  surface.dispatchEvent(at('pointermove'));
  surface.dispatchEvent(at('pointerup'));
}

describe('the square', () => {
  it('names each loaded slot at its corner, in the cloud\u2019s order', () => {
    const { host } = harness([0, 1, 2, 3].map(() => slot(SLOT_ENGINE)));
    const corners = [...pad(host)!.querySelectorAll('.layers-mix-corner')].map((c) => c.textContent);
    expect(corners).toEqual(['1', '2', '3', '4']);
  });

  it('hands the bottom-right corner to slot 4 and silences the other three', () => {
    const h = harness([0, 1, 2, 3].map(() => slot(SLOT_ENGINE)));
    draw(h.host, 1, 1);
    expect(Object.fromEntries(h.written))
      .toEqual({ 'l0.gain': 0, 'l1.gain': 0, 'l2.gain': 0, 'l3.gain': 1 });
  });

  it('reads DOWN the square as down the rack, so the bottom row is slots 3 and 4', () => {
    const h = harness([0, 1, 2, 3].map(() => slot(SLOT_ENGINE)));
    draw(h.host, 0, 1);
    expect(Object.fromEntries(h.written)['l2.gain']).toBe(1);
  });

  it('a pointer that never grabbed the square moves nothing', () => {
    const h = harness([0, 1, 2, 3].map(() => slot(SLOT_ENGINE)));
    pad(h.host)!.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 9, clientY: 9 }));
    expect(h.written).toEqual([]);
  });
});
