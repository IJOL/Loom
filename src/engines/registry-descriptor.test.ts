// src/engines/registry-descriptor.test.ts
// Phase 4 Task 1: the registry must expose engine METADATA (id/name/params/
// polyphony/editor/presets/modulators) without constructing a legacy engine
// class. The worklet allocator reads this descriptor to build a WorkletLaneEngine,
// so reading it must NOT instantiate a node-per-note legacy engine.

import { describe, it, expect, vi } from 'vitest';

// Side-effect imports register engines + descriptors (mirror main.ts).
import '../engines/subtractive';
import '../engines/wavetable';
import '../engines/fm';
import '../engines/karplus';
import '../engines/tb303';
import '../engines/westcoast';

import * as registry from './registry';
import { getEngineDescriptor } from './registry';

describe('getEngineDescriptor — metadata without legacy construction', () => {
  it.each([
    ['tb303', 'mono'],
    ['subtractive', 'poly'],
    ['fm', 'poly'],
    ['karplus', 'poly'],
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
