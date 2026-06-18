// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createPerfView } from './perf-view';
import type { PerfSnapshot } from './perf-monitor';

function snap(over: Partial<PerfSnapshot> = {}): PerfSnapshot {
  return {
    audioSupported: true, avgLoad: 0.37, peakLoad: 0.61, underrunRatio: 0,
    lagMs: 4, lagMaxMs: 22, tickDurMs: 1.8, fps: 58, frameMs: 17,
    voicesTotal: 12, voicesByLane: [{ laneId: 'bass', count: 8 }, { laneId: 'drums', count: 4 }],
    genNodes: 84, histLoad: [0.1, 0.2, 0.4], histLag: [2, 4, 8], histFps: [60, 59, 58],
    events: [{ tSec: 12.3, kind: 'late-tick', detail: 'late tick +31ms' }],
    ...over,
  };
}

describe('createPerfView', () => {
  it('renders live numbers in the HUD', () => {
    const v = createPerfView();
    v.render(snap());
    expect(v.el.querySelector('[data-f="audio"]')!.textContent).toContain('37%');
    expect(v.el.querySelector('[data-f="fps"]')!.textContent).toContain('58');
    expect(v.el.querySelector('[data-f="voices"]')!.textContent).toContain('12');
  });

  it('shows n/d for audio load when unsupported', () => {
    const v = createPerfView();
    v.render(snap({ audioSupported: false }));
    expect(v.el.querySelector('[data-f="audio"]')!.textContent).toContain('n/d');
  });

  it('fills the panel (lanes + log) only after expanding', () => {
    const v = createPerfView();
    v.render(snap());
    const lanes = v.el.querySelector('[data-f="lanes"]')!;
    expect(lanes.textContent).toBe(''); // collapsed → not filled
    (v.el.querySelector('[data-f="expand"]') as HTMLElement).click();
    v.render(snap());
    expect(lanes.textContent).toContain('bass');
    expect(v.el.querySelector('[data-f="log"]')!.textContent).toContain('late tick');
  });

  it('dispose removes the element', () => {
    const v = createPerfView();
    document.body.appendChild(v.el);
    v.dispose();
    expect(document.body.contains(v.el)).toBe(false);
  });
});
