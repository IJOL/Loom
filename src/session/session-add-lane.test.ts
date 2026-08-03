import { describe, it, expect } from 'vitest';
// Import side-effect to register the one engine still in the tree.
import '../engines/drums-engine';
// Reading a descriptor builds the engine's modulator host, and subtractive ships
// an LFO with the sound — so these two have to be registered or the read throws
// "unknown modulator kind: lfo". In the app that is plugin-bootstrap's glob; in a
// test it is the same side-effect import 19 other files already write.
import '../plugins/modulators/lfo';
import '../plugins/modulators/adsr';
import { listEngines, getEngineDescriptor } from '../engines/registry';
import { nextLaneSlug } from './session-host';
import { installMainThreadLoomApi, __resetPluginEngines } from '../plugin-host/loom-api';
import { registerPluginEngine } from '../../test/plugin-fixtures';

// Every melodic engine ships as a plugin; the FM case below reads the lane
// prefix out of fm's own manifest, which is the point.
for (const id of ['tb303', 'subtractive', 'wavetable', 'fm']) registerPluginEngine(id);

describe('nextLaneSlug — slug id generation', () => {
  it('returns subtractive-2 for first added subtractive (subtractive-1 already exists)', () => {
    expect(nextLaneSlug(new Set(['tb-303-1', 'drums-1', 'subtractive-1']), 'subtractive')).toBe('subtractive-2');
  });

  it('skips taken ids and returns the next free one', () => {
    expect(nextLaneSlug(new Set(['subtractive-1', 'subtractive-2', 'subtractive-3']), 'subtractive')).toBe('subtractive-4');
  });

  it('TB-303 lane gets tb-303-2 when tb-303-1 is present', () => {
    expect(nextLaneSlug(new Set(['tb-303-1']), 'tb303')).toBe('tb-303-2');
  });

  it('FM lane gets fm-4-op-1 when none exist (no default FM lane)', () => {
    expect(nextLaneSlug(new Set([]), 'fm')).toBe('fm-4-op-1');
  });

  it('Wavetable lane gets wavetable-1 when none exist', () => {
    expect(nextLaneSlug(new Set([]), 'wavetable')).toBe('wavetable-1');
  });

  it('drums-machine lane gets drums-2 when drums-1 is present', () => {
    expect(nextLaneSlug(new Set(['drums-1']), 'drums-machine')).toBe('drums-2');
  });

  it('unknown engineId falls back to engineId as prefix', () => {
    expect(nextLaneSlug(new Set([]), 'my-engine')).toBe('my-engine-1');
  });

  // The old case here asserted nextLaneSlug(…, 'karplus') === 'karplus-1', which
  // would still pass by ACCIDENT with no plugins loaded — the prefix falls back
  // to the engine id. What actually matters now is that a plugin's manifest
  // decides its own prefix, so that is what this asserts, with a shortLabel
  // deliberately different from the id.
  //
  // LAST in this describe on purpose: __resetPluginEngines() wipes the WHOLE
  // capabilities map, built-ins included, and the side-effect imports at the top
  // of the file cannot be re-run to put them back. Every case that reads a
  // built-in prefix therefore has to run before it.
  it('a plugin engine takes its lane prefix from the manifest shortLabel', () => {
    __resetPluginEngines();
    installMainThreadLoomApi();
    (globalThis as unknown as { Loom: { registerComponent(m: unknown): void } }).Loom.registerComponent({
      kind: 'engine', id: 'probe-engine', name: 'Probe', polyphony: 'poly', params: [],
      capabilities: { clipContent: 'notes', outputTrim: 0.5, shortLabel: 'prb' },
    });
    expect(nextLaneSlug(new Set([]), 'probe-engine')).toBe('prb-1');
    expect(nextLaneSlug(new Set(['prb-1']), 'probe-engine')).toBe('prb-2');
  });
});

describe('engine registry feeds the + Add selector', () => {
  it('lists at least subtractive + tb303 + drums-machine after side-effect imports', () => {
    const ids = listEngines('polyhost').map((e) => e.id);
    expect(ids).toContain('subtractive');
    expect(ids).toContain('tb303');
    expect(ids).toContain('drums-machine');
  });

  it('has a name per engine', () => {
    for (const e of listEngines('polyhost')) {
      expect(e.name).toBeTruthy();
    }
  });

  // The 21 files that register an engine by importing its module have to migrate
  // one at a time, not in one jump — so the two registration paths must be able
  // to share a single test file. This asserts exactly that: the manifest read off
  // disk and the side-effect imports at the top of this file both land in the SAME
  // registry, neither one clearing the other.
  it('the plugin fixture registers alongside the in-tree engines', () => {
    registerPluginEngine('karplus');
    expect(getEngineDescriptor('karplus')).toBeDefined();
    expect(getEngineDescriptor('subtractive')).toBeDefined();
  });
});
