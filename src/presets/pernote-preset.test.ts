// The Per-Note sound ships as a PRESET rather than as a ninth engine, because
// the engine it needs already exists: Subtractive has pulse oscillators with
// PW, ladder filter models and both envelopes. What did not exist was a
// modulator that varies per note, so the preset is where the two meet.
//
// A preset carries its own modulators, and a plugin modulator's settings ride
// in a generic `params` bag. The loader validates modulators only shallowly, so
// this checks the bag actually survives the trip rather than assuming it.
import { describe, it, expect } from 'vitest';
import { validatePresetEntry } from './preset-loader';
import presets from '../../plugins/subtractive/presets.json';

type Mod = {
  kind: string; enabled?: boolean; scope?: string;
  params?: Record<string, number>;
  connections?: { paramId: string; depth: number }[];
};
type Preset = { name: string; params: Record<string, number>; modulators?: Mod[] };

const all = (Array.isArray(presets)
  ? presets
  : (presets as unknown as { presets: Preset[] }).presets) as unknown as Preset[];
const entry = () => all.find((p) => p.name === 'PLUCK Per-Note Pulse')!;

describe('the Per-Note preset', () => {
  it('ships, and passes the real loader validation', () => {
    expect(entry(), 'PLUCK Per-Note Pulse is not in subtractive presets.json').toBeDefined();
    expect(validatePresetEntry(entry())).toBe(true);
  });

  it('carries the modulator with its settings intact', () => {
    const pn = entry().modulators?.find((m) => m.kind === 'pernote');
    expect(pn, 'the preset lost its per-note modulator').toBeDefined();
    // The bag a plugin kernel reads. Without it the modulator loads enabled and
    // connected and falls back to defaults — quietly not the sound that shipped.
    expect(pn!.params?.pattern).toBeGreaterThan(0);
    expect(pn!.params).toHaveProperty('skew');
    expect(pn!.params).toHaveProperty('bipolar');
  });

  it('uses an irrational pattern, so the sequence never comes back', () => {
    const pattern = entry().modulators!.find((m) => m.kind === 'pernote')!.params!.pattern;
    // A short decimal is a rational and cycles: 0.618 is 309/500 and returns at
    // note 500. Anything shipped here must carry enough digits not to.
    expect(String(pattern).replace('0.', '').length).toBeGreaterThan(10);
  });

  it('runs per voice, or every note in a chord would share one value', () => {
    expect(entry().modulators!.find((m) => m.kind === 'pernote')!.scope).toBe('per-voice');
  });

  it('drives targets the engine actually declares', () => {
    const declared = new Set(
      (require('../../plugins/subtractive/plugin.json') as {
        components: { params: { id: string }[] }[];
      }).components.flatMap((c) => c.params.map((p) => p.id)),
    );
    for (const c of entry().modulators!.find((m) => m.kind === 'pernote')!.connections!) {
      expect(declared.has(c.paramId), `${c.paramId} is not a subtractive param`).toBe(true);
      expect(c.depth).toBeGreaterThan(0);
    }
  });
});

// ── The preset's modulator actually arriving, end to end ─────────────────────
// The chain from the shipped JSON to the audio thread is: applyPreset →
// modHost.deserialize → toModLite → the kernel reads m.params. Every hop is a
// shallow copy of somebody else's object, and a plugin modulator's settings
// live in a generic bag that none of those hops knows the shape of — exactly
// the sort of thing that gets dropped without a word.
import { ModulationHostImpl } from '../modulation/modulation-host';
import { toModLite } from '../engines/mod-lite';
import type { ModulatorState, ModulatorVoice } from '../modulation/types';
import { registerModulator } from '../modulation/modulator-registry';
import pernoteManifest from '../../plugins/pernote/plugin.json';

/** Register the modulator the way the plugin host does — FROM ITS MANIFEST —
 *  so what is under test includes the manifest's own declaration rather than
 *  a stub that agrees with the test by construction. */
function registerPernoteFromManifest(): void {
  const c = pernoteManifest.components[0];
  registerModulator({
    id: c.id,
    name: c.name,
    driver: c.modulator.driver as 'time' | 'gate' | 'trigger',
    scopes: c.modulator.scopes as ('shared' | 'per-voice')[],
    idPrefix: c.modulator.idPrefix,
    defaultState: (id): ModulatorState => ({
      id, kind: c.id, enabled: true, connections: [], scope: 'per-voice',
    }),
    createVoice: (): ModulatorVoice => ({
      output: {} as AudioNode, trigger: () => {}, release: () => {},
      dispose: () => {}, currentValue: () => 0,
    }),
  });
}

describe('the preset\'s modulator survives the trip to the audio thread', () => {
  it('keeps its kind, its connections and its settings', () => {
    const host = new ModulationHostImpl([]);
    host.deserialize(entry().modulators as unknown as ModulatorState[]);

    const live = host.modulators.find((m) => m.kind === 'pernote');
    expect(live, 'the host dropped the modulator').toBeDefined();
    expect(live!.params?.pattern, 'the host dropped its settings').toBeGreaterThan(0);

    // And through the wire format the worklet actually receives.
    const lite = toModLite(host.modulators, 120, (id) => id);
    const pn = lite.find((m) => m.kind === 'pernote');
    expect(pn, 'toModLite dropped the modulator').toBeDefined();
    expect(pn!.params?.pattern, 'toModLite dropped the params bag').toBe(
      entry().modulators!.find((m) => m.kind === 'pernote')!.params!.pattern,
    );
    // Its connections have to survive too, or it modulates nothing.
    expect(Object.keys(pn!.depthByParam).sort()).toEqual(['filter.cutoff', 'osc1.pw']);
  });

  it('arrives with driver:trigger, which is what puts it on the per-voice path', () => {
    registerPernoteFromManifest();
    const host = new ModulationHostImpl([]);
    host.deserialize(entry().modulators as unknown as ModulatorState[]);
    const pn = toModLite(host.modulators, 120, (id) => id).find((m) => m.kind === 'pernote');
    // Resolved from the registry by toModLite. Undefined here would mean the
    // plugin never registered, and the runtime would treat it as an ordinary
    // time-driven mod — frozen on the shared path's triggerIndex of 0.
    expect(pn!.driver).toBe('trigger');
  });
});
