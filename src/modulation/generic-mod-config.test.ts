// src/modulation/generic-mod-config.test.ts
// @vitest-environment jsdom
//
// The panel a plugin modulator actually gets: a component that declares
// `params` but brings no hand-built `configTemplate` (the only route open to
// a plugin — its compiled main.js cannot import our bundled lit-html). One
// control per declared param, reading/writing ModulatorState.params, the
// numeric bag added in this same task.

import { describe, it, expect } from 'vitest';
import { render } from 'lit-html';
import { genericModConfigTemplate } from './generic-mod-config';
import { ControlCache } from '../core/control-cache';
import type { ModulatorComponent } from './modulator-registry';
import type { ModulatorState, ModulatorVoice } from './types';
import type { PanelCtx } from './mod-ui-shared';
import { makeHost, makeDeps, knobHandleById } from './modulation-ui.test-helpers';

const shStub: ModulatorComponent = {
  id: 'sh', name: 'S&H', driver: 'time', scopes: ['shared', 'per-voice'], idPrefix: 'sh',
  defaultState: (id): ModulatorState => ({ id, kind: 'sh', enabled: true, connections: [], scope: 'shared' }),
  createVoice: (): ModulatorVoice => ({
    output: {} as AudioNode, trigger: () => {}, release: () => {}, dispose: () => {}, currentValue: () => 0,
  }),
};

function renderTemplate(comp: ModulatorComponent, mod: ModulatorState) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const cache = new ControlCache();
  const deps = makeDeps(makeHost([mod]));
  const ctx: PanelCtx = { deps, cache, rerender: () => {} };
  cache.beginPass();
  render(genericModConfigTemplate(comp, mod, ctx), container);
  cache.endPass();
  return { container, deps, ctx };
}

describe('genericModConfigTemplate', () => {
  it('builds a control per declared param and writes into the modulator params bag', () => {
    const comp: ModulatorComponent = { ...shStub, params: [
      { id: 'rate', label: 'Rate', kind: 'continuous', min: 0.1, max: 20, default: 6 },
    ] };
    const mod = comp.defaultState('sh1');
    const { deps } = renderTemplate(comp, mod);

    const knob = knobHandleById(deps, 'bass.mod.sh1.rate');
    expect(knob).toBeTruthy();
    knob!.setValue(9);

    expect(mod.params?.rate).toBe(9);
  });

  it('pushes the edit live through sync (onLiveEdit), or the worklet never hears it', () => {
    const comp: ModulatorComponent = { ...shStub, params: [
      { id: 'rate', label: 'Rate', kind: 'continuous', min: 0.1, max: 20, default: 6 },
    ] };
    const mod = comp.defaultState('sh1');
    const { deps } = renderTemplate(comp, mod);

    knobHandleById(deps, 'bass.mod.sh1.rate')!.setValue(9);
    expect(deps.onLiveEdit).toHaveBeenCalled();
  });

  it('reads the bag before falling back to the spec default', () => {
    const comp: ModulatorComponent = { ...shStub, params: [
      { id: 'rate', label: 'Rate', kind: 'continuous', min: 0.1, max: 20, default: 6 },
    ] };
    const mod = comp.defaultState('sh1');
    mod.params = { rate: 12 };
    const { deps } = renderTemplate(comp, mod);

    // The knob was constructed with the bag's value (12), not the spec
    // default (6) — read back through its own rendered value text, since the
    // handle exposes no getValue().
    const text = knobHandleById(deps, 'bass.mod.sh1.rate')!.el.querySelector('.knob-value-text')?.textContent;
    expect(text).toBe('12.00');
  });

  it('stores a discrete param as an option INDEX, never its string value', () => {
    const comp: ModulatorComponent = { ...shStub, params: [
      { id: 'shape', label: 'Shape', kind: 'discrete', min: 0, max: 1, default: 0,
        options: [{ value: 'square', label: 'Square' }, { value: 'random', label: 'Random' }] },
    ] };
    const mod = comp.defaultState('sh1');
    // Driven through the select-control's own registered handle rather than
    // its DOM shape (radio strip vs native <select>) — both register a
    // KnobHandle whose setValue takes the same numeric index.
    const { deps } = renderTemplate(comp, mod);
    const handle = knobHandleById(deps, 'bass.mod.sh1.shape')!;
    handle.setValue(1);   // index 1 = 'random'

    expect(mod.params?.shape).toBe(1);
    expect(typeof mod.params?.shape).toBe('number');
  });

  it('builds an empty grid when the component declares no params', () => {
    const mod = shStub.defaultState('sh1');
    const { container } = renderTemplate(shStub, mod);
    expect(container.querySelector('.mod-generic-config')?.children.length).toBe(0);
  });
});
