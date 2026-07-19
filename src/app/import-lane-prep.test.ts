// Regression: imported synth/melodic lanes must apply their preset through the
// HOST path (applyPresetForLane), which records the preset-dropdown selection.
// The old launchSceneById applied the preset to the engine directly, so every
// imported synth lane's dropdown showed "(custom — no preset)".

import { describe, it, expect, vi } from 'vitest';
import { prepImportedLanes, type ImportLanePrepDeps } from './import-lane-prep';
import type { SessionLane } from '../session/session';

function makeDeps(over: Partial<ImportLanePrepDeps> = {}): ImportLanePrepDeps {
  return {
    hasResource: () => false, // every lane is "new" by default
    ensureLaneResource: vi.fn(),
    getEngineInstance: () => ({ setKeymap: () => {} }),
    applyDrumPreset: vi.fn(),
    reloadDrumkit: vi.fn(),
    applyPresetForLane: vi.fn(),
    ...over,
  };
}

describe('prepImportedLanes', () => {
  it('applies a synth lane preset through applyPresetForLane (records the dropdown)', () => {
    const deps = makeDeps();
    const lane: SessionLane = { inserts: [], id: 'l1', engineId: 'fm', clips: [], enginePresetName: 'factory:EP Classic Tine' };
    prepImportedLanes([lane], deps);
    expect(deps.applyPresetForLane).toHaveBeenCalledWith('l1', 'factory:EP Classic Tine');
    expect(deps.ensureLaneResource).toHaveBeenCalledWith('l1', 'fm');
  });

  it('loads a sample-kit Drums lane via applyDrumPreset', () => {
    const deps = makeDeps();
    const lane: SessionLane = { inserts: [],
      id: 'd1', engineId: 'drums-machine', clips: [],
      enginePresetName: 'engine:GM Percussion',
      engineState: { kitMode: 'sample', sampler: { keymap: [], drumkitId: 'gm-percussion' } },
    } as SessionLane;
    prepImportedLanes([lane], deps);
    expect(deps.applyDrumPreset).toHaveBeenCalledWith('d1', 'GM Percussion');
    expect(deps.applyPresetForLane).not.toHaveBeenCalled();
  });

  it('reloads a Sampler drumkit lane via reloadDrumkit', () => {
    const deps = makeDeps();
    const lane: SessionLane = { inserts: [],
      id: 's1', engineId: 'sampler', clips: [],
      engineState: { sampler: { keymap: [], drumkitId: 'tr-909' } },
    } as SessionLane;
    prepImportedLanes([lane], deps);
    expect(deps.reloadDrumkit).toHaveBeenCalledWith('s1', 'tr-909', expect.anything());
    expect(deps.applyPresetForLane).not.toHaveBeenCalled();
  });

  it('does NOT re-apply a preset to an already-allocated lane', () => {
    const deps = makeDeps({ hasResource: () => true });
    const lane: SessionLane = { inserts: [], id: 'l1', engineId: 'fm', clips: [], enginePresetName: 'factory:EP Classic Tine' };
    prepImportedLanes([lane], deps);
    expect(deps.ensureLaneResource).toHaveBeenCalledWith('l1', 'fm');
    expect(deps.applyPresetForLane).not.toHaveBeenCalled();
  });
});
