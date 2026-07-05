/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { buildEngineParamGrid } from './engine-param-grid';
import type { EngineParamSpec } from './engine-params';
import type { EngineUIContext } from './engine-types';

function stubEngine(params: EngineParamSpec[]) {
  const state = new Map(params.map((p) => [p.id, p.default] as const));
  return {
    id: 'stub', params,
    getBaseValue: (id: string) => state.get(id) ?? 0,
    setBaseValue: (id: string, v: number) => { state.set(id, v); },
  };
}

function ctx(): EngineUIContext {
  const reg = new Map<string, unknown>();
  return { laneId: 'L', registerKnob: (k: unknown) => reg.set(String(reg.size), k), registry: reg } as unknown as EngineUIContext;
}

const cont = (id: string, group?: string): EngineParamSpec =>
  ({ id, label: id, kind: 'continuous', min: 0, max: 1, default: 0.5, group });

describe('buildEngineParamGrid', () => {
  it('renders one labelled section per group plus a leading global row', () => {
    const parent = document.createElement('div');
    buildEngineParamGrid(stubEngine([
      cont('feedback'), cont('op1.ratio', 'OP1'), cont('op1.level', 'OP1'), cont('op2.ratio', 'OP2'),
    ]), ctx(), parent);

    const sections = parent.querySelectorAll('.poly-section');
    expect(sections.length).toBe(2);                                   // OP1, OP2
    expect(sections[0].querySelector('.section-label')?.textContent).toBe('OP1');
    expect(sections[1].querySelector('.section-label')?.textContent).toBe('OP2');
    // Leading global (ungrouped) row exists and holds the ungrouped knob.
    const globalRow = parent.querySelector(':scope > .knob-row');
    expect(globalRow).not.toBeNull();
    expect(globalRow!.querySelectorAll('.knob').length).toBe(1);       // feedback
    // OP1 section holds its two knobs.
    expect(sections[0].querySelectorAll('.knob').length).toBe(2);
  });

  it('renders a discrete dropdown spec as a <select>, not a knob', () => {
    const parent = document.createElement('div');
    const algo: EngineParamSpec = {
      id: 'algorithm', label: 'Algorithm', kind: 'discrete', min: 0, max: 1, default: 0,
      selectStyle: 'dropdown',
      options: [{ value: '0', label: 'A' }, { value: '1', label: 'B' }],
    };
    buildEngineParamGrid(stubEngine([algo]), ctx(), parent);
    expect(parent.querySelector('select.select-control')).not.toBeNull();
    expect(parent.querySelector('.knob')).toBeNull();
  });

  it('renders a discrete spec WITHOUT selectStyle: dropdown as a knob, not a <select>', () => {
    const parent = document.createElement('div');
    const wave: EngineParamSpec = {
      id: 'osc.wave', label: 'WAVE', kind: 'discrete', min: 0, max: 2, default: 0,
      options: [{ value: 'sine', label: 'Sine' }, { value: 'square', label: 'Square' }, { value: 'saw', label: 'Saw' }],
    };
    buildEngineParamGrid(stubEngine([wave]), ctx(), parent);
    expect(parent.querySelector('.knob')).not.toBeNull();
    expect(parent.querySelector('select')).toBeNull();
  });

  it('skips params matching opts.skip', () => {
    const parent = document.createElement('div');
    buildEngineParamGrid(stubEngine([cont('poly.voices'), cont('feedback')]), ctx(), parent,
      { skip: (id) => id.startsWith('poly.') });
    expect(parent.querySelectorAll('.knob').length).toBe(1);           // only feedback
  });
});
