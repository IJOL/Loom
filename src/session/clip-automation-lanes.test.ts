// @vitest-environment jsdom
// Characterisation tests for the per-clip automation panel: render structure
// (picker grouped by lane with each strip under its own sub-group heading, the
// strip shown in a created lane's header), the add / toggle / remove
// interactions, and the flagged-missing lane. Written alongside the lit-html
// migration so the panel's externally-observable contract is pinned.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderClipAutomationLanes, type ClipAutoDeps } from './clip-automation-lanes';
import type { SessionClip } from './session';
import type { Sequencer } from '../core/sequencer';
import type { AutomationTarget } from '../automation/automation-targets';

function stubCanvas() {
  const ctx2d = new Proxy({}, { get: () => () => {} }) as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx2d as never);
}

const TARGETS: AutomationTarget[] = [
  { id: 'lane1.cutoff', label: 'CUTOFF', laneId: 'lane1', laneName: 'Bass', min: 0, max: 1 },
  { id: 'lane1.fx:s1.feedback', label: 'FDBK', laneId: 'lane1', laneName: 'Bass', min: 0, max: 1,
    subGroup: { key: 'fx:s1', label: 'Delay 1' } },
];

function makeDeps(targets: AutomationTarget[] = TARGETS): ClipAutoDeps {
  return {
    seq: { meter: { num: 4, den: 4 }, bpm: 120, isPlaying: () => false } as unknown as Sequencer,
    getAutoAbsSubIdx: () => 0,
    destinations: { list: () => targets, subscribe: () => () => {}, invalidate: () => {} },
  };
}

function makeClip(): SessionClip {
  return { id: 'c1', lengthBars: 1, notes: [] } as unknown as SessionClip;
}

function addButton(host: HTMLElement): HTMLButtonElement {
  return [...host.querySelectorAll('button')].find((b) => b.textContent === '+ Automation') as HTMLButtonElement;
}

let host: HTMLElement;
beforeEach(() => {
  stubCanvas();
  document.body.innerHTML = '<div id="host" class="insp-auto-box"></div>';
  host = document.getElementById('host')!;
});

describe('renderClipAutomationLanes — picker structure', () => {
  it('groups the picker by lane, with each strip under its own sub-group heading', () => {
    renderClipAutomationLanes(host, makeClip(), makeDeps());
    const sel = host.querySelector<HTMLSelectElement>('.clip-auto-param-select')!;
    expect([...sel.querySelectorAll('optgroup')].map((g) => g.label)).toEqual(['Bass', 'Bass · Delay 1']);
    expect([...sel.querySelectorAll('option')].map((o) => o.value))
      .toEqual(['lane1.cutoff', 'lane1.fx:s1.feedback']);
  });

  it('shows the hint (and no lanes) when the clip has no envelopes', () => {
    renderClipAutomationLanes(host, makeClip(), makeDeps());
    expect(host.querySelector('.clip-auto-hint')).toBeTruthy();
    expect(host.querySelector('.clip-auto-lane')).toBeNull();
  });
});

describe('renderClipAutomationLanes — add / toggle / remove', () => {
  it('adds a lane for the picked param and shows the strip in its header', () => {
    const clip = makeClip();
    renderClipAutomationLanes(host, clip, makeDeps());
    const sel = host.querySelector<HTMLSelectElement>('.clip-auto-param-select')!;
    sel.value = 'lane1.fx:s1.feedback';
    addButton(host).click();

    expect(clip.envelopes?.map((e) => e.paramId)).toEqual(['lane1.fx:s1.feedback']);
    expect(host.querySelector('.clip-auto-hint')).toBeNull();
    expect(host.querySelector('.auto-lane-header .label')!.textContent).toBe('Bass · Delay 1 · FDBK');
    expect(host.querySelector('.clip-auto-range')!.textContent).toBe('[0.00 .. 1.00]');
    expect(host.querySelector('canvas.auto-lane-canvas')).toBeTruthy();
  });

  it('refuses a duplicate lane for a param that already has one', () => {
    const clip = makeClip();
    renderClipAutomationLanes(host, clip, makeDeps());
    addButton(host).click();
    addButton(host).click();
    expect(clip.envelopes?.length).toBe(1);
  });

  it('On/Off toggles env.enabled and keeps the same canvas element (no widget rebuild)', () => {
    const clip = makeClip();
    renderClipAutomationLanes(host, clip, makeDeps());
    addButton(host).click();

    const canvas = host.querySelector('canvas.auto-lane-canvas')!;
    const enableBtn = host.querySelector<HTMLButtonElement>('.auto-lane-header .enable')!;
    expect(enableBtn.textContent).toBe('On');
    expect(enableBtn.classList.contains('active')).toBe(true);

    enableBtn.click();
    expect(clip.envelopes![0].enabled).toBe(false);
    const after = host.querySelector<HTMLButtonElement>('.auto-lane-header .enable')!;
    expect(after.textContent).toBe('Off');
    expect(after.classList.contains('active')).toBe(false);
    // The canvas (and its painter listeners) must survive the header repaint.
    expect(host.querySelector('canvas.auto-lane-canvas')).toBe(canvas);
  });

  it('Stepped/Smooth toggles env.stepped', () => {
    const clip = makeClip();
    renderClipAutomationLanes(host, clip, makeDeps());
    addButton(host).click();

    const stepBtn = host.querySelector<HTMLButtonElement>('.auto-lane-header .stepped')!;
    expect(stepBtn.textContent).toBe('Smooth');
    stepBtn.click();
    expect(clip.envelopes![0].stepped).toBe(true);
    expect(host.querySelector('.auto-lane-header .stepped')!.textContent).toBe('Stepped');
  });

  it('× removes the lane and the hint returns', () => {
    const clip = makeClip();
    renderClipAutomationLanes(host, clip, makeDeps());
    addButton(host).click();
    host.querySelector<HTMLButtonElement>('.auto-lane-header button[title="Remove this lane"]')!.click();
    expect(clip.envelopes?.length).toBe(0);
    expect(host.querySelector('.clip-auto-lane')).toBeNull();
    expect(host.querySelector('.clip-auto-hint')).toBeTruthy();
  });
});

describe('renderClipAutomationLanes — orphaned envelopes', () => {
  it('shows an envelope whose param the session no longer declares, flagged .missing', () => {
    const clip = makeClip();
    clip.envelopes = [{ paramId: 'gone.param', values: [], enabled: true, stepped: false }];
    renderClipAutomationLanes(host, clip, makeDeps());
    const lane = host.querySelector('.clip-auto-lane')!;
    expect(lane.classList.contains('missing')).toBe(true);
    expect(lane.querySelector('.label')!.textContent).toBe('gone.param (unavailable)');
    expect(lane.querySelector('.clip-auto-range')!.textContent).toBe('');
  });
});
