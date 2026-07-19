// @vitest-environment jsdom
// The destination dropdown of an EXISTING modulator must offer the params of
// an insert added AFTER the panel was rendered. The picker used to be built
// once at render time, so adding a filter insert left a pre-existing LFO
// unable to reach it until the whole engine editor was rebuilt.

import { describe, it, expect } from 'vitest';
import { renderModulatorsPanel, type ModulationUIDeps } from './modulation-ui';
import type { ModulationHost, ModulatorState } from './types';

function fakeInsert(paramIds: string[]): unknown {
  return { fx: { getAudioParams: () => new Map(paramIds.map((id) => [id, {} as AudioParam])) } };
}

/** Minimal stand-in for InsertChain: only `list()` is read by the picker. */
function fakeChain(items: unknown[]): ModulationUIDeps['laneInserts'] {
  return { list: () => items } as unknown as ModulationUIDeps['laneInserts'];
}

function fakeHost(mods: ModulatorState[]): ModulationHost {
  return {
    modulators: mods,
    addModulator: () => mods[0],
    removeModulator: () => {},
    setConnection: () => {},
    removeConnection: () => {},
  } as unknown as ModulationHost;
}

function destOptionValues(container: HTMLElement): string[] {
  const sel = container.querySelector<HTMLSelectElement>('.mod-dest-select');
  if (!sel) throw new Error('destination select not found');
  return [...sel.options].map((o) => o.value);
}

describe('modulator destination picker', () => {
  it('offers params of an insert added after the panel was rendered', () => {
    const items: unknown[] = [];
    const mod: ModulatorState = {
      id: 'lfo1', kind: 'lfo', enabled: true, connections: [],
    } as unknown as ModulatorState;

    const container = document.createElement('div');
    renderModulatorsPanel(container, {
      engineId: 'subtractive',
      laneId: 'poly1',
      host: fakeHost([mod]),
      registry: new Map(),
      registerKnob: () => {},
      onChange: () => {},
      laneInserts: fakeChain(items),
    });

    expect(destOptionValues(container)).not.toContain('lane-insert-0:cutoff');

    // User adds a filter insert to the lane while the panel stays mounted.
    items.push(fakeInsert(['cutoff', 'resonance']));

    const sel = container.querySelector<HTMLSelectElement>('.mod-dest-select')!;
    sel.dispatchEvent(new Event('pointerdown'));

    expect(destOptionValues(container)).toContain('lane-insert-0:cutoff');
    expect(destOptionValues(container)).toContain('lane-insert-0:resonance');
  });

  it('keeps the current selection across a refresh', () => {
    const items: unknown[] = [fakeInsert(['cutoff', 'resonance'])];
    const mod: ModulatorState = {
      id: 'lfo1', kind: 'lfo', enabled: true, connections: [],
    } as unknown as ModulatorState;

    const container = document.createElement('div');
    renderModulatorsPanel(container, {
      engineId: 'subtractive',
      laneId: 'poly1',
      host: fakeHost([mod]),
      registry: new Map(),
      registerKnob: () => {},
      onChange: () => {},
      laneInserts: fakeChain(items),
    });

    const sel = container.querySelector<HTMLSelectElement>('.mod-dest-select')!;
    sel.value = 'lane-insert-0:resonance';
    sel.dispatchEvent(new Event('pointerdown'));

    expect(sel.value).toBe('lane-insert-0:resonance');
  });
});
