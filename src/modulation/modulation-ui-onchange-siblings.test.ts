// @vitest-environment jsdom
// Regression test for the "modulator change wipes the whole lane editor" bug
// (worklet-lane-engine.ts / drums-worklet-engine.ts / sampler-worklet-engine.ts,
// introduced 2026-07-18 in 1010b63). Their `onChange` used to do
// `container.innerHTML = ''; this.buildParamUI(container, ctx)`. Because
// session-host-lane-editor.ts (injectEngineModulatorPanel) appends the note-FX
// panel and the lane insert rack into that SAME `container` AFTER
// buildParamUI() returns, wiping the whole container on every modulator/
// connection add-remove destroyed those siblings until the lane editor was
// closed and reopened.
//
// The fix: onChange now re-renders ONLY the modulators panel by calling
// renderModulatorsPanel(container, deps) again, which (per modulation-ui.ts)
// replaces just the `.mod-panel` node it owns and leaves the rest of
// `container` untouched. This test drives the REAL renderModulatorsPanel
// through a real "+ LFO" button click — the same host.addModulator() + onChange()
// path a user triggers by adding/removing a modulator or a connection — and
// mirrors the self-referencing `modDeps` object the three engines build, not
// a mock of the re-render logic.
import { describe, it, expect } from 'vitest';
import { renderModulatorsPanel, type ModulationUIDeps } from './modulation-ui';
import type { ModulationHost, ModulatorState } from './types';

function fakeHost(mods: ModulatorState[]): ModulationHost {
  return {
    modulators: mods,
    addModulator: (kind: 'lfo' | 'adsr') => {
      const m = { id: 'lfo1', kind, enabled: true, connections: [] } as unknown as ModulatorState;
      mods.push(m);
      return m;
    },
    removeModulator: () => {},
    setConnection: () => {},
    removeConnection: () => {},
  } as unknown as ModulationHost;
}

describe('onChange-triggered modulator panel re-render (worklet-engine pattern)', () => {
  it('leaves a sibling panel appended to the same host intact', () => {
    const mods: ModulatorState[] = [];
    const container = document.createElement('div');
    const sibling = document.createElement('div');
    sibling.className = 'lane-notefx-panel-host';
    sibling.textContent = 'note-fx panel';
    container.appendChild(sibling);

    // Mirrors the self-referencing `modDeps` object the three worklet engines
    // build in buildParamUI(): onChange re-renders THIS panel only, via the
    // same `renderModulatorsPanel(container, modDeps)` call.
    const deps: ModulationUIDeps = {
      engineId: 'subtractive', laneId: 'poly1', host: fakeHost(mods),
      registry: new Map(), registerKnob: () => {},
      onChange: () => { renderModulatorsPanel(container, deps); },
    } as ModulationUIDeps;

    renderModulatorsPanel(container, deps);
    expect(container.querySelector('.lane-notefx-panel-host')).not.toBeNull();

    // Trigger the "+ LFO" button: host.addModulator('lfo') then deps.onChange() —
    // the exact path a user hits adding a modulator (same shape as removing one
    // or adding/removing a connection: they all end in `sync(deps); deps.onChange();`).
    const addLfoBtn = [...container.querySelectorAll('button')]
      .find((b) => b.textContent === '+ LFO')!;
    addLfoBtn.click();

    expect(container.querySelector('.lane-notefx-panel-host')).not.toBeNull();
    expect(container.querySelectorAll('.mod-panel').length).toBe(1);
  });
});
