// @vitest-environment jsdom
// The painter's foldable row has two modes: describe a shape (LFO) or draw one
// by hand (steps). These pin that both are reachable and that the step one
// actually writes into the lane.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderClipAutomationLanes, type ClipAutoDeps } from './clip-automation-lanes';
import type { SessionClip } from './session';
import type { AutomationTarget } from '../automation/automation-targets';
import { ClipAxis } from '../core/clip-axis';
import { DEFAULT_METER } from '../core/meter';

function stubCanvas() {
  const ctx2d = new Proxy({}, { get: () => () => {} }) as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx2d as never);
}

const TARGETS: AutomationTarget[] = [
  { id: 'lane1.cutoff', label: 'CUTOFF', laneId: 'lane1', laneName: 'Bass', min: 0, max: 1 },
];

function makeDeps(): ClipAutoDeps {
  const axis = new ClipAxis('c1', 1 * 4 * 96);
  axis.setBasisWidth(800);
  return {
    destinations: { list: () => TARGETS, subscribe: () => () => {}, invalidate: () => {} },
    axis,
    meter: DEFAULT_METER,
    getPlayheadFrac: () => -1,
  };
}

/** Mounts the panel, adds one lane and unfolds its draw row. */
function mountWithOpenRow() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const clip = { id: 'c1', lengthBars: 1, notes: [] } as unknown as SessionClip;
  renderClipAutomationLanes(host, clip, makeDeps());

  const add = [...host.querySelectorAll('button')]
    .find((b) => b.textContent === '+ Automation') as HTMLButtonElement;
  add.click();
  (host.querySelector('.clip-auto-lfo-toggle') as HTMLButtonElement).click();
  return { host, clip };
}

const setMode = (host: HTMLElement, value: 'lfo' | 'steps') => {
  const sel = host.querySelector('.clip-auto-mode') as HTMLSelectElement;
  sel.value = value;
  sel.dispatchEvent(new Event('change'));
};

describe('the painter has two modes', () => {
  beforeEach(() => {
    stubCanvas();
    document.body.replaceChildren();
  });

  it('offers a mode picker once the row is unfolded', () => {
    const { host } = mountWithOpenRow();
    expect(host.querySelector('.clip-auto-mode')).not.toBeNull();
  });

  it('shows the LFO controls by default', () => {
    const { host } = mountWithOpenRow();
    expect(host.querySelector('.clip-auto-lfo-shape')).not.toBeNull();
    expect(host.querySelector('.steps-control')).toBeNull();
  });

  it('switches to the step grid when the mode is changed', () => {
    const { host } = mountWithOpenRow();
    setMode(host, 'steps');
    expect(host.querySelector('.steps-control')).not.toBeNull();
    expect(host.querySelector('.clip-auto-lfo-shape')).toBeNull();
    setMode(host, 'lfo');
  });

  it('draws one bar per declared step', () => {
    const { host } = mountWithOpenRow();
    setMode(host, 'steps');
    const count = Number((host.querySelector('.clip-auto-steps-count') as HTMLInputElement).value);
    expect(host.querySelectorAll('.step-bar')).toHaveLength(count);
    setMode(host, 'lfo');
  });

  it('writes into the envelope when Apply is pressed', () => {
    const { host, clip } = mountWithOpenRow();
    setMode(host, 'steps');
    const env = clip.envelopes![0];

    // Draw something that is NOT what the lane already holds. Both the default
    // steps and a fresh lane sit at 0.5, so applying straight away writes the
    // same values back and proves nothing.
    (([...host.querySelectorAll('.clip-auto-steps button')]
      .find((b) => b.textContent?.includes('↗')) as HTMLButtonElement)).click();

    const before = [...env.values];
    (host.querySelector('.clip-auto-steps-apply') as HTMLButtonElement).click();
    expect(env.values).not.toEqual(before);
    setMode(host, 'lfo');
  });

  it('writes a rising curve when the ramp-up shortcut is applied', () => {
    const { host, clip } = mountWithOpenRow();
    setMode(host, 'steps');
    (([...host.querySelectorAll('.clip-auto-steps button')]
      .find((b) => b.textContent?.includes('↗')) as HTMLButtonElement)).click();
    (host.querySelector('.clip-auto-steps-apply') as HTMLButtonElement).click();

    const v = clip.envelopes![0].values;
    expect(v[v.length - 1]).toBeGreaterThan(v[0]);
    setMode(host, 'lfo');
  });

  it('changes the drawn steps when a shape shortcut is pressed', () => {
    const { host } = mountWithOpenRow();
    setMode(host, 'steps');
    const heights = () => [...host.querySelectorAll('.step-bar')].map((b) => (b as HTMLElement).style.height);
    const press = (glyph: string) => (([...host.querySelectorAll('.clip-auto-steps button')]
      .find((b) => b.textContent?.includes(glyph)) as HTMLButtonElement)).click();

    // The row's settings are module state shared across lanes, deliberately —
    // you dial a shape in once and paint lane after lane. So a test cannot
    // assume what the row currently holds: it settles on one shape, then
    // compares against a different one.
    press('↗');
    const rising = heights();
    press('↘');
    expect(heights()).not.toEqual(rising);
    setMode(host, 'lfo');
  });

  it('resizes the grid when the step count changes', () => {
    const { host } = mountWithOpenRow();
    setMode(host, 'steps');
    const count = host.querySelector('.clip-auto-steps-count') as HTMLInputElement;
    count.value = '8';
    count.dispatchEvent(new Event('change'));
    expect(host.querySelectorAll('.step-bar')).toHaveLength(8);
    // Put it back: the row's settings are shared across lanes on purpose.
    count.value = '16';
    count.dispatchEvent(new Event('change'));
    setMode(host, 'lfo');
  });
});
