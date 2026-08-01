// src/engines/engine-selector-ui.test.ts
// Regression test for the empty destination dropdown bug:
//   The modulators-panel destination dropdown is populated by filtering the
//   automationRegistry for `${laneId}.` entries (see modulation-ui.ts).
//
//   `rebuildEngineParamUI` calls `unregisterKnobsByPrefix(laneId, registry)`
//   to evict a stale engine's knobs when switching engines. For Subtractive
//   the knobs are mounted ONCE at boot (into the per-section divs declared
//   in index.html) and never re-registered by buildParamUI — so without an
//   explicit "rehydrate Subtractive main knobs" step the registry comes up
//   empty for that lane after the rebuild, and the modulator destination
//   dropdown comes up empty.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { unregisterKnobsByPrefix, melodicSynthEngineIds } from './engine-selector-ui';
import type { KnobHandle } from '../core/knob';
import { bootstrapPlugins } from '../app/plugin-bootstrap';
import { installMainThreadLoomApi, __resetPluginEngines } from '../plugin-host/loom-api';
import karplusPlugin from '../../plugins/karplus/plugin.json';

function makeKnobHandle(id: string): KnobHandle {
  return {
    el: { } as unknown as HTMLElement,
    meta: { id, min: 0, max: 1 },
    setValue: () => { /* noop */ },
    setModulationOffset: () => { /* noop */ },
  };
}

describe('engine-selector-ui — registry hygiene', () => {
  it('unregisterKnobsByPrefix removes only entries with the matching prefix', () => {
    const reg = new Map<string, KnobHandle>();
    reg.set('main.osc1.level',      makeKnobHandle('main.osc1.level'));
    reg.set('main.filter.cutoff',   makeKnobHandle('main.filter.cutoff'));
    reg.set('bass.cutoff',          makeKnobHandle('bass.cutoff'));
    reg.set('mix.bass.eq.hi',       makeKnobHandle('mix.bass.eq.hi'));

    unregisterKnobsByPrefix('main.', reg);

    expect([...reg.keys()].sort()).toEqual(['bass.cutoff', 'mix.bass.eq.hi']);
  });
});

describe('engine-selector-ui — melodic engine filter', () => {
  it('lists the built-in piano-roll engines and excludes drums-machine', () => {
    bootstrapPlugins(); // registers all builtin synth plugins + engines
    const ids = melodicSynthEngineIds();
    expect(ids).toEqual(
      expect.arrayContaining(['tb303', 'subtractive', 'fm', 'wavetable']),
    );
    expect(ids).not.toContain('drums-machine');
  });

  // Acceptance criterion: a PLUGIN engine is a first-class citizen of the lane
  // selector with no extra wiring — melodicSynthEngineIds filters the engine
  // registry by `editor === 'piano-roll'`, and registerComponent puts a
  // manifest there like any built-in. This is the unit-level half of the e2e check.
  it('includes a plugin engine as soon as its manifest is registered', () => {
    bootstrapPlugins();
    __resetPluginEngines();
    installMainThreadLoomApi();
    expect(melodicSynthEngineIds()).not.toContain('karplus');
    (globalThis as unknown as { Loom: { registerComponent(m: unknown): void } })
      .Loom.registerComponent(karplusPlugin.components[0]);
    expect(melodicSynthEngineIds()).toContain('karplus');
  });
});

describe('engine-selector-ui — no static subtractive markup', () => {
  // Subtractive's OSC/FILTER/AMP rows used to be hand-written HTML on the poly
  // page (three `data-engine="subtractive"` rows, each holding a `#poly-*-knobs`
  // div that knob-mounting.mountSubtractiveLaneKnobs painted knobs into). Every
  // other melodic engine draws its knobs from its declared params via
  // buildEngineParamGrid, and Subtractive now does too (worklet-lane-engine.ts
  // no longer skips its own grid) — so the static rows became dead markup that
  // painted a SECOND, hidden "Cutoff"/"Resonance"/etc. next to the real one.
  // This reads the real index.html (not a fixture) so a partial revert of the
  // deletion — the markup restored, the mount function not — fails here.
  const html = fs.readFileSync(path.resolve('index.html'), 'utf8');

  it('leaves no subtractive-only rows in the document', () => {
    expect(html).not.toContain('data-engine="subtractive"');
  });

  it('leaves no orphan per-section knob-row divs behind', () => {
    for (const id of [
      'poly-osc1-knobs', 'poly-osc2-knobs', 'poly-sub-knobs', 'poly-noise-knobs',
      'poly-filter-knobs', 'poly-amp-knobs', 'poly-master-knobs',
    ]) {
      expect(html).not.toContain(`id="${id}"`);
    }
  });

  it('non-vacuity: the poly page and its shared FX row are still there', () => {
    // Proves the two checks above fail for the RIGHT reason (dead rows gone),
    // not because the whole poly page was accidentally deleted with them.
    expect(html).toContain('data-page="poly"');
    expect(html).toContain('id="poly-fx-row"');
  });
});
