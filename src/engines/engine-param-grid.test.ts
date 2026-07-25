/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { buildEngineParamGrid } from './engine-param-grid';
import { withoutParamMirror } from '../session/session-engine-state';
import type { EngineParamSpec } from './engine-params';
import type { EngineUIContext } from './engine-types';
import type { KnobHandle } from '../core/knob';
import type { SessionState } from '../session/session';

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

// ── The mirror: engineState.params is the ONLY vehicle by which a knob value
// reaches a save, so a builder that forgets it silently throws the edit away.
const oneLane = (laneId: string): SessionState =>
  ({ lanes: [{ id: laneId, engineId: 'fm', clips: [], inserts: [] }] }) as unknown as SessionState;

function mirroringCtx(sessionState: SessionState) {
  const reg = new Map<string, KnobHandle>();
  const ctxObj = {
    laneId: 'L',
    registerKnob: (k: KnobHandle) => reg.set(k.meta.id ?? String(reg.size), k),
    registry: reg,
    sessionState,
  } as unknown as EngineUIContext;
  return { ctx: ctxObj, reg };
}

const paramsOf = (state: SessionState) => state.lanes[0].engineState?.params;

describe('buildEngineParamGrid mirrors into sessionState', () => {
  it('a knob edit lands in engineState.params under the canonical registry id', () => {
    const state = oneLane('L');
    const { ctx: c, reg } = mirroringCtx(state);
    const spec = cont('filter.cutoff');
    buildEngineParamGrid(stubEngine([spec]), c, document.createElement('div'));

    // The registered id must stay `<laneId>.<spec.id>` — destination-registry
    // consumers (modulation/automation pickers) address knobs by it.
    const handle = reg.get('L.filter.cutoff');
    expect(handle, 'the grid stopped registering under <laneId>.<spec.id>').toBeDefined();

    handle!.setValue(spec.default + (spec.max - spec.default) / 2);

    const mirrored = paramsOf(state)?.['filter.cutoff'];
    expect(mirrored, 'the knob edit never reached engineState.params').toBeDefined();
    expect(mirrored).not.toBe(spec.default);
  });

  it('a dropdown pick lands in engineState.params too', () => {
    const state = oneLane('L');
    const { ctx: c } = mirroringCtx(state);
    const algo: EngineParamSpec = {
      id: 'algorithm', label: 'Algorithm', kind: 'discrete', min: 0, max: 1, default: 0,
      selectStyle: 'dropdown',
      options: [{ value: '0', label: 'A' }, { value: '1', label: 'B' }],
    };
    const parent = document.createElement('div');
    buildEngineParamGrid(stubEngine([algo]), c, parent);

    const sel = parent.querySelector('select.select-control') as HTMLSelectElement;
    sel.value = '1';
    sel.dispatchEvent(new Event('change'));

    const mirrored = paramsOf(state)?.['algorithm'];
    expect(mirrored, 'the dropdown pick never reached engineState.params').toBeDefined();
    expect(mirrored).not.toBe(algo.default);
  });

  it('a programmatic refresh does not overwrite the value the user mirrored', () => {
    const state = oneLane('L');
    const { ctx: c, reg } = mirroringCtx(state);
    const spec = cont('filter.cutoff');
    buildEngineParamGrid(stubEngine([spec]), c, document.createElement('div'));
    const handle = reg.get('L.filter.cutoff')!;

    handle.setValue(spec.default + (spec.max - spec.default) / 2);
    const afterEdit = paramsOf(state)!['filter.cutoff'];

    // A preset recall drives every mounted knob through the SAME setValue a
    // user drag does (knob-mounting.refreshLaneKnobs). Without the guard, a
    // load would overwrite the params it had only just restored.
    withoutParamMirror(() => handle.setValue(spec.min));

    expect(paramsOf(state)!['filter.cutoff']).toBe(afterEdit);
  });
});
