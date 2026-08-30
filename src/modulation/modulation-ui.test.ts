// @vitest-environment jsdom
//
// Characterisation tests for the modulators panel, written against the CURRENT
// imperative implementation before migrating it to lit-html templates. They
// must pass unmodified afterwards — that is the whole point. Do not weaken one
// to make a refactor go green.
//
// Visibility is asserted semantically (see isVisible) and controls are found by
// `title` rather than text, so the migration can change the hiding mechanism and
// the markup without any assertion needing a rewrite.

import { describe, it, expect, beforeEach } from 'vitest';
import { renderModulatorsPanel } from './modulation-ui';
import { makeDefaultLFO } from '../plugins/modulators/lfo';
import { makeDefaultADSR } from '../plugins/modulators/adsr';
import { registerModulator } from './modulator-registry';
import type { ModulatorComponent } from './modulator-registry';
import type { ModulatorState, ModulatorVoice } from './types';
import {
  makeHost, makeDeps, makeDestinations, target,
  isVisible, byText, byTitle, knobByLabel, knobHandleById,
  destOptionValues, destGroupLabels,
} from './modulation-ui.test-helpers';

// A fake THIRD kind, registered here (not at module scope) — vitest isolates
// modules per file, so this file's registry already holds only 'lfo'/'adsr'
// (from the side-effect imports above) plus whatever this test file itself
// registers. It deliberately brings no configTemplate, matching the shape a
// generic-grid modulator (e.g. the real future S&H) would have.
const shStub: ModulatorComponent = {
  id: 'sh', name: 'S&H', driver: 'time', scopes: ['shared', 'per-voice'], idPrefix: 'sh',
  defaultState: (id): ModulatorState => ({ id, kind: 'sh', enabled: true, connections: [], scope: 'shared' }),
  createVoice: (): ModulatorVoice => ({
    output: {} as AudioNode, trigger: () => {}, release: () => {}, dispose: () => {}, currentValue: () => 0,
  }),
};
registerModulator(shStub);

let container: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.appendChild(container);
});

// A component that brings its own DOM config — the shape a PLUGIN modulator
// with a custom editor (the step sequencer) takes: no lit-html, just a root
// element and a tiny read/write api over the numeric bag.
const seqStub: ModulatorComponent = {
  id: 'seq', name: 'Seq', driver: 'time', scopes: ['shared'], idPrefix: 'seq',
  defaultState: (id): ModulatorState => ({
    id, kind: 'seq', enabled: true, connections: [], scope: 'shared', params: { rate: 4 },
  }),
  createVoice: (): ModulatorVoice => ({
    output: {} as AudioNode, trigger: () => {}, release: () => {}, dispose: () => {}, currentValue: () => 0,
  }),
  configMount: (root, api) => {
    root.classList.add('seq-ui');
    const b = document.createElement('button');
    b.title = 'bump';
    b.addEventListener('click', () => api.set('step0', api.get('step0', 0) + 1));
    root.appendChild(b);
  },
};
registerModulator(seqStub);

describe('plugin config mount', () => {
  it("mounts the component's own DOM instead of the generic grid", () => {
    const host = makeHost([seqStub.defaultState('seq1')]);
    renderModulatorsPanel(container, makeDeps(host));
    expect(container.querySelector('.mod-card.mod-seq .seq-ui')).not.toBeNull();
    expect(container.querySelector('.mod-card.mod-seq .mod-generic-config')).toBeNull();
  });

  it('api.set writes the bag and reaches the live engine; the root survives a repaint', () => {
    const mod = seqStub.defaultState('seq1');
    const host = makeHost([mod]);
    const deps = makeDeps(host);
    renderModulatorsPanel(container, deps);
    const root1 = container.querySelector('.seq-ui');
    (byTitle(container, 'button', 'bump') as HTMLButtonElement).click();
    expect(mod.params?.step0).toBe(1);
    expect(deps.onLiveEdit).toHaveBeenCalled();
    // A repaint must hand back the SAME mounted element — remounting mid-drag
    // is the exact failure the weave panel already taught us about.
    renderModulatorsPanel(container, deps);
    expect(container.querySelector('.seq-ui')).toBe(root1);
  });
});

describe('modulators panel', () => {
  it('renders one card per modulator in the host', () => {
    const host = makeHost([makeDefaultLFO('lfo1'), makeDefaultADSR('adsr1')]);
    renderModulatorsPanel(container, makeDeps(host));
    expect(container.querySelectorAll('.mod-card')).toHaveLength(2);
    expect(container.querySelectorAll('.mod-card.mod-lfo')).toHaveLength(1);
    expect(container.querySelectorAll('.mod-card.mod-adsr')).toHaveLength(1);
  });

  it('renders the panel title', () => {
    renderModulatorsPanel(container, makeDeps(makeHost()));
    expect(container.querySelector('.mod-panel-title')?.textContent?.trim())
      .toBe('MODULATORS');
  });

  it('+ LFO adds an lfo modulator, is audible, and asks the engine to rebuild', () => {
    const host = makeHost();
    const deps = makeDeps(host);
    renderModulatorsPanel(container, deps);
    byText(container, 'button', '+ LFO').click();
    expect(host.addModulator).toHaveBeenCalledWith('lfo');
    expect(deps.onLiveEdit).toHaveBeenCalled();
    expect(deps.onChange).toHaveBeenCalled();
  });

  it('+ ADSR adds an adsr modulator', () => {
    const host = makeHost();
    const deps = makeDeps(host);
    renderModulatorsPanel(container, deps);
    byText(container, 'button', '+ ADSR').click();
    expect(host.addModulator).toHaveBeenCalledWith('adsr');
    expect(deps.onLiveEdit).toHaveBeenCalled();
  });

  it('offers a + button for every registered modulator, not a hardcoded pair', () => {
    const deps = makeDeps(makeHost());
    renderModulatorsPanel(container, deps);
    const labels = [...container.querySelectorAll('.mod-panel-header button')]
      .map((b) => b.textContent?.trim());
    expect(labels).toContain('+ S&H');
  });

  it('the card × button removes that modulator', () => {
    const host = makeHost([makeDefaultLFO('lfo1')]);
    const deps = makeDeps(host);
    renderModulatorsPanel(container, deps);
    byText(container.querySelector('.mod-card-row')!, 'button', '×').click();
    expect(host.removeModulator).toHaveBeenCalledWith('lfo1');
    expect(deps.onChange).toHaveBeenCalled();
  });

  it('ON/OFF toggles enabled, its label and its primary class', () => {
    const mod = makeDefaultLFO('lfo1');
    const deps = makeDeps(makeHost([mod]));
    renderModulatorsPanel(container, deps);

    expect(byText(container, 'button', 'ON').classList.contains('primary')).toBe(true);

    byText(container, 'button', 'ON').click();
    expect(mod.enabled).toBe(false);
    expect(deps.onLiveEdit).toHaveBeenCalled();
    expect(byText(container, 'button', 'OFF').classList.contains('primary')).toBe(false);
  });

  it('FREE shows RATE and hides BARS; SYNC does the inverse', () => {
    const mod = makeDefaultLFO('lfo1');   // syncToBpm: false
    const deps = makeDeps(makeHost([mod]));
    renderModulatorsPanel(container, deps);

    expect(isVisible(knobByLabel(container, 'RATE'))).toBe(true);
    expect(isVisible(container.querySelector<HTMLElement>('.mod-bars'))).toBe(false);

    byText(container, 'button', 'FREE').click();
    expect(mod.syncToBpm).toBe(true);
    expect(deps.onLiveEdit).toHaveBeenCalled();

    expect(isVisible(knobByLabel(container, 'RATE'))).toBe(false);
    expect(isVisible(container.querySelector<HTMLElement>('.mod-bars'))).toBe(true);
    expect(byText(container, 'button', 'SYNC')).toBeTruthy();
  });

  it('the merged RETRIG control reads the modulator\'s scope + trigger', () => {
    // TRIG (free/note) and SCOPE (shared/per-voice) are one 3-way strip:
    // Free / Note = shared with that retrigger; Voice = per-voice. Nothing hides,
    // so the row never reflows — but the ACTIVE segment must reflect state.
    const active = (root: ParentNode) =>
      [...root.querySelectorAll<HTMLElement>('.mod-card.mod-lfo .radio-btn.active')]
        .map((b) => b.getAttribute('title'));

    const voice = makeDefaultLFO('lfo1');
    voice.scope = 'per-voice';
    renderModulatorsPanel(container, makeDeps(makeHost([voice])));
    // All three segments are present and none is hidden.
    expect(byTitle(container, '.radio-btn', 'Free')).toBeTruthy();
    expect(byTitle(container, '.radio-btn', 'Note')).toBeTruthy();
    expect(isVisible(byTitle(container, '.radio-btn', 'Voice'))).toBe(true);
    expect(active(container)).toContain('Voice');

    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);

    const noteMod = makeDefaultLFO('lfo2');
    noteMod.trigger = 'note';
    renderModulatorsPanel(container, makeDeps(makeHost([noteMod])));
    expect(active(container)).toContain('Note');
  });

  it('picking a RETRIG segment sets scope/trigger and is audible', () => {
    const wave = makeDefaultLFO('lfo1');
    const deps = makeDeps(makeHost([wave]));
    renderModulatorsPanel(container, deps);
    const card = container.querySelector('.mod-card.mod-lfo')!;

    // WAVE still renders as titled glyph buttons (empty text, an SVG inside).
    expect(byTitle(card, '.radio-btn', 'Sine').textContent?.trim()).toBe('');
    expect(byTitle(card, '.radio-btn', 'Sine').querySelector('svg')).toBeTruthy();
    byTitle(card, '.radio-btn', 'Tri').click();
    expect(wave.waveform).toBe('triangle');
    expect(deps.onLiveEdit).toHaveBeenCalled();

    // Voice → per-voice scope, and it rebuilds the engine (respawns voices).
    byTitle(card, '.radio-btn', 'Voice').click();
    expect(wave.scope).toBe('per-voice');
    expect(deps.onChange).toHaveBeenCalled();

    // Note → shared + note retrigger. A pure trigger change is audible but needs
    // no engine rebuild, so it does not fire onChange on its own.
    const noteMod = makeDefaultLFO('lfo2');
    const deps2 = makeDeps(makeHost([noteMod]));
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    renderModulatorsPanel(container, deps2);
    byTitle(container, '.mod-card.mod-lfo .radio-btn', 'Note').click();
    expect(noteMod.scope).toBe('shared');
    expect(noteMod.trigger).toBe('note');
    expect(deps2.onLiveEdit).toHaveBeenCalled();
    // The whole point of the asymmetry: a pure Free↔Note change (scope stays
    // shared) reaches the worklet via onLiveEdit and must NOT trigger an engine
    // rebuild. Only a scope change does.
    expect(deps2.onChange).not.toHaveBeenCalled();
  });

  // Task 8b fix round 2: the compact/vertical radio-strip modifier is for
  // param-editing surfaces ONLY (buildControl, the FX insert rack). It leaked
  // here once — the base .radio-strip briefly WAS the vertical shape — and
  // stretched the LFO card, whose strips (WAVE, POLARITY, RETRIG) lay out in
  // a horizontal row. This pins the boundary from the other side of it.
  it('the LFO card\'s radio strips (WAVE, POLARITY, RETRIG) stay the base horizontal shape, not compact', () => {
    renderModulatorsPanel(container, makeDeps(makeHost([makeDefaultLFO('lfo1')])));
    const strips = container.querySelectorAll('.mod-card.mod-lfo .radio-strip');
    expect(strips.length).toBeGreaterThan(0);
    for (const strip of strips) {
      expect(strip.classList.contains('radio-strip--compact'),
        `${strip.querySelector('.radio-btn')?.getAttribute('title')} strip must not opt into the compact param-control modifier`)
        .toBe(false);
    }
  });

  it('registers every control under a lane-scoped .mod. param id', () => {
    const deps = makeDeps(makeHost([makeDefaultLFO('lfo1')]));
    renderModulatorsPanel(container, deps);
    const ids = (deps.registerKnob as unknown as { mock: { calls: Array<[{ meta: { id?: string } }]> } })
      .mock.calls.map(([k]) => k.meta.id!);
    expect(ids).toContain('bass.mod.lfo1.rate');
    expect(ids).toContain('bass.mod.lfo1.waveform');
    expect(ids.every((id) => id.startsWith('bass.mod.lfo1.'))).toBe(true);
  });

  // ---- destination dropdown: reads the one shared catalogue --------------

  it('lists destinations from the registry, grouped by lane name', () => {
    const deps = makeDeps(makeHost([makeDefaultLFO('lfo1')]));
    renderModulatorsPanel(container, deps);

    expect(destOptionValues(container)).toContain('bass.filter.cutoff');
    expect(destOptionValues(container)).toContain('fx.master.fx:c1.mix');
    expect(destGroupLabels(container)).toEqual(['TB-303 1', 'Master']);
  });

  it('offers only targets this lane\'s binder can reach — no other lane, no send rack', () => {
    // The per-lane binder only ever resolves THIS lane's params, this lane's
    // insert chain and the master chain. Offering anything else would create a
    // connection that looks fine and silently never binds.
    const deps = makeDeps(makeHost([makeDefaultLFO('lfo1')]));
    renderModulatorsPanel(container, deps);

    expect(destOptionValues(container)).not.toContain('lead.filter.cutoff');
    expect(destOptionValues(container)).not.toContain('fx.send.a.fx:s1.mix');
  });

  it('omits destinations already connected', () => {
    const mod = makeDefaultLFO('lfo1');
    mod.connections = [{ id: 'c1', paramId: 'bass.filter.cutoff', depth: 0.5 }];
    renderModulatorsPanel(container, makeDeps(makeHost([mod])));

    expect(destOptionValues(container)).not.toContain('bass.filter.cutoff');
    expect(destOptionValues(container)).toContain('bass.filter.resonance');
  });

  it('+ Destination connects the selected param at depth 0.5', () => {
    const host = makeHost([makeDefaultLFO('lfo1')]);
    const deps = makeDeps(host);
    renderModulatorsPanel(container, deps);

    container.querySelector<HTMLSelectElement>('.mod-dest-select')!.value = 'bass.filter.resonance';
    byText(container, 'button', '+ Destination').click();

    expect(host.setConnection).toHaveBeenCalledWith('lfo1', expect.objectContaining({
      paramId: 'bass.filter.resonance',
      depth: 0.5,
    }));
    expect(deps.onLiveEdit).toHaveBeenCalled();
    expect(deps.onChange).toHaveBeenCalled();
  });

  it('an existing connection renders a row with its param label and a working ×', () => {
    const mod = makeDefaultLFO('lfo1');
    mod.connections = [{ id: 'c1', paramId: 'bass.filter.cutoff', depth: 0.5 }];
    const host = makeHost([mod]);
    const deps = makeDeps(host);
    renderModulatorsPanel(container, deps);

    const row = container.querySelector('.mod-conn-row')!;
    expect(row.querySelector('.mod-conn-target')?.textContent?.trim()).toBe('bass.filter.cutoff');
    expect(knobHandleById(deps, 'bass.mod.lfo1.conn.c1.depth')).toBeTruthy();

    byText(row, 'button', '×').click();
    expect(host.removeConnection).toHaveBeenCalledWith('lfo1', 'c1');
    expect(deps.onLiveEdit).toHaveBeenCalled();
  });

  // ---- registry subscription lifecycle ----------------------------------

  it('refreshes when the destination registry announces a change', () => {
    const destinations = makeDestinations();
    renderModulatorsPanel(container, makeDeps(makeHost([makeDefaultLFO('lfo1')]), { destinations }));

    expect(destOptionValues(container)).not.toContain('bass.fx:new.mix');

    destinations.setTargets([...destinations.list(), target('bass.fx:new.mix', 'bass', 'TB-303 1', 'New')]);
    destinations.invalidate();

    expect(destOptionValues(container)).toContain('bass.fx:new.mix');
  });

  it('keeps exactly one live subscription per container across repeated renders', () => {
    // Rebuilds destroy DOM but not subscriptions. Without the abort-the-previous
    // discipline these stack, and one registry change fans out into N rebuilds.
    const destinations = makeDestinations();
    const deps = makeDeps(makeHost([makeDefaultLFO('lfo1')]), { destinations });

    renderModulatorsPanel(container, deps);
    renderModulatorsPanel(container, deps);
    renderModulatorsPanel(container, deps);

    expect(destinations.listenerCount()).toBe(1);
  });

  it('leaves sibling panels in the container untouched when it re-renders', () => {
    // session-host-lane-editor appends the note-FX and insert racks to the SAME
    // container after buildParamUI returns. A registry-driven refresh must not
    // wipe them.
    const destinations = makeDestinations();
    renderModulatorsPanel(container, makeDeps(makeHost([makeDefaultLFO('lfo1')]), { destinations }));

    const sibling = document.createElement('div');
    sibling.className = 'note-fx-rack';
    container.appendChild(sibling);

    destinations.invalidate();

    expect(container.querySelector('.note-fx-rack')).toBe(sibling);
    expect(container.querySelectorAll('.mod-panel')).toHaveLength(1);
  });
});
