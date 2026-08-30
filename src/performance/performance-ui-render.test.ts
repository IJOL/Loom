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
      clipEvents: [{ id: 'b1', clipId: 'c1', laneId: 'lane1', atSec: 0, untilSec: 2 }],
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
    meter: { num: 4, den: 4 },
    pxPerBar: 80,
    getBrush: () => 'line', setBrush: vi.fn(),
    onSetLengthBars: vi.fn(), onZoom: vi.fn(),
    onAddCurve: vi.fn(), onRemoveCurve: vi.fn(), onEdited: vi.fn(),
    loopEnabled: false, loopStartBar: 0, loopEndBar: 4,
    onSetLoop: vi.fn(), onMoveBand: vi.fn(), onResizeBand: vi.fn(), onDeleteBand: vi.fn(),
    ...over,
  } as unknown as PerfUICallbacks;
}

describe('renderPerformanceView', () => {
  it('rules the timeline in the SONG meter it is handed, not in 4/4', () => {
    const bars = (meter?: { num: number; den: number }) => {
      const host = document.createElement('div');
      renderPerformanceView(host, makeState({ durationSec: 12 }), makeCb(meter ? { meter } : {}));
      return host.querySelectorAll('.perf-ruler .perf-bar-mark').length;
    };
    // Relative: the same span of music is more bars when a bar is shorter.
    expect(bars({ num: 3, den: 4 }) / bars()).toBeCloseTo(4 / 3, 6);
  });

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

  it('renders ONE scroller that owns the timeline; rows live inside it', () => {
    const host = document.createElement('div');
    renderPerformanceView(host, makeState(), makeCb());
    expect(host.querySelectorAll('.perf-scroller')).toHaveLength(1);
    expect(host.querySelector('.perf-scroller .perf-ruler')).toBeTruthy();
    expect(host.querySelector('.perf-scroller .perf-clip')).toBeTruthy();
    expect(host.querySelector('.perf-scroller #perf-playhead')).toBeTruthy();
    // the toolbar stays OUTSIDE the scrolling surface
    expect(host.querySelector('.perf-scroller .perf-toolbar')).toBeNull();
  });

  it('clicking the ruler seeks to the clicked seconds', () => {
    const onSeek = vi.fn();
    const host = document.createElement('div');
    renderPerformanceView(host, makeState(), makeCb({ onSeek } as never));
    const track = host.querySelector('.perf-ruler .perf-track') as HTMLElement;
    // jsdom rects sit at 0, so clientX IS the track-local x: 120px at 80px/bar
    // over 2s bars → 3 seconds.
    track.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 120 }));
    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek.mock.calls[0][0]).toBeCloseTo(3, 6);
  });

  it('a band longer than its clip renders one looptick per extra iteration', () => {
    const host = document.createElement('div');
    const state = makeState({
      lanes: [{
        laneId: 'lane1',
        // 4 iterations of a 2s clip → 3 ticks
        clipEvents: [{ id: 'b1', clipId: 'c1', laneId: 'lane1', atSec: 0, untilSec: 8 }],
        automation: [],
      }],
    });
    const cb = makeCb({
      resolveClipInfo: () => ({ kind: 'audio', sampleId: 's1', loopSec: 2 }),
    } as never);
    renderPerformanceView(host, state, cb);
    expect(host.querySelectorAll('.perf-clip-looptick')).toHaveLength(3);
    expect(host.querySelector('.perf-clip-bars')!.textContent).toContain('1 bar');
  });

  it('paints muted and selected bands as such', () => {
    const host = document.createElement('div');
    const state = makeState();
    state.lanes[0].clipEvents[0].muted = true;
    renderPerformanceView(host, state, makeCb({ selection: new Set(['b1']) } as never));
    const clip = host.querySelector('.perf-clip') as HTMLElement;
    expect(clip.classList.contains('muted')).toBe(true);
    expect(clip.classList.contains('selected')).toBe(true);
    expect(clip.getAttribute('data-band-id')).toBe('b1');
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

  // The Line/Flat brush only affects painting an automation lane, so it belongs
  // in the automation row next to "+ Automation" — not in the main toolbar
  // beside Length/Zoom/Loop, and not on screen at all while nothing is paintable.
  it('keeps the brush out of the main toolbar, next to + Automation instead', () => {
    const host = document.createElement('div');
    renderPerformanceView(host, makeState(), makeCb());
    expect(host.querySelector('.perf-toolbar .perf-brush-bar')).toBeNull();
    expect(host.querySelector('.perf-auto-header .perf-brush-bar')).toBeTruthy();
  });

  it('hides the brush when no automation curve exists', () => {
    const host = document.createElement('div');
    const noCurves = makeState({
      lanes: [{
        laneId: 'lane1',
        clipEvents: [{ id: 'b1', clipId: 'c1', laneId: 'lane1', atSec: 0, untilSec: 2 }],
        automation: [],
      }],
    } as Partial<ArrangementState>);
    renderPerformanceView(host, noCurves, makeCb());

    expect(host.querySelector('.perf-auto-header')).toBeTruthy();  // "+ Automation" stays
    expect(host.querySelector('.perf-brush-bar')).toBeNull();
  });

  it('shows the brush for a master curve with no per-lane curve', () => {
    const host = document.createElement('div');
    const globalOnly = makeState({
      lanes: [{
        laneId: 'lane1',
        clipEvents: [{ id: 'b1', clipId: 'c1', laneId: 'lane1', atSec: 0, untilSec: 2 }],
        automation: [],
      }],
      globalAutomation: [{ paramId: 'master.gain', values: [0.5, 0.5], enabled: true }],
    } as Partial<ArrangementState>);
    renderPerformanceView(host, globalOnly, makeCb());
    expect(host.querySelector('.perf-auto-header .perf-brush-bar')).toBeTruthy();
  });

  it('switches the brush and highlights the active button', () => {
    const host = document.createElement('div');
    const cb = makeCb();
    renderPerformanceView(host, makeState(), cb);

    const [line, flat] = [...host.querySelectorAll('.perf-brush-bar button')] as HTMLButtonElement[];
    expect(line.textContent).toBe('Line');
    expect(flat.textContent).toBe('Flat');
    expect(line.classList.contains('primary')).toBe(true);   // getBrush() === 'line'

    flat.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(cb.setBrush).toHaveBeenCalledWith('flat');
    expect(flat.classList.contains('primary')).toBe(true);
    expect(line.classList.contains('primary')).toBe(false);
  });
});
