// @vitest-environment jsdom
// Right-click a knob → jump to (or create) its automation. This is the menu +
// wiring layer on top of two already-tested pure pieces: resolveAutomationTarget
// (Task 3, decides WHERE) and addClipEnvelope (Task 2, creates a clip envelope).
// This file proves the menu CONTENTS match the decision and that selecting an
// item performs the right side effect.
//
// Setup copied verbatim from modulation-ui-dest-refresh.test.ts: the destination
// catalogue is derived from the SessionState via a REAL registered fx plugin
// (multifilterPlugin) and a REAL engine module import — listAutomationTargets
// silently returns [] for an unregistered plugin id, and getEngine() returns
// undefined for an engine module never imported, so skipping either of these
// would make every assertion here pass or fail for the wrong reason.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { attachKnobAutomationMenu } from './knob-automation-menu';
import { createKnob } from '../core/knob';
import { createDestinationRegistry } from './destination-registry';
import { registerPlugin, _resetRegistry } from '../plugins/registry';
import { multifilterPlugin } from '../plugins/fx/multifilter';
import { emptyArrangementState } from '../performance/performance';
import type { SessionState, SessionClip } from '../session/session';
// Side-effect import: registers the 'subtractive' engine descriptor so
// listAutomationTargets() can find its continuous engine params. Without this,
// getEngine('subtractive') returns undefined and the catalogue would silently
// offer zero engine params.
import '../engines/subtractive';

function rightClick(el: Element): void {
  el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
}
const menuItems = () =>
  [...document.querySelectorAll('.context-menu-item')].map((li) => ({
    text: (li.textContent ?? '').trim(),
    disabled: li.classList.contains('disabled'),
  }));

beforeEach(() => {
  _resetRegistry();
  registerPlugin(multifilterPlugin);
});

afterEach(() => { _resetRegistry(); document.body.innerHTML = ''; });

describe('attachKnobAutomationMenu', () => {
  it('offers the playing clip by name, and creates the envelope on select', () => {
    const clip = { id: 'c2', name: 'Chorus', lengthBars: 1, notes: [] } as unknown as SessionClip;
    const state = {
      lanes: [{ id: 'poly1', name: 'Sub 1', engineId: 'subtractive',
                clips: [{ id: 'c1', name: 'Verse', lengthBars: 1, notes: [] }, clip],
                inserts: [] }],
      masterInserts: [], sends: [],
    } as unknown as SessionState;

    const handle = createKnob({ id: 'poly1.filter.cutoff', label: 'CUTOFF',
      min: 0, max: 1, value: 0.5, onChange: () => {} });
    document.body.appendChild(handle.el);

    attachKnobAutomationMenu(handle, {
      destinations: createDestinationRegistry({ getState: () => state, getKnobRegistry: () => new Map() }),
      getMode: () => 'session',
      getState: () => state,
      getLaneStates: () => new Map([['poly1', { laneId: 'poly1', playing: clip } as never]]),
      getArrangement: () => emptyArrangementState(120),
      openClip: () => {},
      addTimelineCurve: () => {},
      onClipEdited: () => {},
    });

    rightClick(handle.el);
    expect(menuItems()[0].text).toContain('Chorus');   // names the PLAYING clip, not the first

    (document.querySelector('.context-menu-item') as HTMLElement).click();
    expect(clip.envelopes?.map((e) => e.paramId)).toEqual(['poly1.filter.cutoff']);
  });

  it('opens no menu for a control that is not a destination', () => {
    const state = {
      lanes: [{ id: 'poly1', name: 'Sub 1', engineId: 'subtractive',
                clips: [{ id: 'c1', name: 'Verse', lengthBars: 1, notes: [] }],
                inserts: [] }],
      masterInserts: [], sends: [],
    } as unknown as SessionState;

    const handle = createKnob({ id: 'poly1.mod.lfo1.rate', label: 'RATE',
      min: 0, max: 1, value: 0.5, onChange: () => {} });
    document.body.appendChild(handle.el);

    attachKnobAutomationMenu(handle, {
      destinations: createDestinationRegistry({ getState: () => state, getKnobRegistry: () => new Map() }),
      getMode: () => 'session',
      getState: () => state,
      getLaneStates: () => new Map(),
      getArrangement: () => emptyArrangementState(120),
      openClip: () => {},
      addTimelineCurve: () => {},
      onClipEdited: () => {},
    });

    rightClick(handle.el);
    expect(document.querySelector('.context-menu')).toBeNull();
  });

  it('says "Edit" when the clip already has that envelope, and does not duplicate it', () => {
    const clip = {
      id: 'c1', name: 'Verse', lengthBars: 1, notes: [],
      envelopes: [{ paramId: 'poly1.filter.cutoff', enabled: true, stepped: false, values: [0.5] }],
    };
    const state = {
      lanes: [{ id: 'poly1', name: 'Sub 1', engineId: 'subtractive', clips: [clip], inserts: [] }],
      masterInserts: [], sends: [],
    } as unknown as SessionState;

    const handle = createKnob({ id: 'poly1.filter.cutoff', label: 'CUTOFF',
      min: 0, max: 1, value: 0.5, onChange: () => {} });
    document.body.appendChild(handle.el);

    attachKnobAutomationMenu(handle, {
      destinations: createDestinationRegistry({ getState: () => state, getKnobRegistry: () => new Map() }),
      getMode: () => 'session',
      getState: () => state,
      getLaneStates: () => new Map([['poly1', { laneId: 'poly1', playing: clip } as never]]),
      getArrangement: () => emptyArrangementState(120),
      openClip: () => {},
      addTimelineCurve: () => {},
      onClipEdited: () => {},
    });

    rightClick(handle.el);
    expect(menuItems()[0].text).toContain('Edit');

    (document.querySelector('.context-menu-item') as HTMLElement).click();
    expect(clip.envelopes.length).toBe(1);
  });

  it('shows a disabled item with the reason for a master FX knob in Session view', () => {
    const state = {
      lanes: [],
      masterInserts: [{ id: 'slot-m', pluginId: 'multifilter', params: {}, bypass: false }],
      sends: [],
    } as unknown as SessionState;

    const handle = createKnob({ id: 'fx.master.fx:slot-m.freq', label: 'FREQ',
      min: 20, max: 20000, value: 1000, onChange: () => {} });
    document.body.appendChild(handle.el);

    attachKnobAutomationMenu(handle, {
      destinations: createDestinationRegistry({ getState: () => state, getKnobRegistry: () => new Map() }),
      getMode: () => 'session',
      getState: () => state,
      getLaneStates: () => new Map(),
      getArrangement: () => emptyArrangementState(120),
      openClip: () => {},
      addTimelineCurve: () => {},
      onClipEdited: () => {},
    });

    rightClick(handle.el);
    const items = menuItems();
    expect(items.length).toBe(1);
    expect(items[0].disabled).toBe(true);
    expect(items[0].text).toContain('Performance');
  });

  // The timeline path must go through the injected addTimelineCurve
  // (PerformanceFeature.addCurve in the real app) rather than mutating the
  // arrangement itself — that's the only way the curve stays undoable
  // (beforeEdit/commitArrUndo live in performance-feature.ts, not here).
  it('creates a timeline curve in Performance mode via the injected operation', () => {
    const state = {
      lanes: [{ id: 'poly1', name: 'Sub 1', engineId: 'subtractive',
                clips: [{ id: 'c1', name: 'Verse', lengthBars: 1, notes: [] }], inserts: [] }],
      masterInserts: [], sends: [],
    } as unknown as SessionState;
    const arrangement = emptyArrangementState(120);

    const handle = createKnob({ id: 'poly1.filter.cutoff', label: 'CUTOFF',
      min: 0, max: 1, value: 0.5, onChange: () => {} });
    document.body.appendChild(handle.el);

    const addTimelineCurveCalls: string[] = [];

    attachKnobAutomationMenu(handle, {
      destinations: createDestinationRegistry({ getState: () => state, getKnobRegistry: () => new Map() }),
      getMode: () => 'performance',
      getState: () => state,
      getLaneStates: () => new Map(),
      getArrangement: () => arrangement,
      openClip: () => {},
      addTimelineCurve: (paramId) => addTimelineCurveCalls.push(paramId),
      onClipEdited: () => {},
    });

    rightClick(handle.el);
    expect(menuItems()[0].text).toContain('Automate on the timeline');

    (document.querySelector('.context-menu-item') as HTMLElement).click();

    // Non-vacuity: the menu must call the injected operation with the right
    // paramId, and must NOT mutate the arrangement itself.
    expect(addTimelineCurveCalls).toEqual(['poly1.filter.cutoff']);
    const allParamIds = [
      ...arrangement.lanes.flatMap((l) => l.automation.map((c) => c.paramId)),
      ...arrangement.globalAutomation.map((c) => c.paramId),
    ];
    expect(allParamIds).toEqual([]);
  });
});
