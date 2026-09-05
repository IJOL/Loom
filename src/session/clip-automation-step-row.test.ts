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
function mountWithOpenRow(lengthBars = 1) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const clip = { id: 'c1', lengthBars, notes: [] } as unknown as SessionClip;
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

  it('Apply writes the steps back over a lane painted by hand', () => {
    const { host, clip } = mountWithOpenRow();
    setMode(host, 'steps');
    const env = clip.envelopes![0];
    (([...host.querySelectorAll('.clip-auto-steps button')]
      .find((b) => b.textContent?.includes('↗')) as HTMLButtonElement)).click();
    const ramp = [...env.values];

    // The steps land as you draw them, so Apply's job is the re-write: a lane
    // someone has since painted over by hand goes back to the row's steps.
    env.values.fill(0.5);
    (host.querySelector('.clip-auto-steps-apply') as HTMLButtonElement).click();
    expect(env.values).toEqual(ramp);
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

// One mode at a time. Picking Steps used to leave the LFO's wave in the lane —
// still drawn, still sounding — with an unapplied grid of sixteen bars beneath
// it, so what you saw was both and what you heard was the wave. Now the mode
// you pick is what the lane holds, the moment you pick it and every time you
// touch a bar; and the grid is the lane's own grid, one step per 16th.
describe('the mode you pick is the curve the lane holds', () => {
  beforeEach(() => {
    stubCanvas();
    document.body.replaceChildren();
  });

  const SUB = 16;   // AUTOMATION_SUB_RES: sub-samples per 16th step
  /** True when every sub-sample of every step equals that step's first one —
   *  the shape a HOLD step curve has and a sine never does. */
  const heldPerStep = (v: number[]) => {
    for (let s = 0; s * SUB < v.length; s++) {
      for (let k = 1; k < SUB && s * SUB + k < v.length; k++) {
        if (v[s * SUB + k] !== v[s * SUB]) return false;
      }
    }
    return true;
  };
  const paintWave = (host: HTMLElement) => {
    const shape = host.querySelector('.clip-auto-lfo-shape') as HTMLSelectElement;
    shape.value = 'sine';
    shape.dispatchEvent(new Event('change'));
  };

  it('offers one step per 16th of the lane: 16 for one bar, 32 for two', () => {
    const one = mountWithOpenRow(1);
    setMode(one.host, 'steps');
    expect(one.host.querySelectorAll('.step-bar')).toHaveLength(16);
    setMode(one.host, 'lfo');
    document.body.replaceChildren();

    const two = mountWithOpenRow(2);
    setMode(two.host, 'steps');
    expect(two.host.querySelectorAll('.step-bar')).toHaveLength(32);
    setMode(two.host, 'lfo');
  });

  it('choosing Steps writes the steps into the lane at once, replacing the wave', () => {
    const { host, clip } = mountWithOpenRow();
    paintWave(host);
    const env = clip.envelopes![0];
    expect(heldPerStep(env.values)).toBe(false);   // the sine is in the lane

    setMode(host, 'steps');
    expect(heldPerStep(env.values)).toBe(true);    // and now the steps are
    setMode(host, 'lfo');
  });

  it('a shape shortcut lands in the lane without Apply', () => {
    const { host, clip } = mountWithOpenRow();
    setMode(host, 'steps');
    (([...host.querySelectorAll('.clip-auto-steps button')]
      .find((b) => b.textContent?.includes('↗')) as HTMLButtonElement)).click();
    const v = clip.envelopes![0].values;
    expect(v[v.length - 1]).toBeGreaterThan(v[0]);
    setMode(host, 'lfo');
  });

  it('a dragged bar lands in the lane without Apply', () => {
    const { host, clip } = mountWithOpenRow();
    setMode(host, 'steps');
    const grid = host.querySelector('.steps-control') as HTMLElement;
    grid.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 160, height: 100, right: 160, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    // Column 0, at the very top: the first step goes to (nearly) 1.
    grid.dispatchEvent(new MouseEvent('pointerdown', { clientX: 5, clientY: 1, bubbles: true }));
    const v = clip.envelopes![0].values;
    expect(v[0]).toBeGreaterThan(0.9);
    expect(v[SUB - 1]).toBeGreaterThan(0.9);        // the whole first 16th
    setMode(host, 'lfo');
  });

  it('choosing LFO again draws the wave back over the steps', () => {
    const { host, clip } = mountWithOpenRow();
    setMode(host, 'steps');
    const env = clip.envelopes![0];
    expect(heldPerStep(env.values)).toBe(true);
    setMode(host, 'lfo');
    expect(heldPerStep(env.values)).toBe(false);
  });
});
