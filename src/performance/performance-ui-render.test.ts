// @vitest-environment jsdom
// Characterisation of renderPerformanceView after the lit-html migration: the
// DOM contract (classes, ids, data attributes) that the e2e suite and
// knob-automation-menu's revealTimelineCurve query, plus the main interactions.
// Structure assertions are deliberately selector-based (never innerHTML
// comparisons) so lit's marker comments stay invisible to them.
import { describe, it, expect, vi } from 'vitest';
import { renderPerformanceView, type PerfUICallbacks } from './performance-ui';
import type { ArrangementState } from './performance';

function makeState(over: Partial<ArrangementState> = {}): ArrangementState {
  return {
    bpm: 120, // barSec = 2s
    durationSec: 8, // 4 bars
    lengthBars: 0,
    lanes: [{
      laneId: 'lane1',
      clipEvents: [{ clipId: 'c1', laneId: 'lane1', atSec: 0, untilSec: 2 }],
      automation: [{ paramId: 'lane1.filter.cutoff', values: [0.5, 0.5], enabled: true }],
    }],
    globalAutomation: [],
    ...over,
  } as ArrangementState;
}

function makeCb(over: Partial<PerfUICallbacks> = {}): PerfUICallbacks {
  return {
    onPlay: vi.fn(), onStop: vi.fn(), onGoToSession: vi.fn(),
    resolveClipColor: () => '#ff6600',
    resolveClipName: () => 'Clip A',
    registry: new Map(),
    destinations: { list: () => [], subscribe: () => () => {} },
    laneIds: ['lane1'],
    pxPerBar: 80,
    getBrush: () => 'line', setBrush: vi.fn(),
    painterDeps: { seq: { isPlaying: () => false }, getAutoAbsSubIdx: () => 0 },
    onSetLengthBars: vi.fn(), onZoom: vi.fn(),
    onAddCurve: vi.fn(), onRemoveCurve: vi.fn(), onEdited: vi.fn(),
    loopEnabled: false, loopStartBar: 0, loopEndBar: 4,
    onSetLoop: vi.fn(), onMoveBand: vi.fn(), onResizeBand: vi.fn(), onDeleteBand: vi.fn(),
    ...over,
  } as unknown as PerfUICallbacks;
}

describe('renderPerformanceView', () => {
  it('renders toolbar, ruler, clip band, automation lane and playhead', () => {
    const host = document.createElement('div');
    const cb = makeCb();
    renderPerformanceView(host, makeState(), cb);

    expect(host.classList.contains('performance-view')).toBe(true);
    expect(host.querySelectorAll('.perf-toolbar')).toHaveLength(1);
    expect(host.querySelectorAll('.perf-ruler .perf-bar-mark')).toHaveLength(4);
    expect(host.querySelectorAll('.perf-auto-header select')).toHaveLength(1);

    const clip = host.querySelector('.perf-clip') as HTMLElement;
    expect(clip.textContent).toContain('Clip A');
    expect(clip.classList.contains('missing')).toBe(false);
    expect(clip.style.left).toBe('0px');
    expect(clip.style.width).toBe('80px'); // 1 bar of 2s at 80px/bar
    expect(clip.querySelector('.perf-clip-handle.l')).toBeTruthy();
    expect(clip.querySelector('.perf-clip-handle.r')).toBeTruthy();

    // revealTimelineCurve's scroll target (main.ts queries [data-param-id]).
    const lane = host.querySelector('.perf-auto-lane') as HTMLElement;
    expect(lane.getAttribute('data-param-id')).toBe('lane1.filter.cutoff');

    expect(host.querySelector('#perf-playhead')).toBeTruthy();
  });

  it('marks a clip whose color cannot resolve as missing', () => {
    const host = document.createElement('div');
    renderPerformanceView(host, makeState(), makeCb({ resolveClipColor: () => '' }));
    const clip = host.querySelector('.perf-clip') as HTMLElement;
    expect(clip.classList.contains('missing')).toBe(true);
  });

  it('shows the empty state (and no timeline) when there is no content', () => {
    const host = document.createElement('div');
    const cb = makeCb();
    renderPerformanceView(host, makeState({ durationSec: 0, lanes: [] }), cb);

    expect(host.querySelector('.perf-empty')).toBeTruthy();
    expect(host.querySelector('.perf-ruler')).toBeNull();
    expect(host.querySelector('#perf-playhead')).toBeNull();

    const back = host.querySelector('.perf-empty-back') as HTMLButtonElement;
    expect(back.textContent).toBe('Back to Session');
    back.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(cb.onGoToSession).toHaveBeenCalledTimes(1);
  });

  it('re-renders in place without duplicating content', () => {
    const host = document.createElement('div');
    renderPerformanceView(host, makeState(), makeCb());
    renderPerformanceView(host, makeState(), makeCb());
    expect(host.querySelectorAll('.perf-toolbar')).toHaveLength(1);
    expect(host.querySelectorAll('.perf-clip')).toHaveLength(1);
    expect(host.querySelectorAll('#perf-playhead')).toHaveLength(1);
  });

  it('recovers from the empty state once content exists (state-driven branch)', () => {
    const host = document.createElement('div');
    renderPerformanceView(host, makeState({ durationSec: 0, lanes: [] }), makeCb());
    expect(host.querySelector('.perf-empty')).toBeTruthy();
    renderPerformanceView(host, makeState(), makeCb());
    expect(host.querySelector('.perf-empty')).toBeNull();
    expect(host.querySelector('.perf-clip')).toBeTruthy();
  });

  it('deletes a band through its × button without triggering the body drag', () => {
    const host = document.createElement('div');
    const cb = makeCb();
    renderPerformanceView(host, makeState(), cb);
    const del = host.querySelector('.perf-clip-del') as HTMLButtonElement;
    del.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(cb.onDeleteBand).toHaveBeenCalledWith('lane1', 0);
  });

  it('renders the loop brace + per-lane span when the loop is on, and the toggle disables it', () => {
    const host = document.createElement('div');
    const cb = makeCb({ loopEnabled: true, loopStartBar: 1, loopEndBar: 3 });
    renderPerformanceView(host, makeState(), cb);

    const brace = host.querySelector('.perf-loop-brace') as HTMLElement;
    expect(brace.style.left).toBe('80px');
    expect(brace.style.width).toBe('160px');
    expect(host.querySelector('.perf-loop-span')).toBeTruthy();

    (host.querySelector('.perf-loop-toggle') as HTMLButtonElement)
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(cb.onSetLoop).toHaveBeenCalledWith(false, 1, 3);
  });

  it('omits brace and span when the loop is off', () => {
    const host = document.createElement('div');
    renderPerformanceView(host, makeState(), makeCb({ loopEnabled: false }));
    expect(host.querySelector('.perf-loop-brace')).toBeNull();
    expect(host.querySelector('.perf-loop-span')).toBeNull();
  });
});
