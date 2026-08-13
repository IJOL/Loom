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
import { getEngine, registerEngine } from './registry';
import { createDescriptorEngine } from './descriptor-engine';
import { isLayerModulator } from './layer-modulators';
import { listAutomationTargets } from '../automation/automation-targets';
import { ModulationHostImpl } from '../modulation/modulation-host';
import type { ModulatorState } from '../modulation/types';
import type { SessionLane, SessionState } from '../session/session';
import type { EngineUIContext, SynthEngine } from './engine-types';

/** The engine whose presets a slot recalls. `subtractive` is registered by the
 *  plugin host in the app; here its params come from the descriptor the test
 *  registry already holds, and only the PRESET cache needs seeding. */
const SLOT_ENGINE = 'subtractive';

// The slot's engine has to be REGISTERED, not merely have presets: prefixing a
// modulator resolves its target through that engine's own declared params,
// exactly as the worklet's mapper does. In the app subtractive is a plugin the
// host registers at boot; here it is two params, which is all this needs.
if (!getEngine(SLOT_ENGINE)) {
  registerEngine(createDescriptorEngine({
    id: SLOT_ENGINE, name: 'Subtractive', polyphony: 'poly',
    params: [
      { id: 'filter.cutoff', label: 'Cutoff', kind: 'continuous', min: 0, max: 20000, default: 800 },
      { id: 'osc1.level', label: 'Level', kind: 'continuous', min: 0, max: 1, default: 0.6 },
    ],
    presets: () => [],
  }));
}

const lane = (): SessionLane => ({
  id: 'lane1', engineId: SLOT_ENGINE, clips: [], inserts: [],
  engineState: { params: { 'filter.cutoff': 800 } },
} as unknown as SessionLane);

function harness() {
  const written: [string, number][] = [];
  // A real ModulationHostImpl, because a layer's preset now brings ITS
  // modulators and the rack reads the set back to replace only that slot's.
  const modHost = new ModulationHostImpl([]);
  const posted: number[] = [];
  const engine = {
    id: LAYERS_ENGINE_ID,
    setBaseValue: (id: string, v: number) => { written.push([id, v]); },
    getBaseValue: () => 0,
    modulators: modHost,
    postModulators: () => { posted.push(1); },
  } as unknown as SynthEngine;

  const l = lane();
  // The two global insert racks are part of a session, and the destination
  // catalogue walks them alongside the lanes.
  const state = { lanes: [l], masterInserts: [], sends: [] } as unknown as SessionState;
  const racks: unknown[] = [];
  wireLayersRack({
    setRack: (laneId, layers) => {
      racks.push(layers);
      const target = state.lanes.find((x) => x.id === laneId);
      if (!target) return;
      target.engineState = { ...target.engineState, layers };
      // What the real door does (main.ts): the lane IS a layered instrument now
      // and says so. The fixture mirrors it because three things downstream read
      // that id — the destination catalogue, the convert guard, and the loader.
      target.engineId = LAYERS_ENGINE_ID;
    },
    repaint: () => {},
  });

  const host = document.createElement('div');
  const ctx = { laneId: l.id, sessionState: state } as unknown as EngineUIContext;
  return { host, ctx, engine, lane: l, state, written, racks, modHost, posted };
}

/** An envelope of the kind every subtractive preset ships: one on the
 *  amplitude, one on the filter. Written in the preset's own vocabulary — bare
 *  target ids — which is what the prefixing has to translate. */
const presetMods = (sustain: number): ModulatorState[] => ([
  {
    id: 'adsr-amp', kind: 'adsr', enabled: true, scope: 'per-voice', sustain,
    connections: [{ id: 'c', paramId: 'amp', depth: 1 }],
  },
  {
    id: 'adsr-filter', kind: 'adsr', enabled: true, scope: 'per-voice', sustain,
    connections: [{ id: 'c', paramId: 'filter.env', depth: 1 }],
  },
] as ModulatorState[]);

beforeEach(() => {
  __resetPresetCache();
  seedEnginePresets(SLOT_ENGINE, [
    { name: 'Bright', params: { 'filter.cutoff': 9000, 'osc1.level': 0.9 } },
    { name: 'Dark', params: { 'filter.cutoff': 300, 'osc1.level': 0.2 },
      modulators: presetMods(0.4) },
    { name: 'Flat', params: { 'filter.cutoff': 1000 } },
  ]);
});

/** What the app does after a conversion: the rack rebuilds the lane's engine,
 *  and the persisted state — params AND modulators — is applied onto the one
 *  that now exists. The fixture's engine is not rebuilt, so this is the step
 *  that stands in for it. */
function rebuild(h: ReturnType<typeof harness>): void {
  h.modHost.deserialize(h.lane.engineState?.modulators ?? []);
}

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

  it('marks the lane as layered, which is what everything downstream reads', () => {
    // Left unwritten, the lane claimed to be its old engine while its live
    // engine was LAYERS. The destination catalogue is built from this id, so
    // `l0.gain` was not a destination at all and WEAVE's sound fader wrote
    // nothing — reported as "el fader no hace nada". A save reloaded the lane as
    // its old engine too, rack and all.
    const h = harness();
    convertLaneToLayers(h.lane, 'Bright');
    expect(h.lane.engineId).toBe(LAYERS_ENGINE_ID);
  });

  it('refuses a lane that is already layered', () => {
    const h = harness();
    convertLaneToLayers(h.lane, 'Bright');
    expect(convertLaneToLayers(h.lane, 'Bright')).toBe(false);
  });

  it('cannot be applied twice, so nothing is prefixed twice', () => {
    // The guard only bites once the lane says it is layered. Without it a second
    // pass prefixed an already-prefixed set and produced `l0.l0.adsr-amp` and
    // `l0.l0.filter.cutoff` — seen in the app's own destination list.
    const h = harness();
    convertLaneToLayers(h.lane, 'Bright', { 'filter.cutoff': 4200 }, presetMods(0.6));
    convertLaneToLayers(h.lane, 'Bright', { 'filter.cutoff': 4200 }, presetMods(0.6));
    expect(Object.keys(h.lane.engineState?.params ?? {}).some((k) => /^l\d\.l\d\./.test(k))).toBe(false);
    expect((h.lane.engineState?.modulators ?? []).some((m) => /^l\d\.l\d\./.test(m.id))).toBe(false);
  });

  it('offers the layer gains as destinations, which is what the fader writes', () => {
    // The end of the chain WEAVE's sound fader depends on: it looks its two
    // targets up in the ONE catalogue and skips a lane that does not offer
    // them. This is the assertion that ties the fader to the conversion.
    const h = harness();
    convertLaneToLayers(h.lane, 'Bright');
    const ids = listAutomationTargets(h.state, new Map()).map((t) => t.id);
    expect(ids).toContain(`${h.lane.id}.l0.gain`);
    expect(ids).toContain(`${h.lane.id}.l1.gain`);
  });

  it('carries the LIVE patch, not the mirror of edits', () => {
    // engineState.params holds what has been WRITTEN since the lane was built,
    // which for a lane sounding a preset applied at boot is almost nothing. So
    // the copy carried almost nothing and the converted lane came up on factory
    // defaults — reported as "suena totalmente diferente y el preset es el
    // mismo". The caller reads the engine; this only has to prefer it.
    const h = harness();
    convertLaneToLayers(h.lane, 'Bright', { 'filter.cutoff': 4200, 'osc1.level': 0.33 });
    const p = h.lane.engineState?.params ?? {};
    expect(p['l0.filter.cutoff']).toBe(4200);
    expect(p['l1.filter.cutoff']).toBe(4200);
    // A param the mirror never held still comes across.
    expect(p['l0.osc1.level']).toBe(0.33);
  });

  it('falls back to the mirror when there is no engine to read', () => {
    // A fixture with no audio graph still has to convert rather than throw.
    const h = harness();
    convertLaneToLayers(h.lane, 'Bright');
    expect(h.lane.engineState?.params?.['l0.filter.cutoff']).toBe(800);
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

describe('a slot contains its instrument s ENVELOPES too', () => {
  // The half params could never carry. `amp` and `filter.env` are not knobs, so
  // a preset applied as params alone left the slot playing the previous
  // preset's envelope with the new preset's cutoff.

  it('brings the preset s modulators in, under this slot s prefix', () => {
    const h = harness();
    convertLaneToLayers(h.lane, 'Bright');
    pickPreset(h, 'Dark');
    const ids = h.modHost.serialize().map((m) => m.id);
    expect(ids).toContain('l0.adsr-amp');
    expect(ids).not.toContain('adsr-amp');
  });

  it('aims them at THIS slot s envelope, not the lane s', () => {
    // A connection to the bare `amp` would be handed to every layer unchanged,
    // and two instruments could never have different envelopes.
    const h = harness();
    convertLaneToLayers(h.lane, 'Bright');
    pickPreset(h, 'Dark');
    const amp = h.modHost.serialize().find((m) => m.id === 'l0.adsr-amp');
    expect(amp?.connections[0].paramId).toBe('l0.amp');
  });

  it('REPLACES the slot s previous set rather than stacking on it', () => {
    // Otherwise a slot accumulates one envelope per preset ever recalled into
    // it, and the oldest keeps sounding.
    const h = harness();
    convertLaneToLayers(h.lane, 'Bright');
    pickPreset(h, 'Dark');
    pickPreset(h, 'Flat');
    expect(h.modHost.serialize().filter((m) => m.id.startsWith('l0.'))).toHaveLength(0);
  });

  it('leaves the OTHER slot s envelopes alone', () => {
    const h = harness();
    convertLaneToLayers(h.lane, 'Bright', undefined, presetMods(0.9));
    rebuild(h);
    const before = h.modHost.serialize().filter((m) => m.id.startsWith('l1.'));
    pickPreset(h, 'Dark');
    const after = h.modHost.serialize().filter((m) => m.id.startsWith('l1.'));
    expect(after).toHaveLength(before.length);
    expect(after.length).toBeGreaterThan(0);
  });

  it('re-sends the set, or the write reaches the object and not the sound', () => {
    // Deserializing replaces the host's state and nothing else — the worklet
    // carries on running whatever it was last handed.
    const h = harness();
    convertLaneToLayers(h.lane, 'Bright');
    pickPreset(h, 'Dark');
    expect(h.posted.length).toBeGreaterThan(0);
  });

  it('mirrors them into the lane so they survive a reload', () => {
    const h = harness();
    convertLaneToLayers(h.lane, 'Bright');
    pickPreset(h, 'Dark');
    expect(h.lane.engineState?.modulators?.map((m) => m.id)).toContain('l0.adsr-amp');
  });
});

describe('converting carries the lane s envelopes into BOTH slots', () => {
  // The measured failure: subtractive ships an ADSR on `amp` and one on
  // `filter.env`, LAYERS ships a single LFO, so a converted lane came up with a
  // flat amplitude and a shut filter — RMS 0.044 → 0.022.

  it('gives each slot its own copy', () => {
    const h = harness();
    convertLaneToLayers(h.lane, 'Bright', undefined, presetMods(0.6));
    const ids = h.lane.engineState?.modulators?.map((m) => m.id) ?? [];
    expect(ids).toContain('l0.adsr-amp');
    expect(ids).toContain('l1.adsr-amp');
    expect(ids).toContain('l0.adsr-filter');
  });

  it('points each copy at its own slot', () => {
    const h = harness();
    convertLaneToLayers(h.lane, 'Bright', undefined, presetMods(0.6));
    const mods = h.lane.engineState?.modulators ?? [];
    expect(mods.find((m) => m.id === 'l0.adsr-amp')?.connections[0].paramId).toBe('l0.amp');
    expect(mods.find((m) => m.id === 'l1.adsr-amp')?.connections[0].paramId).toBe('l1.amp');
  });

  it('keeps LAYERS own modulators alongside them', () => {
    // The rack's LFO belongs to the rack, and is what an inserted modulator
    // would join.
    const h = harness();
    convertLaneToLayers(h.lane, 'Bright', undefined, presetMods(0.6));
    const own = h.lane.engineState?.modulators?.filter((m) => !isLayerModulator(m.id));
    expect(own?.length).toBeGreaterThan(0);
  });

  it('resolves a LANE-qualified connection the same as a bare one', () => {
    // A connection made in the panel stores `subtractive-1.filter.cutoff`; one
    // shipped in a preset stores `filter.cutoff`. Both have to end up as
    // `l0.filter.cutoff` or half a lane's modulation is dropped on conversion.
    const h = harness();
    convertLaneToLayers(h.lane, 'Bright', undefined, [{
      id: 'lfo1', kind: 'lfo', enabled: true, scope: 'shared',
      connections: [{ id: 'c', paramId: 'subtractive-1.filter.cutoff', depth: 0.5 }],
    }] as ModulatorState[]);
    const lfo = h.lane.engineState?.modulators?.find((m) => m.id === 'l0.lfo1');
    expect(lfo?.connections[0].paramId).toBe('l0.filter.cutoff');
  });

  it('converts a lane with no modulators at all without inventing any', () => {
    const h = harness();
    convertLaneToLayers(h.lane, 'Bright', undefined, []);
    expect(h.lane.engineState?.modulators?.some((m) => m.id.startsWith('l0.'))).toBe(false);
  });
});

describe('a rack built for the sound control', () => {
  // Four corners of a cloud, all holding the lane's own instrument: what the
  // WEAVE sound control asks for now that it duplicates rather than dealing a
  // stranger into every slot after the first.
  const spreadOfOwn = (n: number, id: string) => Array.from({ length: n - 1 }, () => id);

  it('holds the lane s own instrument in every slot', () => {
    const h = harness();
    convertLaneToLayers(h.lane, 'Bright', undefined, [], spreadOfOwn(4, SLOT_ENGINE));
    const rack = h.lane.engineState?.layers as { engineId: string }[];
    expect(rack.map((l) => l.engineId)).toEqual(Array(4).fill(SLOT_ENGINE));
  });

  it('records the lane s preset on every slot that holds its engine', () => {
    // Without it a duplicated slot plays that very sound while its dropdown
    // reads "— pick —", which is the label/sound split this file already fixed
    // once for recallLayerPreset.
    const h = harness();
    convertLaneToLayers(h.lane, 'Bright', undefined, [], spreadOfOwn(2, SLOT_ENGINE));
    const rack = h.lane.engineState?.layers as { presetName?: string }[];
    expect(rack.map((l) => l.presetName)).toEqual(['Bright', 'Bright']);
  });

  it('leaves every slot after the first SILENT', () => {
    // Converting has to be inaudible: slot 1 at unity doubles the lane the
    // moment you press the button, and then masks every change you make to it.
    const h = harness();
    convertLaneToLayers(h.lane, 'Bright', undefined, [], spreadOfOwn(4, SLOT_ENGINE));
    const params = h.lane.engineState?.params ?? {};
    expect([0, 1, 2, 3].map((i) => params[`l${i}.gain`])).toEqual([1, 0, 0, 0]);
  });
});

describe('the registry still knows LAYERS', () => {
  it('is registered, so the conversion has somewhere to go', () => {
    expect(getEngine(LAYERS_ENGINE_ID)).toBeDefined();
  });
});
