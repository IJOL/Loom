/** @vitest-environment jsdom */
// Does picking a preset for a LAYER actually reach the instrument?
//
// Reported from the app: "cambio los presets y el sonido siempre es el mismo".
// The browser could not answer it — the dropdown updates either way, so what it
// shows says nothing about whether the write landed. This can answer it: the
// rack is handed an engine, and the question is simply whether that engine is
// told anything.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import './layers-engine';
import '../plugins/modulators/lfo';
import '../plugins/modulators/adsr';
import { LAYERS_ENGINE_ID } from './layers-engine';
import { buildLayersRack, wireLayersRack, convertLaneToLayers } from './layers-rack-ui';
import { seedEnginePresets, __resetPresetCache } from '../presets/preset-loader';
import { getEngine } from './registry';
import type { SessionLane, SessionState } from '../session/session';
import type { EngineUIContext, SynthEngine } from './engine-types';

/** The engine whose presets a slot recalls. `subtractive` is registered by the
 *  plugin host in the app; here its params come from the descriptor the test
 *  registry already holds, and only the PRESET cache needs seeding. */
const SLOT_ENGINE = 'subtractive';

const lane = (): SessionLane => ({
  id: 'lane1', engineId: SLOT_ENGINE, clips: [], inserts: [],
  engineState: { params: { 'filter.cutoff': 800 } },
} as unknown as SessionLane);

function harness() {
  const written: [string, number][] = [];
  const engine = {
    id: LAYERS_ENGINE_ID,
    setBaseValue: (id: string, v: number) => { written.push([id, v]); },
    getBaseValue: () => 0,
  } as unknown as SynthEngine;

  const l = lane();
  const state = { lanes: [l] } as unknown as SessionState;
  const racks: unknown[] = [];
  wireLayersRack({
    setRack: (laneId, layers) => {
      racks.push(layers);
      const target = state.lanes.find((x) => x.id === laneId);
      if (target) target.engineState = { ...target.engineState, layers };
    },
    repaint: () => {},
  });

  const host = document.createElement('div');
  const ctx = { laneId: l.id, sessionState: state } as unknown as EngineUIContext;
  return { host, ctx, engine, lane: l, state, written, racks };
}

beforeEach(() => {
  __resetPresetCache();
  seedEnginePresets(SLOT_ENGINE, [
    { name: 'Bright', params: { 'filter.cutoff': 9000, 'osc1.level': 0.9 } },
    { name: 'Dark', params: { 'filter.cutoff': 300, 'osc1.level': 0.2 } },
  ]);
});

/** Pick `name` in the rack's preset dropdown, the way a user does. */
function pickPreset(h: ReturnType<typeof harness>, name: string): boolean {
  buildLayersRack(h.host, h.ctx, h.engine);
  const sel = [...h.host.querySelectorAll('select')]
    .find((s) => (s.getAttribute('aria-label') ?? '').startsWith('Preset'));
  if (!sel) return false;
  sel.value = name;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

describe('a layer s preset reaches the instrument', () => {
  it('writes the preset s params under THIS layer s prefix', () => {
    // The whole question. A write that never happens looks exactly like a
    // preset that sounds identical to the last one.
    const h = harness();
    convertLaneToLayers(h.lane, 'Bright');
    expect(pickPreset(h, 'Dark')).toBe(true);

    const cutoff = h.written.find(([id]) => id === 'l0.filter.cutoff');
    expect(cutoff).toBeDefined();
    expect(cutoff![1]).toBe(300);
  });

  it('touches ONLY the open layer', () => {
    // Two slots of the same engine share every param NAME and must not share a
    // value: that is the whole reason the prefix exists.
    const h = harness();
    convertLaneToLayers(h.lane, 'Bright');
    pickPreset(h, 'Dark');
    expect(h.written.some(([id]) => id.startsWith('l1.'))).toBe(false);
  });

  it('mirrors into the lane so the sound survives a reload', () => {
    // setBaseValue alone moves the audio and loses it on save — the bug four
    // earlier builders shipped.
    const h = harness();
    convertLaneToLayers(h.lane, 'Bright');
    pickPreset(h, 'Dark');
    expect(h.lane.engineState?.params?.['l0.filter.cutoff']).toBe(300);
  });

  it('remembers WHICH preset the layer is on', () => {
    // Without it the dropdown falls back to "pick" on the next repaint and the
    // slot reads as empty while playing the sound it just recalled.
    const h = harness();
    convertLaneToLayers(h.lane, 'Bright');
    pickPreset(h, 'Dark');
    const layers = h.lane.engineState?.layers as { presetName?: string }[] | undefined;
    expect(layers?.[0]?.presetName).toBe('Dark');
  });

  it('does not rebuild the instrument just to store that name', () => {
    // Rebuilding here threw away the preset's params one line after they were
    // written. The rack is only written when the RACK changes — the conversion
    // itself — never by picking a preset.
    const h = harness();
    convertLaneToLayers(h.lane, 'Bright');
    const afterConvert = h.racks.length;
    pickPreset(h, 'Dark');
    expect(h.racks.length).toBe(afterConvert);
  });
});

describe('converting a lane carries its sound', () => {
  it('copies the lane s own params into BOTH slots', () => {
    // A layer's params wear its own prefix, so converting without copying
    // returns the lane to factory defaults with nothing to blame it on.
    const h = harness();
    convertLaneToLayers(h.lane, 'Bright');
    const p = h.lane.engineState?.params ?? {};
    expect(p['l0.filter.cutoff']).toBe(800);
    expect(p['l1.filter.cutoff']).toBe(800);
  });

  it('fills two slots over the whole keyboard', () => {
    // Two FULL-RANGE slots is what makes a note reach both instruments rather
    // than being split by pitch, which is the arrangement the sound fader
    // balances.
    const h = harness();
    convertLaneToLayers(h.lane, 'Bright');
    const layers = h.lane.engineState?.layers as
      { engineId: string; lo: number; hi: number }[] | undefined;
    expect(layers?.[0]).toMatchObject({ engineId: SLOT_ENGINE, lo: 0, hi: 127 });
    expect(layers?.[1]).toMatchObject({ engineId: SLOT_ENGINE, lo: 0, hi: 127 });
  });

  it('refuses a lane that is already layered', () => {
    const h = harness();
    convertLaneToLayers(h.lane, 'Bright');
    // The real setRack swaps the lane's engine; the fixture mirrors that,
    // because the guard reads engineId and would otherwise never see it change.
    h.lane.engineId = LAYERS_ENGINE_ID;
    expect(convertLaneToLayers(h.lane, 'Bright')).toBe(false);
  });

  it('brings slot 1 up SILENT, so converting changes nothing you hear', () => {
    // Both at unity doubles the lane's level the moment it is converted, and
    // then leaves both instruments playing at once for ever — recall a preset
    // into one and the other keeps the old sound on top of it at full level, so
    // the change is half-masked and reads as nothing happening. Reported as
    // "cambio los presets y el sonido siempre es el mismo".
    const h = harness();
    convertLaneToLayers(h.lane, 'Bright');
    const layers = h.lane.engineState?.layers as { gain: number }[] | undefined;
    expect(layers?.[0].gain).toBe(1);
    expect(layers?.[1].gain).toBe(0);
  });

  it('writes those gains as PARAMS too, or the live values overrule them', () => {
    // The rack's figure only holds until the lane's live array arrives; after
    // that the param wins, and l1.gain defaults to 1.
    const h = harness();
    convertLaneToLayers(h.lane, 'Bright');
    const p = h.lane.engineState?.params ?? {};
    expect(p['l0.gain']).toBe(1);
    expect(p['l1.gain']).toBe(0);
  });

  it('silences slot 1 even on a lane that had no params at all', () => {
    // The gains must not sit inside a "did this lane have a sound" branch.
    const h = harness();
    h.lane.engineState = {};
    convertLaneToLayers(h.lane, 'Bright');
    expect(h.lane.engineState?.params?.['l1.gain']).toBe(0);
  });

  it('does not let an engine s own `gain` param overwrite the layer gains', () => {
    // The copy loop prefixes everything the engine declares; an engine with a
    // `gain` of its own would land on l0.gain/l1.gain and undo the silence.
    const h = harness();
    h.lane.engineState = { params: { gain: 0.8 } };
    convertLaneToLayers(h.lane, 'Bright');
    expect(h.lane.engineState?.params?.['l1.gain']).toBe(0);
  });
});

describe('the registry still knows LAYERS', () => {
  it('is registered, so the conversion has somewhere to go', () => {
    expect(getEngine(LAYERS_ENGINE_ID)).toBeDefined();
  });
});
