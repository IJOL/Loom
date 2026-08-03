/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { buildEngineParamGrid } from './engine-param-grid';
import { withoutParamMirror } from '../session/session-engine-state';
import type { EngineParamSpec } from './engine-params';
import type { EngineUIContext } from './engine-types';
import type { KnobHandle } from '../core/knob';
import type { SessionState } from '../session/session';
import type { EngineParamGroup } from './engine-param-groups';
import { FILTER_MODE_OPTIONS, TYPE_OPTIONS_BY_MODE } from '../audio-dsp/filter-kinds';

function stubEngine(params: EngineParamSpec[], groups?: EngineParamGroup[]) {
  const state = new Map(params.map((p) => [p.id, p.default] as const));
  return {
    id: 'stub', params, groups,
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

  // Task 8b: the knob branch for discrete params is GONE. Every discrete spec
  // renders through createSelectControl — a vertical strip at ≤4 options, a
  // native <select> above that — on EVERY surface, whether or not it opts
  // into a `selectStyle`. 'radio' is retired (it was the old opt-in for this
  // exact behaviour, now the only behaviour); only 'dropdown' still means
  // anything, as a force.
  it('renders a discrete spec with ≤4 options and no selectStyle as a radio strip, not a knob (grouped layout)', () => {
    const parent = document.createElement('div');
    const wave: EngineParamSpec = {
      id: 'osc.wave', label: 'WAVE', kind: 'discrete', min: 0, max: 2, default: 0,
      options: [{ value: 'sine', label: 'Sine' }, { value: 'square', label: 'Square' }, { value: 'saw', label: 'Saw' }],
    };
    buildEngineParamGrid(stubEngine([wave]), ctx(), parent);
    expect(parent.querySelector('.knob')).toBeNull();
    expect(parent.querySelector('.radio-strip')).not.toBeNull();
    // Fix round 2: the compact modifier is what makes it vertical/50px — it
    // must come from THIS path (a param control), not leak from elsewhere.
    // See select-control.test.ts and modulation-ui.test.ts for the boundary
    // this pins on the other side (the modulator-config panel stays plain).
    expect(parent.querySelector('.radio-strip')!.classList.contains('radio-strip--compact')).toBe(true);
  });

  it('renders a discrete spec with >4 options and no selectStyle as a native <select>, not a knob (grouped layout)', () => {
    const parent = document.createElement('div');
    const wave: EngineParamSpec = {
      id: 'osc1.wave', label: 'Wave', kind: 'discrete', min: 0, max: 4, default: 0,
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

  it("selectStyle: 'dropdown' forces a native <select> even at 2 options (grouped layout)", () => {
    const parent = document.createElement('div');
    const algo: EngineParamSpec = {
      id: 'algorithm', label: 'Algorithm', kind: 'discrete', min: 0, max: 1, default: 0,
      selectStyle: 'dropdown',
      options: [{ value: '0', label: 'A' }, { value: '1', label: 'B' }],
    };
    buildEngineParamGrid(stubEngine([algo]), ctx(), parent);
    expect(parent.querySelector('.knob')).toBeNull();
    expect(parent.querySelector('.radio-strip')).toBeNull();
    expect(parent.querySelector('select.select-control')).not.toBeNull();
  });

  it('no discrete param, at any option count or selectStyle, ever produces a .knob element — grouped or flat', () => {
    const dropdownSpec: EngineParamSpec = { ...discreteSpec('d'), selectStyle: 'dropdown' };
    const twoOptionSpec: EngineParamSpec = {
      ...discreteSpec('b'),
      options: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }],
    };
    const fiveOptionSpec: EngineParamSpec = {
      id: 'c', label: 'C', kind: 'discrete', min: 0, max: 4, default: 0,
      options: [0, 1, 2, 3, 4].map((n) => ({ value: String(n), label: String(n) })),
    };
    const specs = [discreteSpec('a'), twoOptionSpec, fiveOptionSpec, dropdownSpec];

    for (const layout of ['grouped', 'flat'] as const) {
      const parent = document.createElement('div');
      buildEngineParamGrid(stubEngine(specs), ctx(), parent, layout === 'flat' ? { layout } : {});
      expect(parent.querySelector('.knob'), `layout ${layout} drew a discrete param as a knob`).toBeNull();
    }
  });

  // The regression this pins: every discrete control lost its `.knob-label`-
  // equivalent when the whole engine grid switched from knobs to select
  // controls, while every continuous knob beside it kept its own label. This
  // asserts the fix would FAIL against the pre-fix code, where buildControl
  // passed `showLabel: spec.showLabel` (undefined ⇒ off) straight through.
  it('a discrete param with no showLabel still shows its name (grouped layout)', () => {
    const parent = document.createElement('div');
    buildEngineParamGrid(stubEngine([discreteSpec('osc.wave')]), ctx(), parent);
    const labeled = parent.querySelector('.select-labeled');
    expect(labeled, 'discrete control never wrapped in the captioned .select-labeled').not.toBeNull();
    expect(labeled!.querySelector('.ctl-label')?.textContent).toBe('OSC.WAVE');
    // The label wraps the actual control (the radio strip) rather than
    // replacing it.
    expect(labeled!.querySelector('.radio-strip')).not.toBeNull();
  });

  it('a discrete param with no showLabel still shows its name (flat layout)', () => {
    const host = document.createElement('div');
    buildEngineParamGrid(stubEngine([discreteSpec('osc.wave')]), ctx(), host, { layout: 'flat' });
    const labeled = host.querySelector('.select-labeled');
    expect(labeled).not.toBeNull();
    expect(labeled!.querySelector('.ctl-label')?.textContent).toBe('OSC.WAVE');
  });

  it('a native <select> discrete param (>4 options) also gets the caption by default', () => {
    const parent = document.createElement('div');
    const wave: EngineParamSpec = {
      id: 'osc1.wave', label: 'Osc1 Wave', kind: 'discrete', min: 0, max: 4, default: 0,
      options: [
        { value: 'sine', label: 'Sine' }, { value: 'tri', label: 'Tri' }, { value: 'saw', label: 'Saw' },
        { value: 'square', label: 'Square' }, { value: 'pulse', label: 'Pulse' },
      ],
    };
    buildEngineParamGrid(stubEngine([wave]), ctx(), parent);
    const labeled = parent.querySelector('.select-labeled');
    expect(labeled).not.toBeNull();
    expect(labeled!.querySelector('.ctl-label')?.textContent).toBe('Osc1 Wave');
    expect(labeled!.querySelector('select.select-control')).not.toBeNull();
  });

  it('an explicit showLabel: false still suppresses the caption', () => {
    const parent = document.createElement('div');
    buildEngineParamGrid(stubEngine([discreteSpec('osc.wave', { showLabel: false })]), ctx(), parent);
    expect(parent.querySelector('.select-labeled')).toBeNull();
    expect(parent.querySelector('.radio-strip')).not.toBeNull();
  });

  it('an explicit showLabel: true keeps working as before (e.g. CHOKE)', () => {
    const parent = document.createElement('div');
    buildEngineParamGrid(stubEngine([discreteSpec('chokeGroup', { showLabel: true })]), ctx(), parent);
    const labeled = parent.querySelector('.select-labeled');
    expect(labeled).not.toBeNull();
    expect(labeled!.querySelector('.ctl-label')?.textContent).toBe('CHOKEGROUP');
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

  it('renders a discrete spec with >4 options as a native <select>, not a knob or a strip', () => {
    const host = document.createElement('div');
    const wave: EngineParamSpec = {
      id: 'osc1.wave', label: 'Wave', kind: 'discrete', min: 0, max: 4, default: 0,
      options: [
        { value: 'sine', label: 'Sine' }, { value: 'tri', label: 'Tri' }, { value: 'saw', label: 'Saw' },
        { value: 'square', label: 'Square' }, { value: 'pulse', label: 'Pulse' },
      ],
    };
    buildEngineParamGrid(stubEngine([wave]), ctx(), host, { layout: 'flat' });
    expect(host.querySelector('.knob')).toBeNull();
    expect(host.querySelector('.radio-strip')).toBeNull();
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
    const engine = stubEngine(
      [cont('osc1.level', 'osc1'), cont('osc2.level', 'osc2')],
      [{ id: 'osc1', title: 'OSC 1', row: 0 }, { id: 'osc2', title: 'OSC 2', row: 0 }],
    );
    buildEngineParamGrid(engine, ctx(), parent);

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
    ], [{ id: 'osc1', title: 'OSC 1', color: '#2ee0c0' }]);
    buildEngineParamGrid(engine, ctx(), parent);

    const strokes = [...parent.querySelectorAll('.knob-value')].map((e) => (e as SVGElement).style.stroke);
    expect(strokes[0]).toBe('#2ee0c0');
    expect(strokes[1]).toBe('#ff0000');
  });

  it('does not draw a param owned by another surface', () => {
    const parent = document.createElement('div');
    buildEngineParamGrid(
      stubEngine(
        [cont('osc1.level', 'osc1'), { ...cont('amp.attack', 'amp'), drawnBy: 'modulators' }],
        [{ id: 'osc1', title: 'OSC 1' }, { id: 'amp', title: 'AMP' }],
      ),
      ctx(), parent);

    expect([...parent.querySelectorAll('.section-label')].map((e) => e.textContent)).toEqual(['OSC 1']);
  });
});

describe('buildEngineParamGrid — a control whose options depend on another param', () => {
  it('builds a derived control from the table, not a function', () => {
    // The manifest of a plugin is JSON: it cannot carry `build`. The grid must
    // read the SAME derivation from data, or Subtractive cannot be a plugin.
    const specs: EngineParamSpec[] = [
      { id: 'filter.model', label: 'Mode', kind: 'discrete', min: 0, max: 3, default: 1,
        options: FILTER_MODE_OPTIONS, group: 'filter' },
      { id: 'filter.type', label: 'Type', kind: 'discrete', min: 0, max: 3, default: 0,
        options: TYPE_OPTIONS_BY_MODE['0'],
        optionsFrom: { paramId: 'filter.model', table: TYPE_OPTIONS_BY_MODE },
        group: 'filter' },
    ];
    const host = document.createElement('div');
    buildEngineParamGrid(stubEngine(specs), ctx(), host, {});

    // Rendered controls carry no `data-param` hook, so the Type control is
    // found by its `.ctl-label` caption, exactly like the test below.
    const typeLabel = [...host.querySelectorAll('.ctl-label')].find((el) => el.textContent === 'Type');
    const typeWrap = typeLabel!.closest('.select-labeled')!;
    // Mode 1 (MOG) offers three taps, not the four DIG offers. Relative
    // assertion: the derived list must differ in length from the static one.
    expect(typeWrap.querySelectorAll('button, option').length)
      .toBe(TYPE_OPTIONS_BY_MODE['1'].length);
    expect(TYPE_OPTIONS_BY_MODE['1'].length)
      .toBeLessThan(TYPE_OPTIONS_BY_MODE['0'].length);
  });

  it("builds a dependent control's options from the param it derives from", () => {
    // The filter Type offers only the taps the chosen Mode has. Built at
    // mode 1 (MOG), the strip must have three buttons, not four.
    // Rendered controls carry no `data-param` hook (createSelectControl /
    // select-control.ts), so the Type control is found by its `.ctl-label`
    // caption text instead, matching how a real user would locate it.
    const engine = stubEngine([
      { id: 'filter.model', label: 'Mode', kind: 'discrete', min: 0, max: 3, default: 1,
        options: FILTER_MODE_OPTIONS },
      { id: 'filter.type', label: 'Type', kind: 'discrete', min: 0, max: 3, default: 0,
        options: TYPE_OPTIONS_BY_MODE['0'], optionsFrom: { paramId: 'filter.model', table: TYPE_OPTIONS_BY_MODE } },
    ]);
    const host = document.createElement('div');
    buildEngineParamGrid(engine, ctx(), host, {});

    const typeLabel = [...host.querySelectorAll('.ctl-label')].find((el) => el.textContent === 'Type');
    const typeWrap = typeLabel!.closest('.select-labeled')!;
    const typeButtons = typeWrap.querySelectorAll('button, option');
    expect(typeButtons.length).toBe(3);
  });

  it('fires rebuildParamUI on a REAL click of the source control, and only that control', () => {
    // The static-options test above only proves the LIST is right at a fixed
    // mode; it says nothing about the trigger line in buildControl's onChange
    // (`if (engine.params.some(s => s.optionsFrom?.paramId === spec.id))
    // ctx.rebuildParamUI?.()`). Drive it through an actual DOM click on the
    // rendered Mode button — both Mode and Type are radio strips (≤4 options)
    // — with rebuildParamUI wired to really wipe-and-rebuild the same host,
    // the same contract session-host-lane-editor.ts's own rebuild gives it,
    // so this proves the Type strip repaints live, not just that a callback
    // fired. The negative half (a control nothing derives from) is what stops
    // the trigger line degenerating into "rebuild on every write".
    const engine = stubEngine([
      { id: 'filter.model', label: 'Mode', kind: 'discrete', min: 0, max: 2, default: 0,
        options: FILTER_MODE_OPTIONS },
      { id: 'filter.type', label: 'Type', kind: 'discrete', min: 0, max: 3, default: 0,
        options: TYPE_OPTIONS_BY_MODE['0'], optionsFrom: { paramId: 'filter.model', table: TYPE_OPTIONS_BY_MODE } },
      discreteSpec('other.discrete', { label: 'Other' }),
    ]);
    const host = document.createElement('div');
    let c: EngineUIContext;
    const build = () => { host.innerHTML = ''; buildEngineParamGrid(engine, c, host, {}); };
    const rebuildSpy = vi.fn(build);
    c = { ...ctx(), rebuildParamUI: rebuildSpy };
    build();   // initial render, NOT through the spy

    const buttonsUnder = (label: string): HTMLButtonElement[] => {
      const el = [...host.querySelectorAll('.ctl-label')].find((n) => n.textContent === label)!;
      return [...el.closest('.select-labeled')!.querySelectorAll<HTMLButtonElement>('button')];
    };
    expect(buttonsUnder('Type').length).toBe(4);   // DIG: lp/hp/bp/notch

    // A control nothing derives its options from: no rebuild.
    buttonsUnder('Other')[1].click();
    expect(rebuildSpy).not.toHaveBeenCalled();

    // Mode -> MOG (three taps, not four). The click must repaint Type live.
    buttonsUnder('Mode')[1].click();
    expect(rebuildSpy).toHaveBeenCalledTimes(1);
    expect(buttonsUnder('Type').length).toBe(3);
  });
});
