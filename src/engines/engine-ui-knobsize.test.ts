/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { wireEngineParams } from './engine-ui';
import type { SynthEngine, EngineUIContext } from './engine-types';

function stubEngine(): SynthEngine {
  return {
    id: 'x', name: 'X', type: 'mono', polyphony: 'mono', editor: 'piano-roll',
    params: [{ id: 'a.b', label: 'AB', kind: 'continuous', min: 0, max: 1, default: 0.5 }],
    getBaseValue: () => 0.5, setBaseValue: () => {}, getAudioParams: () => new Map(),
    createVoice: () => ({} as never), buildSequencer: () => ({} as never), buildParamUI: () => {},
  } as unknown as SynthEngine;
}

function ctx(parent: HTMLElement): EngineUIContext {
  const reg = new Map<string, unknown>();
  return {
    laneId: 'L', registerKnob: (k: unknown) => reg.set('k', k), registry: reg,
  } as unknown as EngineUIContext;
}

describe('wireEngineParams knobSize', () => {
  it('passes knobSize to the rendered knob SVG', () => {
    const parent = document.createElement('div');
    wireEngineParams(stubEngine(), ctx(parent), parent, { knobSize: 30 });
    const svg = parent.querySelector('svg.knob-svg') as SVGSVGElement;
    expect(svg.getAttribute('width')).toBe('30');
  });
});
