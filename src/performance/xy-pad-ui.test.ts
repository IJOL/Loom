// @vitest-environment jsdom
// The XY pad's two axis dropdowns must offer every destination the SESSION
// declares, not whatever knobs happen to be mounted (a lane whose editor was
// never opened is invisible to the knob registry; a deleted insert's knob
// never leaves it). See destination-registry.ts's header for the two bugs
// this replaces.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createXyPad, type XyPadUIDeps } from './xy-pad-ui';
import { createDestinationRegistry } from '../automation/destination-registry';
import { applyAutomationToSession } from '../automation/automation-apply';
import { registerPlugin, _resetRegistry } from '../plugins/registry';
import { multifilterPlugin } from '../plugins/fx/multifilter';
import type { SessionState } from '../session/session';
import type { KnobHandle } from '../core/knob';
// Side-effect import: registers the 'subtractive' engine descriptor so
// listAutomationTargets() can find its continuous engine params. Without
// this, getEngine('subtractive') returns undefined and the catalogue would
// silently offer zero engine params — the same trap documented in
// modulation-ui-dest-refresh.test.ts (an unregistered id fails silently, not
// loudly), which would let the 'poly1.' assertion below pass or fail for the
// wrong reason.
import '../engines/subtractive';

// A real registered fx plugin, not a bare pluginId string — listAutomationTargets
// silently returns [] for an unregistered plugin id (see fxParams() in
// automation-targets.ts), so tests using `pluginId: 'multifilter'` need it
// actually registered or their assertions would pass/fail for the wrong reason.
beforeEach(() => {
  _resetRegistry();
  registerPlugin(multifilterPlugin);
});
afterEach(() => { _resetRegistry(); });

function stateWith(inserts: { id: string; pluginId: string }[] = []): SessionState {
  return {
    lanes: [{ id: 'poly1', name: 'Sub 1', engineId: 'subtractive', clips: [], inserts }],
    masterInserts: [], sends: [],
  } as unknown as SessionState;
}

function fakeSurfaceRect(el: HTMLElement): void {
  // jsdom has no layout engine — getBoundingClientRect() always reports all
  // zeros, which would divide-by-zero the pad's nx/ny math. Stub a 100x100
  // square anchored at the origin so a click at (x, y) maps to normalized
  // position (x/100, y/100) directly.
  el.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0, toJSON() {} });
}

// jsdom does not implement pointer capture (Element.prototype.setPointerCapture
// throws "not a function") — stub it as a no-op so dispatching a real
// pointerdown on the surface doesn't blow up inside the pad's own listener.
function stubPointerCapture(el: HTMLElement): void {
  (el as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};
  (el as unknown as { releasePointerCapture: () => void }).releasePointerCapture = () => {};
}

describe('xy pad target dropdowns', () => {
  it('offers session destinations, not leftover registry keys', () => {
    const state = stateWith();
    // A knob for a lane the session no longer has — the old code offered this.
    const stale = new Map([['ghost.cutoff', { meta: { min: 0, max: 1 }, setValue: () => {} }]]);

    const pad = createXyPad({
      destinations: createDestinationRegistry({
        getState: () => state, getKnobRegistry: () => new Map(),
      }),
      registry: stale as never,
      formatLabel: (id) => id,
    });
    pad.refreshOptions();

    const values = [...pad.el.querySelectorAll('option')].map((o) => (o as HTMLOptionElement).value);
    expect(values).not.toContain('ghost.cutoff');
    expect(values.some((v) => v.startsWith('poly1.'))).toBe(true);
  });

  it('groups by the catalogue laneName, not a first-dot split of the id', () => {
    // A master-rack destination id (`fx.master.fx:<slot>.<param>`) has TWO
    // leading dots. The deleted laneOf() split on the FIRST dot and would have
    // produced the bogus group "fx" instead of "Master".
    const state = {
      lanes: [],
      masterInserts: [{ id: 'slot-m', pluginId: 'multifilter', params: {}, bypass: false }],
      sends: [],
    } as unknown as SessionState;

    const pad = createXyPad({
      destinations: createDestinationRegistry({ getState: () => state, getKnobRegistry: () => new Map() }),
      registry: new Map() as never,
      formatLabel: (id) => id,
    });
    pad.refreshOptions();

    const groupLabels = [...pad.el.querySelectorAll('optgroup')].map((g) => g.label);
    expect(groupLabels).toContain('Master');
    expect(groupLabels).not.toContain('fx');
  });

  it('drives a target through its mounted knob when one exists', () => {
    const state = stateWith();
    const setValue = vi.fn();
    const registry = new Map<string, KnobHandle>([
      ['poly1.filter.cutoff', { meta: { id: 'poly1.filter.cutoff', label: 'Cutoff', min: 0, max: 1000 }, setValue } as unknown as KnobHandle],
    ]);

    const pad = createXyPad({
      destinations: createDestinationRegistry({ getState: () => state, getKnobRegistry: () => registry }),
      registry,
      formatLabel: (id) => id,
    });
    pad.setState({ x: 'poly1.filter.cutoff', y: null });

    const surface = pad.el.querySelector('.xy-surface') as HTMLElement;
    fakeSurfaceRect(surface);
    stubPointerCapture(surface);
    surface.dispatchEvent(new PointerEvent('pointerdown', { clientX: 50, clientY: 50, pointerId: 1, bubbles: true }));

    expect(setValue).toHaveBeenCalledWith(500); // nx=0.5 → 0 + 0.5*(1000-0)
  });

  it('drives a target with NO mounted knob through the unmounted fallback', () => {
    // The regression this task exists to prevent: reading destinations from
    // the catalogue means the dropdown now offers params whose lane editor
    // was never opened, so no knob for them exists in `registry`. Dragging the
    // pad on such a target must still land the value — via the same
    // applyAutomationToSession fallback automation-tick.ts uses for playback
    // envelopes — not silently no-op.
    const state = stateWith();
    const vals: Record<string, number> = { 'filter.cutoff': 0 };
    const fakeEngine = { getBaseValue: (id: string) => vals[id] ?? 0, setBaseValue: (id: string, v: number) => { vals[id] = v; } };

    const destinations = createDestinationRegistry({ getState: () => state, getKnobRegistry: () => new Map() });
    const deps: XyPadUIDeps = {
      destinations,
      registry: new Map(), // EMPTY — no knob mounted for poly1.filter.cutoff
      formatLabel: (id) => id,
      applyUnmounted: (paramId, normalised, ranges) => {
        applyAutomationToSession(paramId, normalised, {
          getInsertFx: () => undefined,
          getEngine: (laneId) => (laneId === 'poly1' ? fakeEngine : undefined),
          getRange: (id) => ranges.get(id),
        });
      },
    };
    const pad = createXyPad(deps);
    pad.setState({ x: 'poly1.filter.cutoff', y: null });

    const surface = pad.el.querySelector('.xy-surface') as HTMLElement;
    fakeSurfaceRect(surface);
    stubPointerCapture(surface);
    surface.dispatchEvent(new PointerEvent('pointerdown', { clientX: 25, clientY: 0, pointerId: 1, bubbles: true }));

    // nx = 0.25. filter.cutoff's declared range (subtractive-params.ts) is
    // min:0 max:1, so the landed value should be exactly 0.25 — proving the
    // fallback actually ran (not just "not zero", which a stray write could
    // also satisfy).
    expect(vals['filter.cutoff']).toBeCloseTo(0.25, 5);
  });

  it('subscribes to the registry so an insert added while open shows up', () => {
    let state = stateWith();
    const destinations = createDestinationRegistry({ getState: () => state, getKnobRegistry: () => new Map() });
    const pad = createXyPad({ destinations, registry: new Map() as never, formatLabel: (id) => id });

    let values = [...pad.el.querySelectorAll('option')].map((o) => (o as HTMLOptionElement).value);
    expect(values.some((v) => v.includes('fx:slot-a'))).toBe(false);

    state = stateWith([{ id: 'slot-a', pluginId: 'multifilter' }]);
    destinations.invalidate();

    values = [...pad.el.querySelectorAll('option')].map((o) => (o as HTMLOptionElement).value);
    expect(values.some((v) => v.includes('fx:slot-a'))).toBe(true);
  });

  it('does not accumulate subscriptions past what destroy() releases', () => {
    const state = stateWith();
    const destinations = createDestinationRegistry({ getState: () => state, getKnobRegistry: () => new Map() });
    const pad = createXyPad({ destinations, registry: new Map() as never, formatLabel: (id) => id });

    const listSpy = vi.spyOn(destinations, 'list');
    destinations.invalidate();
    expect(listSpy).toHaveBeenCalledTimes(1); // refreshOptions() calls list() once

    pad.destroy();
    listSpy.mockClear();
    destinations.invalidate();
    expect(listSpy).not.toHaveBeenCalled(); // unsubscribed — no more rebuilds
  });
});
