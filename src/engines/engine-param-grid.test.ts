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

/** A ctx whose registry is keyed by the canonical `<laneId>.<spec.id>` — the id
 *  destination-registry consumers address a control by. */
function idKeyedCtx(): { ctx: EngineUIContext; reg: Map<string, KnobHandle> } {
  const reg = new Map<string, KnobHandle>();
  const c = {
    laneId: 'L',
    registerKnob: (k: KnobHandle) => reg.set(k.meta.id ?? String(reg.size), k),
    registry: reg,
  } as unknown as EngineUIContext;
  return { ctx: c, reg };
}

const cont = (id: string, group?: string): EngineParamSpec =>
  ({ id, label: id, kind: 'continuous', min: 0, max: 1, default: 0.5, group });

const discreteSpec = (id: string, extra: Partial<EngineParamSpec> = {}): EngineParamSpec => ({
  id, label: id.toUpperCase(), kind: 'discrete', min: 0, max: 2, default: 0,
  options: [{ value: 'sine', label: 'Sine' }, { value: 'square', label: 'Square' }, { value: 'saw', label: 'Saw' }],
  ...extra,
});

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

  // Regression: the grouped branch used to test only `selectStyle === 'dropdown'`,
  // so a param declaring 'radio' (Subtractive's Osc1/Osc2 Wave, Filter Model,
  // Filter Type) fell through to the knob path and silently became a knob on
  // the grouped worklet-lane pages — even though 'flat' callers (the drum rack,
  // the sampler pads) always honoured it correctly. No existing test asserted
  // the CONTROL TYPE for a radio-declared param in the grouped layout, which is
  // exactly why it shipped broken.
  it("renders a discrete spec with selectStyle: 'radio' as a radio strip, not a knob", () => {
    const parent = document.createElement('div');
    const model: EngineParamSpec = {
      id: 'filter.model', label: 'Model', kind: 'discrete', min: 0, max: 2, default: 0,
      selectStyle: 'radio',
      options: [{ value: 'lp', label: 'LP' }, { value: 'hp', label: 'HP' }, { value: 'bp', label: 'BP' }],
    };
    buildEngineParamGrid(stubEngine([model]), ctx(), parent);
    expect(parent.querySelector('.knob')).toBeNull();
    expect(parent.querySelector('.radio-strip')).not.toBeNull();
  });

  it('a discrete spec declaring no selectStyle still renders as a knob (radio must not become the new default)', () => {
    const parent = document.createElement('div');
    buildEngineParamGrid(stubEngine([discreteSpec('env.shape')]), ctx(), parent);
    expect(parent.querySelector('.knob')).not.toBeNull();
    expect(parent.querySelector('.radio-strip')).toBeNull();
    expect(parent.querySelector('select')).toBeNull();
  });

  it("renders a discrete spec with selectStyle: 'radio' and >4 options as a native <select>, matching createSelectControl's own rule", () => {
    const parent = document.createElement('div');
    const wave: EngineParamSpec = {
      id: 'osc1.wave', label: 'Wave', kind: 'discrete', min: 0, max: 4, default: 0,
      selectStyle: 'radio',
      options: [
        { value: 'sine', label: 'Sine' }, { value: 'tri', label: 'Tri' }, { value: 'saw', label: 'Saw' },
        { value: 'square', label: 'Square' }, { value: 'pulse', label: 'Pulse' },
      ],
    };
    buildEngineParamGrid(stubEngine([wave]), ctx(), parent);
    expect(parent.querySelector('.knob')).toBeNull();
    expect(parent.querySelector('.radio-strip')).toBeNull();
    expect(parent.querySelector('select.select-control')).not.toBeNull();
  });

  it('skips params matching opts.skip', () => {
    const parent = document.createElement('div');
    buildEngineParamGrid(stubEngine([cont('poly.voices'), cont('feedback')]), ctx(), parent,
      { skip: (id) => id.startsWith('poly.') });
    expect(parent.querySelectorAll('.knob').length).toBe(1);           // only feedback
  });
});

// ── Options absorbed from the deleted wireEngineParams. The grid is now the one
// spec-walking builder, so it has to be able to paint what the other one painted.
describe('buildEngineParamGrid — knobSize and formatter', () => {
  it('knobSize sizes the rendered knob SVG, smaller than the default', () => {
    const sized = document.createElement('div');
    const def = document.createElement('div');
    buildEngineParamGrid(stubEngine([cont('a.b')]), ctx(), sized, { knobSize: 30 });
    buildEngineParamGrid(stubEngine([cont('a.b')]), ctx(), def);
    const widthOf = (host: HTMLElement) =>
      Number((host.querySelector('svg.knob-svg') as SVGSVGElement).getAttribute('width'));
    expect(widthOf(sized)).toBe(30);                       // the size asked for, not a magnitude
    expect(widthOf(sized)).toBeLessThan(widthOf(def));
  });

  it('a formatter wins over spec.unit for the value readout', () => {
    const host = document.createElement('div');
    const spec: EngineParamSpec = { ...cont('osc.detune'), unit: '¢' };
    buildEngineParamGrid(stubEngine([spec]), ctx(), host,
      { formatter: (id, v) => `${id}:${Math.round(v * 100)}` });
    const text = host.querySelector('.knob-value-text')!.textContent!;
    expect(text).toContain('osc.detune:');
    expect(text).not.toContain('¢');
  });
});

// ── layout:'flat' is the shape the drum rack, the sampler pads, the audio-clip
// toolbar and the subtractive page have always had. Their look is approved; the
// grouped layout must NOT leak into them.
describe("buildEngineParamGrid layout:'flat'", () => {
  it('appends the controls straight into the container, with no row wrapper', () => {
    const host = document.createElement('div');
    buildEngineParamGrid(stubEngine([cont('a'), cont('b', 'GRP')]), ctx(), host, { layout: 'flat' });
    expect(host.querySelector('.knob-row')).toBeNull();
    expect(host.querySelector('.poly-section')).toBeNull();
    expect(host.querySelectorAll(':scope > .knob').length).toBe(2);   // both, groups ignored
  });

  it('renders a discrete spec with no selectStyle as a select control, not a knob', () => {
    const host = document.createElement('div');
    buildEngineParamGrid(stubEngine([discreteSpec('osc.wave')]), ctx(), host, { layout: 'flat' });
    expect(host.querySelector('.radio-strip')).not.toBeNull();
    expect(host.querySelector('.knob')).toBeNull();
  });

  it("still honours selectStyle: 'dropdown' with a native <select>", () => {
    const host = document.createElement('div');
    buildEngineParamGrid(stubEngine([discreteSpec('algorithm', { selectStyle: 'dropdown' })]),
      ctx(), host, { layout: 'flat' });
    expect(host.querySelector('select.select-control')).not.toBeNull();
  });

  it('leaves the drag unquantised, unlike the grouped grid', () => {
    // knob.ts quantises with Math.round(v / step) * step — from ZERO, not from
    // min — so a step over a wide range (the sampler's 20..20000 cutoff) would
    // move the low end below its own minimum. The flat callers never had one.
    const spec = cont('filter.cutoff');
    const between = spec.min + (spec.max - spec.min) * 0.5031;   // off the grouped step grid
    const run = (opts: Parameters<typeof buildEngineParamGrid>[3]) => {
      const engine = stubEngine([spec]);
      const { ctx: c, reg } = idKeyedCtx();
      buildEngineParamGrid(engine, c, document.createElement('div'), opts);
      reg.get('L.filter.cutoff')!.setValue(between);
      return engine.getBaseValue(spec.id);
    };
    expect(run({ layout: 'flat' })).toBe(between);
    expect(run({})).not.toBe(between);                            // grouped snaps it
  });

  it('does not paint spec.unit, unlike the grouped grid', () => {
    // Visual parity, not an oversight: a drum-rack knob is 34px and a sampler
    // zone knob 30px, and both have always shown a bare number. The declared
    // unit ('Hz', 'st') is painted only where the knobs are full size.
    const withUnit = (): EngineParamSpec => ({ ...cont('startFreq'), unit: 'Hz' });
    const flat = document.createElement('div');
    const grouped = document.createElement('div');
    buildEngineParamGrid(stubEngine([withUnit()]), ctx(), flat, { layout: 'flat' });
    buildEngineParamGrid(stubEngine([withUnit()]), ctx(), grouped);
    expect(flat.querySelector('.knob-value-text')!.textContent).not.toContain('Hz');
    expect(grouped.querySelector('.knob-value-text')!.textContent).toContain('Hz');
  });

  it('registers under the same <laneId>.<spec.id> the grouped grid uses', () => {
    const { ctx: c, reg } = idKeyedCtx();
    buildEngineParamGrid(stubEngine([cont('filter.cutoff'), discreteSpec('osc.wave')]),
      c, document.createElement('div'), { layout: 'flat' });
    expect(reg.has('L.filter.cutoff')).toBe(true);
    expect(reg.has('L.osc.wave')).toBe(true);
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

// ── Declared groups (Task 4): the grid now renders resolveParamRows' output
// instead of bucketing by spec.group itself.
describe('buildEngineParamGrid — declared groups', () => {
  it('renders two declared groups on one row, divider between them', () => {
    const parent = document.createElement('div');
    const engine = stubEngine([cont('osc1.level', 'osc1'), cont('osc2.level', 'osc2')]);
    buildEngineParamGrid(engine, ctx(), parent, {
      groups: [{ id: 'osc1', title: 'OSC 1', row: 0 }, { id: 'osc2', title: 'OSC 2', row: 0 }],
    });

    const rows = parent.querySelectorAll('.poly-section');
    expect(rows.length).toBe(1);
    expect([...rows[0].querySelectorAll('.section-label')].map((e) => e.textContent))
      .toEqual(['OSC 1', 'OSC 2']);
    expect(rows[0].querySelectorAll('.vert-divider').length).toBe(1);
  });

  it('paints the group colour on its knobs, and a param colour still wins', () => {
    const parent = document.createElement('div');
    const engine = stubEngine([
      cont('osc1.level', 'osc1'),
      { ...cont('osc1.detune', 'osc1'), color: '#ff0000' },
    ]);
    buildEngineParamGrid(engine, ctx(), parent, { groups: [{ id: 'osc1', title: 'OSC 1', color: '#2ee0c0' }] });

    const strokes = [...parent.querySelectorAll('.knob-value')].map((e) => (e as SVGElement).style.stroke);
    expect(strokes[0]).toBe('#2ee0c0');
    expect(strokes[1]).toBe('#ff0000');
  });

  it('does not draw a param owned by another surface', () => {
    const parent = document.createElement('div');
    buildEngineParamGrid(
      stubEngine([cont('osc1.level', 'osc1'), { ...cont('amp.attack', 'amp'), drawnBy: 'modulators' }]),
      ctx(), parent, { groups: [{ id: 'osc1', title: 'OSC 1' }, { id: 'amp', title: 'AMP' }] });

    expect([...parent.querySelectorAll('.section-label')].map((e) => e.textContent)).toEqual(['OSC 1']);
  });
});
