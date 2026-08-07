// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createLoopRing } from './loop-ring';
import type { PanelLoopPhase } from '@loom/plugin-sdk';

const phase = (p: Partial<PanelLoopPhase>): PanelLoopPhase => ({
  state: 'idle', frac: 0.5, bars: 1, centerText: '1', ...p,
});

const wedgeOf = (el: HTMLElement) => el.querySelector('.ring-wedge')!.getAttribute('d') ?? '';
const numOf = (el: HTMLElement) => el.querySelector('.ring-num')!.textContent ?? '';

describe('loop ring', () => {
  it('draws nothing and says nothing while the lane is silent', () => {
    const ring = createLoopRing();
    ring.set(phase({ state: 'silent', frac: 0.7, centerText: '3' }));

    // A silent lane must not show a stale wedge: half a circle with no sound
    // behind it reads as a loop that is running.
    expect(wedgeOf(ring.el)).toBe('');
    expect(numOf(ring.el)).toBe('');
    expect(ring.el.classList.contains('silent')).toBe(true);
  });

  it('sweeps a wedge and shows the bar while the loop turns', () => {
    const ring = createLoopRing();
    ring.set(phase({ state: 'idle', frac: 0.25, centerText: '2' }));

    expect(wedgeOf(ring.el)).not.toBe('');
    expect(numOf(ring.el)).toBe('2');
  });

  it('grows the wedge as the loop advances', () => {
    const ring = createLoopRing();
    ring.set(phase({ frac: 0.25 }));
    const quarter = wedgeOf(ring.el);
    ring.set(phase({ frac: 0.75 }));

    expect(wedgeOf(ring.el)).not.toBe(quarter);
    // Past the halfway point the arc has to be flagged as the large one, or the
    // wedge collapses back through the short way round.
    expect(wedgeOf(ring.el)).toContain(' 1 1 ');
  });

  it('carries one state at a time, so the colours cannot stack', () => {
    const ring = createLoopRing();
    ring.set(phase({ state: 'armed' }));
    ring.set(phase({ state: 'imminent' }));

    expect(ring.el.classList.contains('imminent')).toBe(true);
    expect(ring.el.classList.contains('armed')).toBe(false);
    // The class the host styles off is still there alongside the state.
    expect(ring.el.classList.contains('scene-ring')).toBe(true);
  });

  it('names itself for a screen reader', () => {
    const ring = createLoopRing({ label: 'Loop position for Bass' });
    expect(ring.el.getAttribute('aria-label')).toBe('Loop position for Bass');
  });
});
