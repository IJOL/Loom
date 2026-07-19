// @vitest-environment jsdom
// The destination dropdown of an EXISTING modulator must offer the params of
// an insert added AFTER the panel was rendered, and it must do so by reading
// the ONE shared DestinationRegistry (Task 4/6) instead of scraping a live
// InsertChain itself. The registry is a REAL registered fx plugin
// (multifilterPlugin), not a bare pluginId string — listAutomationTargets
// silently returns [] for an unregistered plugin id (see fxParams() in
// automation-targets.ts), so asserting against an unregistered id would pass
// or fail for reasons unrelated to this module.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderModulatorsPanel, type ModulationUIDeps } from './modulation-ui';
import { createDestinationRegistry } from '../automation/destination-registry';
import { registerPlugin, _resetRegistry } from '../plugins/registry';
import { multifilterPlugin } from '../plugins/fx/multifilter';
import type { SessionState } from '../session/session';
import type { ModulationHost, ModulatorState } from './types';

function stateWith(inserts: { id: string; pluginId: string }[]): SessionState {
  return {
    lanes: [{
      id: 'poly1', name: 'Sub 1', engineId: 'subtractive', clips: [],
      inserts: inserts.map((i) => ({ ...i, params: {}, bypass: false })),
    }],
    masterInserts: [], sends: [],
  } as unknown as SessionState;
}

function fakeHost(mods: ModulatorState[]): ModulationHost {
  return {
    modulators: mods,
    addModulator: () => mods[0], removeModulator: () => {},
    setConnection: () => {}, removeConnection: () => {},
  } as unknown as ModulationHost;
}

function destValues(container: HTMLElement): string[] {
  const sel = container.querySelector<HTMLSelectElement>('.mod-dest-select')!;
  return [...sel.options].map((o) => o.value);
}

beforeEach(() => {
  _resetRegistry();
  registerPlugin(multifilterPlugin);
});

afterEach(() => { _resetRegistry(); });

describe('modulator destination picker', () => {
  it('offers an insert added after the panel was rendered', () => {
    let state = stateWith([]);
    const destinations = createDestinationRegistry({
      getState: () => state, getKnobRegistry: () => new Map(),
    });
    const mod = { id: 'lfo1', kind: 'lfo', enabled: true, connections: [] } as unknown as ModulatorState;

    const container = document.createElement('div');
    renderModulatorsPanel(container, {
      engineId: 'subtractive', laneId: 'poly1', host: fakeHost([mod]),
      registry: new Map(), registerKnob: () => {}, onChange: () => {},
      destinations,
    } as ModulationUIDeps);

    expect(destValues(container).some((v) => v.startsWith('poly1.fx:'))).toBe(false);

    state = stateWith([{ id: 'slot-a', pluginId: 'multifilter' }]);
    destinations.invalidate();

    expect(destValues(container).some((v) => v.startsWith('poly1.fx:slot-a.'))).toBe(true);
  });

  it('does not touch sibling panels appended to the same container', () => {
    // renderModulatorsPanel appends its own `.mod-panel`; session-host-lane-editor
    // appends the note-FX panel + the lane-insert panel to the SAME host element.
    // A rebuild triggered by the registry must replace only the mod-panel it owns.
    let state = stateWith([]);
    const destinations = createDestinationRegistry({
      getState: () => state, getKnobRegistry: () => new Map(),
    });
    const mod = { id: 'lfo1', kind: 'lfo', enabled: true, connections: [] } as unknown as ModulatorState;

    const container = document.createElement('div');
    const sibling = document.createElement('div');
    sibling.className = 'lane-notefx-panel-host';
    sibling.textContent = 'note-fx panel';
    container.appendChild(sibling);

    renderModulatorsPanel(container, {
      engineId: 'subtractive', laneId: 'poly1', host: fakeHost([mod]),
      registry: new Map(), registerKnob: () => {}, onChange: () => {},
      destinations,
    } as ModulationUIDeps);

    expect(container.querySelector('.lane-notefx-panel-host')).not.toBeNull();

    state = stateWith([{ id: 'slot-a', pluginId: 'multifilter' }]);
    destinations.invalidate();

    // The rebuild happened (the new insert is now offered)...
    expect(destValues(container).some((v) => v.startsWith('poly1.fx:slot-a.'))).toBe(true);
    // ...but the sibling the caller owns is still there, untouched.
    expect(container.querySelector('.lane-notefx-panel-host')).not.toBeNull();
    expect(container.querySelectorAll('.mod-panel').length).toBe(1);
  });

  it('a rebuild does not accumulate destination subscriptions', () => {
    // The panel is rebuilt in place by wiping+rebuilding its host in a bunch of
    // places across the codebase (48 `innerHTML = ''` call sites). That destroys
    // DOM but not a previously-registered subscription. If renderModulatorsPanel
    // subscribed unconditionally, N renders of the SAME container would leave N
    // live listeners, and one invalidate() would redraw N times instead of once.
    let state = stateWith([]);
    const destinations = createDestinationRegistry({
      getState: () => state, getKnobRegistry: () => new Map(),
    });
    const mod = { id: 'lfo1', kind: 'lfo', enabled: true, connections: [] } as unknown as ModulatorState;
    const container = document.createElement('div');
    const deps = {
      engineId: 'subtractive', laneId: 'poly1', host: fakeHost([mod]),
      registry: new Map(), registerKnob: () => {}, onChange: () => {},
      destinations,
    } as ModulationUIDeps;

    for (let i = 0; i < 5; i++) renderModulatorsPanel(container, deps);

    const listSpy = vi.spyOn(destinations, 'list');
    destinations.invalidate();

    // Each full render calls destinations.list() exactly once (one modulator ⇒
    // one routing-list ⇒ one buildDestOptions call). Five accumulated
    // subscriptions would show up as five calls here.
    expect(listSpy).toHaveBeenCalledTimes(1);
  });
});
