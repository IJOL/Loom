// @vitest-environment jsdom
// Characterisation tests for the per-clip automation panel: render structure
// (picker grouped by lane with each strip under its own sub-group heading, the
// strip shown in a created lane's header), the add / toggle / remove
// interactions, and the flagged-missing lane. Written alongside the lit-html
// migration so the panel's externally-observable contract is pinned.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderClipAutomationLanes, type ClipAutoDeps } from './clip-automation-lanes';
import type { SessionClip } from './session';
import type { AutomationTarget } from '../automation/automation-targets';
import { ClipAxis } from '../core/clip-axis';
import { DEFAULT_METER, stepsPerBar, ticksPerBar, type TimeSignature } from '../core/meter';
import { TICKS_PER_STEP } from '../core/notes';
import { AUTOMATION_SUB_RES } from '../core/pattern';

const THREE_FOUR: TimeSignature = { num: 3, den: 4 };

function stubCanvas() {
  const ctx2d = new Proxy({}, { get: () => () => {} }) as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx2d as never);
}

const TARGETS: AutomationTarget[] = [
  { id: 'lane1.cutoff', label: 'CUTOFF', laneId: 'lane1', laneName: 'Bass', min: 0, max: 1 },
  { id: 'lane1.fx:s1.feedback', label: 'FDBK', laneId: 'lane1', laneName: 'Bass', min: 0, max: 1,
    subGroup: { key: 'fx:s1', label: 'Delay 1' } },
];

/** A laid-out axis: 1 bar fitted into an 800px viewport. */
function makeAxis(): ClipAxis {
  const axis = new ClipAxis('c1', 1 * 4 * 96);
  axis.setBasisWidth(800);
  return axis;
}

function makeDeps(
  targets: AutomationTarget[] = TARGETS,
  over: Partial<ClipAutoDeps> = {},
): ClipAutoDeps {
  return {
    destinations: { list: () => targets, subscribe: () => () => {}, invalidate: () => {} },
    axis: makeAxis(),
    meter: DEFAULT_METER,
    getPlayheadFrac: () => -1,
    ...over,
  };
}

function makeClip(over: Partial<SessionClip> = {}): SessionClip {
  return { id: 'c1', lengthBars: 1, notes: [], ...over } as unknown as SessionClip;
}

function addButton(host: HTMLElement): HTMLButtonElement {
  return [...host.querySelectorAll('button')].find((b) => b.textContent === '+ Automation') as HTMLButtonElement;
}

// ── LFO row helpers ────────────────────────────────────────────────────────
// The row is folded away by default, so every LFO test unfolds it first. The
// wave itself (shape, cycles, size, height, phase) is module-level and SHARED
// across lanes by design, which means it also survives from test to test —
// setLfo() states every control a test depends on so order cannot matter.

function lfoToggle(h: HTMLElement): HTMLButtonElement {
  return h.querySelector<HTMLButtonElement>('.clip-auto-lfo-toggle')!;
}
function lfoApply(h: HTMLElement): HTMLButtonElement {
  return h.querySelector<HTMLButtonElement>('.clip-auto-lfo-apply')!;
}
function lfoCyclesInput(h: HTMLElement): HTMLInputElement {
  return h.querySelector<HTMLInputElement>('.clip-auto-lfo-cycles input')!;
}
/** Size / Height / Phase, in the order the row lays them out. */
function lfoSlider(h: HTMLElement, name: 'Size' | 'Height' | 'Phase'): HTMLInputElement {
  const row = [...h.querySelectorAll('.clip-auto-lfo-slider')]
    .find((el) => el.querySelector('.clip-auto-lfo-slider-name')?.textContent === name)!;
  return row.querySelector('input')!;
}

function openLfo(h: HTMLElement): void {
  if (!h.querySelector('.clip-auto-lfo')) lfoToggle(h).click();
}

/** Cycles measured the way the maths tests do: crossings of the centre going up. */
function upwardCrossings(v: number[], center = 0.5): number {
  let n = 0;
  for (let i = 0; i + 1 < v.length; i++) if (v[i] <= center && v[i + 1] > center) n++;
  return n;
}

function setRange(input: HTMLInputElement, value: number): void {
  input.value = String(value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Put every LFO control in a known state (and repaint through the real UI). */
function setLfo(
  h: HTMLElement,
  o: { shape?: string; cycles?: number; size?: number; height?: number; phase?: number } = {},
): void {
  openLfo(h);
  const { shape = 'sine', cycles = 4, size = 1, height = 0.5, phase = 0 } = o;
  const sel = h.querySelector<HTMLSelectElement>('.clip-auto-lfo-shape')!;
  sel.value = shape; sel.dispatchEvent(new Event('change'));
  setRange(lfoSlider(h, 'Size'), size);
  setRange(lfoSlider(h, 'Height'), height);
  setRange(lfoSlider(h, 'Phase'), phase);
  const c = lfoCyclesInput(h);
  c.value = String(cycles); c.dispatchEvent(new Event('change'));
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

describe('renderClipAutomationLanes — the lane uses the session meter', () => {
  /** Render a clip of `bars` in `m` and add one lane; returns its curve. */
  function laneIn(bars: number, m: TimeSignature): number[] {
    document.body.innerHTML = '<div id="h" class="insp-auto-box"></div>';
    const h = document.getElementById('h')!;
    const clip = makeClip({ lengthBars: bars });
    const axis = new ClipAxis('c1', bars * ticksPerBar(m));
    axis.setBasisWidth(800);
    renderClipAutomationLanes(h, clip, makeDeps(TARGETS, { axis, meter: m }));
    addButton(h).click();
    return clip.envelopes![0].values;
  }

  it('sizes a rendered 3/4 lane to three quarters of the same lane in 4/4', () => {
    // Creation already knows the meter; this pins the RESIZE the strip performs
    // on every draw, which used to grow the curve straight back to 16 a bar.
    expect(laneIn(4, THREE_FOUR).length / laneIn(4, DEFAULT_METER).length)
      .toBeCloseTo(THREE_FOUR.num / DEFAULT_METER.num, 10);
  });

  it('sizes the lane to a whole number of the meter’s bars', () => {
    for (const m of [DEFAULT_METER, THREE_FOUR, { num: 7, den: 8 }]) {
      expect(laneIn(3, m).length / (stepsPerBar(m) * AUTOMATION_SUB_RES)).toBe(3);
    }
  });
});

describe('renderClipAutomationLanes — the drawn LFO', () => {
  /** Index of the highest sample in [from, to). */
  const argmax = (v: number[], from: number, to: number) => {
    let best = from;
    for (let i = from; i < to; i++) if (v[i] > v[best]) best = i;
    return best;
  };

  function lfoCurve(bars: number, m: TimeSignature, cycles: number): number[] {
    document.body.innerHTML = '<div id="h" class="insp-auto-box"></div>';
    const h = document.getElementById('h')!;
    const clip = makeClip({ lengthBars: bars });
    const axis = new ClipAxis('c1', bars * ticksPerBar(m));
    axis.setBasisWidth(800);
    renderClipAutomationLanes(h, clip, makeDeps(TARGETS, { axis, meter: m }));
    addButton(h).click();
    setLfo(h, { cycles });
    return clip.envelopes![0].values;
  }

  it('fits the requested cycles into the clip, in any meter', () => {
    // The count is over the REGION, so two cycles across a 2-bar clip means the
    // peaks sit one clip-half apart whether the bar is 16 steps or 12. That also
    // keeps the curve in phase with the grid lines drawn under it, which already
    // come from stepsPerBar.
    for (const m of [DEFAULT_METER, THREE_FOUR]) {
      const v = lfoCurve(2, m, 2);
      const spacing = argmax(v, v.length / 2, v.length) - argmax(v, 0, v.length / 2);
      expect(spacing).toBe(v.length / 2);
      expect(spacing).toBe(stepsPerBar(m) * AUTOMATION_SUB_RES); // one cycle per bar here
    }
  });

  it('paints exactly the number of cycles asked for, in any meter', () => {
    for (const m of [DEFAULT_METER, THREE_FOUR]) {
      for (const cycles of [1, 3, 8]) {
        expect(upwardCrossings(lfoCurve(2, m, cycles))).toBe(cycles);
      }
    }
  });
});

describe('renderClipAutomationLanes — follows the clip axis', () => {
  it('sizes the lane canvas to the shared axis, not to a private width', () => {
    const axis = makeAxis();
    const clip = makeClip();
    renderClipAutomationLanes(host, clip, makeDeps(TARGETS, { axis }));
    addButton(host).click();

    const canvas = host.querySelector<HTMLCanvasElement>('canvas.auto-lane-canvas')!;
    expect(canvas.width).toBe(axis.contentWidth());          // fitted: 800
    // Zoom the clip: the lane grows with it (this is what "zoom linked to the
    // clip" means — the old canvas was a fixed max(800, bars*240)).
    axis.setZoom(4);
    expect(canvas.width).toBe(axis.contentWidth());
    expect(canvas.width).toBeGreaterThan(800);
  });

  it('scrolls with the clip instead of growing a second scrollbar', () => {
    const axis = makeAxis();
    renderClipAutomationLanes(host, makeClip(), makeDeps(TARGETS, { axis }));
    addButton(host).click();

    const content = host.querySelector<HTMLElement>('.clip-follow-content')!;
    axis.setZoom(2);
    axis.setScrollLeft(250);
    expect(content.style.transform).toBe(`translateX(-${axis.scrollLeft}px)`);
  });

  it('shows the loop region, positioned in the clip axis', () => {
    const axis = makeAxis();
    // 1-bar clip, loop = second half → [8, 16) steps
    const clip = makeClip({
      loopEnabled: true,
      loopStartTick: 8 * TICKS_PER_STEP,
      loopEndTick: 16 * TICKS_PER_STEP,
    });
    renderClipAutomationLanes(host, clip, makeDeps(TARGETS, { axis }));
    addButton(host).click();

    const shade = host.querySelector<HTMLElement>('.clip-follow-loop')!;
    expect(shade.style.display).not.toBe('none');
    // Half-way in, half the clip wide — relative to the axis, at any zoom.
    expect(parseFloat(shade.style.left)).toBeCloseTo(axis.contentWidth() / 2, 0);
    expect(parseFloat(shade.style.width)).toBeCloseTo(axis.contentWidth() / 2, 0);
  });

  it('re-places the loop shade when the loop is edited in the editor above', () => {
    // Caught by looking at the real UI: dragging the loop's right edge moved the
    // editor's amber column but left the lane's shade at its old width, because
    // nothing notifies the lane. The tick compares instead of subscribing.
    const axis = makeAxis();
    const clip = makeClip({ loopEnabled: true, loopStartTick: 0, loopEndTick: 16 * TICKS_PER_STEP });
    const handle = renderClipAutomationLanes(host, clip, makeDeps(TARGETS, { axis }));
    addButton(host).click();

    const shade = host.querySelector<HTMLElement>('.clip-follow-loop')!;
    expect(parseFloat(shade.style.width)).toBeCloseTo(axis.contentWidth(), 0);

    clip.loopEndTick = 8 * TICKS_PER_STEP;      // as the editor's brace would write it
    handle.tick();
    expect(parseFloat(shade.style.width)).toBeCloseTo(axis.contentWidth() / 2, 0);
  });

  it('hides the loop region when the clip does not loop', () => {
    renderClipAutomationLanes(host, makeClip(), makeDeps());
    addButton(host).click();
    expect(host.querySelector<HTMLElement>('.clip-follow-loop')!.style.display).toBe('none');
  });

  it('disposing stops the lanes following the axis', () => {
    const axis = makeAxis();
    const handle = renderClipAutomationLanes(host, makeClip(), makeDeps(TARGETS, { axis }));
    addButton(host).click();
    const canvas = host.querySelector<HTMLCanvasElement>('canvas.auto-lane-canvas')!;
    const before = canvas.width;

    handle.dispose();
    axis.setZoom(3);
    expect(canvas.width).toBe(before);
  });
});

describe('renderClipAutomationLanes — LFO curve generator', () => {
  it('keeps the row folded away until the header button asks for it', () => {
    renderClipAutomationLanes(host, makeClip(), makeDeps());
    addButton(host).click();
    expect(host.querySelector('.clip-auto-lfo')).toBeNull();

    lfoToggle(host).click();
    expect(host.querySelector('.clip-auto-lfo')).not.toBeNull();
    expect(host.querySelectorAll('.clip-auto-lfo-slider').length).toBe(3);

    lfoToggle(host).click();
    expect(host.querySelector('.clip-auto-lfo')).toBeNull();
  });

  it('draws a curve into the lane, replacing the flat default', () => {
    const clip = makeClip();
    renderClipAutomationLanes(host, clip, makeDeps());
    addButton(host).click();
    const values = clip.envelopes![0].values;
    const flat = values.every((v) => v === values[0]);
    expect(flat).toBe(true);

    openLfo(host);
    lfoApply(host).click();
    const min = Math.min(...values), max = Math.max(...values);
    expect(max - min).toBeGreaterThan(0.5);          // a full-depth wave spans the lane
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThanOrEqual(1);
  });

  it('writes only inside the loop region when Loop only is on', () => {
    const clip = makeClip({
      loopEnabled: true,
      loopStartTick: 8 * TICKS_PER_STEP,
      loopEndTick: 16 * TICKS_PER_STEP,
    });
    renderClipAutomationLanes(host, clip, makeDeps());
    addButton(host).click();
    const values = clip.envelopes![0].values;
    const half = Math.floor(values.length / 2);
    const firstHalfBefore = values.slice(0, half).join(',');

    setLfo(host);
    expect(values.slice(0, half).join(',')).toBe(firstHalfBefore);     // untouched
    const tail = values.slice(half);
    expect(Math.max(...tail) - Math.min(...tail)).toBeGreaterThan(0.5); // written
  });

  it('fits the whole cycle count inside the loop region, not the clip', () => {
    // What "cycles over the region" buys: the wave closes cleanly in the loop.
    const clip = makeClip({
      loopEnabled: true,
      loopStartTick: 8 * TICKS_PER_STEP,
      loopEndTick: 16 * TICKS_PER_STEP,
    });
    renderClipAutomationLanes(host, clip, makeDeps());
    addButton(host).click();
    setLfo(host, { cycles: 3 });
    const values = clip.envelopes![0].values;
    expect(upwardCrossings(values.slice(Math.floor(values.length / 2)))).toBe(3);
  });

  it('the cycles field is what sets the count', () => {
    const clip = makeClip();
    renderClipAutomationLanes(host, clip, makeDeps());
    addButton(host).click();
    const values = clip.envelopes![0].values;

    setLfo(host, { cycles: 2 });
    expect(upwardCrossings(values)).toBe(2);
    setLfo(host, { cycles: 6 });
    expect(upwardCrossings(values)).toBe(6);
  });

  it('the Size slider is what sets how much of the lane the wave spans', () => {
    const clip = makeClip();
    renderClipAutomationLanes(host, clip, makeDeps());
    addButton(host).click();
    const values = clip.envelopes![0].values;
    const span = () => Math.max(...values) - Math.min(...values);

    setLfo(host, { size: 1 });
    const full = span();
    setRange(lfoSlider(host, 'Size'), 0.25);
    expect(span()).toBeLessThan(full / 2);
    expect(span()).toBeGreaterThan(0);
  });

  it('the Height slider is what moves the wave up the lane', () => {
    const clip = makeClip();
    renderClipAutomationLanes(host, clip, makeDeps());
    addButton(host).click();
    const values = clip.envelopes![0].values;
    const mean = () => values.reduce((a, b) => a + b, 0) / values.length;

    setLfo(host, { size: 0.4, height: 0.25 });
    const low = mean();
    setRange(lfoSlider(host, 'Height'), 0.75);
    expect(mean()).toBeGreaterThan(low);
  });

  it('the Phase slider is what rotates the wave', () => {
    const clip = makeClip();
    renderClipAutomationLanes(host, clip, makeDeps());
    addButton(host).click();
    const values = clip.envelopes![0].values;

    setLfo(host, { cycles: 1, phase: 0 });
    const before = values.slice();
    setRange(lfoSlider(host, 'Phase'), 0.25);
    expect(values).not.toEqual(before);
    // a WHOLE cycle of rotation is no rotation at all
    setRange(lfoSlider(host, 'Phase'), 1);
    expect(values).toEqual(before);
  });

  it('brackets a slider drag into a single undo step', () => {
    const clip = makeClip();
    const calls: string[] = [];
    const historyDeps = {
      history: {} as never, snapshot: () => ({}) as never, restore: () => {},
      beginGesture: () => calls.push('begin'),
      endGesture: () => calls.push('end'),
    };
    renderClipAutomationLanes(host, clip, makeDeps(TARGETS, { historyDeps }));
    addButton(host).click();
    openLfo(host);

    const slider = lfoSlider(host, 'Size');
    slider.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    setRange(slider, 0.8);
    setRange(slider, 0.6);
    slider.dispatchEvent(new Event('pointerup', { bubbles: true }));
    expect(calls).toEqual(['begin', 'end']);   // one bracket, not one per sample
  });

  it('never resizes the envelope array (the audio path holds that reference)', () => {
    const clip = makeClip();
    renderClipAutomationLanes(host, clip, makeDeps());
    addButton(host).click();
    const values = clip.envelopes![0].values;
    const len = values.length;
    setLfo(host);
    lfoApply(host).click();
    expect(clip.envelopes![0].values).toBe(values);      // same reference
    expect(values.length).toBe(len);
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
