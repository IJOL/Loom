import { describe, it, expect } from 'vitest';
import './layers-engine';
// Deliberately AFTER the engine, mirroring the cold start this codebase
// actually hits: the engine glob and the modulator glob run in an order nothing
// guarantees. The descriptor's modulator host is lazy for exactly this reason,
// and reading the descriptor below is what proves it still is.
import '../plugins/modulators/lfo';
import '../plugins/modulators/adsr';
import { LAYERS_ENGINE_ID, LAYERS_PARAMS, laneLayers, layersDynamicParamsFor } from './layers-engine';
import { getEngine, getEngineDescriptor, listEngines } from './registry';
import { isWorkletHosted, isHarmonic } from '../plugins/capabilities';
import { MAX_LAYERS } from '../audio-dsp/layers/layer-spec';
import type { SessionLane } from '../session/session';

const lane = (layers?: { engineId: string }[]): SessionLane => ({
  id: 'l1', engineId: LAYERS_ENGINE_ID, clips: [], inserts: [],
  engineState: layers ? { layers: layers.map((l) => ({ lo: 0, hi: 127, gain: 1, ...l })) } : undefined,
});

describe('the LAYERS engine registers like any other', () => {
  it('is in the selector', () => {
    expect(listEngines('polyhost').some((e) => e.id === LAYERS_ENGINE_ID)).toBe(true);
    expect(getEngine(LAYERS_ENGINE_ID)?.name).toBe('Layers');
  });

  it('says it is worklet-hosted, or the allocator would route it nowhere', () => {
    // In-tree engines are NOT worklet-hosted by default — the sampler and the
    // drum machine have their own processors. This one has to declare it, and a
    // lane that routes to no backend is silent rather than broken-looking.
    expect(isWorkletHosted(LAYERS_ENGINE_ID)).toBe(true);
  });

  it('is harmonic — it can host a chord accompaniment', () => {
    expect(isHarmonic(LAYERS_ENGINE_ID)).toBe(true);
  });

  it('declares gain and a zone for EVERY slot, filled or not', () => {
    // The lane's param numbering is fixed for its lifetime, so a slot that grew
    // its knobs only once filled would need the lane rebuilt to turn a gain down.
    for (let i = 0; i < MAX_LAYERS; i++) {
      for (const id of [`l${i}.gain`, `l${i}.lo`, `l${i}.hi`]) {
        expect(LAYERS_PARAMS.some((p) => p.id === id)).toBe(true);
      }
    }
  });
});

describe('the rack', () => {
  it('reads as MAX_LAYERS slots even when the lane stored fewer', () => {
    expect(laneLayers(lane([{ engineId: 'x' }]))).toHaveLength(MAX_LAYERS);
  });

  it('an unstored slot is empty, not a default instrument', () => {
    // A slot the user never filled must cost nothing. Picking a default here
    // would make every new LAYERS lane four synths deep.
    expect(laneLayers(lane()).every((l) => l.engineId === '')).toBe(true);
  });
});

describe('a slot contributes its engine params, prefixed', () => {
  it('offers nothing for an empty rack', () => {
    expect(layersDynamicParamsFor(lane())).toEqual([]);
  });

  it('prefixes a real engine params with its slot', () => {
    // Pick whatever engine the registry actually has beside this one, so the
    // test does not pin a plugin that may not be loaded.
    const other = listEngines('polyhost').find((e) => e.id !== LAYERS_ENGINE_ID);
    if (!other) return;                       // registry with LAYERS alone
    const out = layersDynamicParamsFor(lane([{ engineId: other.id }]));
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((p) => p.id.startsWith('l0.'))).toBe(true);
    expect(out.every((p) => p.group === 'layer0')).toBe(true);
  });

  it('keeps the lane to ONE set of mixer params', () => {
    const other = listEngines('polyhost').find((e) => e.id !== LAYERS_ENGINE_ID);
    if (!other) return;
    const out = layersDynamicParamsFor(lane([{ engineId: other.id }]));
    // Level, pan, the sends and the EQ belong to the lane's one channel. Four
    // layers must not offer four faders for it.
    expect(out.some((p) => p.id.endsWith('.level') || p.id.endsWith('.pan'))).toBe(false);
  });

  it('reaches the allocator through the descriptor', () => {
    // The allocator folds these in BEFORE the worklet fixes the numbering. Left
    // off the descriptor, every layer knob is silently unaddressable.
    expect(typeof getEngineDescriptor(LAYERS_ENGINE_ID)?.dynamicParamsFor).toBe('function');
  });
});
