// src/engines/registry-descriptor.test.ts
// Phase 4 Task 1: the registry must expose engine METADATA (id/name/params/
// polyphony/editor/presets/modulators) without constructing a legacy engine
// class. The worklet allocator reads this descriptor to build a WorkletLaneEngine,
// so reading it must NOT instantiate a node-per-note legacy engine.

import { describe, it, expect, vi } from 'vitest';

// Side-effect imports register engines + descriptors (mirror main.ts).

// Deliberately AFTER the five engine imports above, not before. Each engine
// file's own registerEngine(makeXDescriptor()) call runs at module scope —
// the same moment this ordering puts the modulator components' registration
// LATER. That reproduces a cold start where the modulator-components glob
// (plugin-bootstrap) has not run yet when an engine glob member loads: real
// risk this codebase actually hit (Task 5's amendment; makeDefaultLFO/
// makeDefaultADSR were CRITICAL — 12/148 and 11/139 dependants). Before Task
// 5 made the descriptor's modHost LAZY (built on first `.modulators` access,
// not at createDescriptorEngine() call time), this exact import order threw
// "unknown modulator kind: 'lfo'" here — proven by running this file with
// the eager construction reverted. With laziness, `getEngineDescriptor`
// below (called from inside `it()`, i.e. after every import in this file —
// engines AND modulators — has already resolved) succeeds regardless of
// which glob the app's real plugin-bootstrap happens to run first.
import '../plugins/modulators/lfo';
import '../plugins/modulators/adsr';

import * as registry from './registry';
import { getEngineDescriptor } from './registry';
import { registerPluginEngine } from '../../test/plugin-fixtures';

// subtractive and tb303 ship as plugins: the equivalent of the old
// side-effect import is that manifest going through the same adoptComponents
// door the plugin loader uses.
registerPluginEngine('subtractive');
registerPluginEngine('tb303');

// wavetable, fm and westcoast ship as PLUGINS and arrive through their real
// manifests. Note what this does NOT reproduce: an import is hoisted and a call
// is not, so these three necessarily register AFTER the modulator components
// above, not before. The cold-start race the import order below stages is
// therefore carried by tb303 and subtractive alone — which is enough, since the
// laziness it guards lives in createDescriptorEngine, one owner for all five.
for (const id of ['wavetable', 'fm', 'westcoast']) registerPluginEngine(id);

describe('getEngineDescriptor — metadata without legacy construction', () => {
  it.each([
    ['tb303', 'mono'],
    ['subtractive', 'poly'],
    ['fm', 'poly'],
    ['wavetable', 'poly'],
    ['westcoast', 'poly'],
  ])('returns a descriptor for %s with id/params/polyphony', (id, polyphony) => {
    const d = getEngineDescriptor(id);
    expect(d, `getEngineDescriptor('${id}') returned undefined`).toBeDefined();
    expect(d!.id).toBe(id);
    expect(d!.polyphony).toBe(polyphony);
    expect(d!.params.length).toBeGreaterThan(0);
    expect(typeof d!.name).toBe('string');
    expect(d!.name.length).toBeGreaterThan(0);
    expect(d!.editor).toBe('piano-roll');
    // modulators is a data array (ModulatorState[]); melodic engines ship defaults.
    expect(Array.isArray(d!.modulators)).toBe(true);
  });

  it('cold start: an engine imported before the modulator components still ends up ' +
     'with real default modulators, not an empty array (the failure mode a silent ' +
     '`?? []` fallback would produce)', () => {
    // Every one of these five descriptors ships at least one default modulator
    // (see SUBTRACTIVE_DEFAULT_MODULATORS/TB303_DEFAULT_MODULATORS/etc.). If the
    // module-order race this file's import order reproduces (see the comment
    // above the modulator imports) had been papered over with a fallback
    // instead of fixed with laziness, this would quietly read `[]` instead of
    // throwing — a synth with no envelope, discovered only by ear.
    for (const id of ['tb303', 'subtractive', 'fm', 'wavetable', 'westcoast']) {
      const d = getEngineDescriptor(id)!;
      expect(d.modulators.length, `${id} shipped with zero default modulators`).toBeGreaterThan(0);
      expect(d.modulators.some((m) => m.kind === 'lfo'), `${id} is missing its default LFO`).toBe(true);
    }
  });

  it('reading a descriptor does NOT call the legacy engine factory', () => {
    // createEngineInstance is the factory path that builds a fresh node-per-note
    // legacy engine. A pure-data descriptor read must never invoke it.
    const createSpy = vi.spyOn(registry, 'createEngineInstance');
    getEngineDescriptor('subtractive');
    getEngineDescriptor('fm');
    expect(createSpy).not.toHaveBeenCalled();
    createSpy.mockRestore();
  });

  it('unknown engineId yields undefined', () => {
    expect(getEngineDescriptor('does-not-exist')).toBeUndefined();
  });
});
