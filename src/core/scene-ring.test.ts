// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createSceneRing, wedgePath, type SceneRingDeps } from './scene-ring';
import { emptyLanePlayState, type LanePlayState } from '../session/session-runtime';
import type { SessionClip } from '../session/session';
import { DEFAULT_METER } from './meter';

const BPM = 120;
const BAR = 2;

function clip(id: string, lengthBars: number): SessionClip {
  return { color: '#a8c8e8', gridResolution: '1/16', id, lengthBars, notes: [] };
}

function makeDeps(over: Partial<SceneRingDeps> = {}): SceneRingDeps {
  const lp: LanePlayState = { ...emptyLanePlayState('A') };
  lp.playing = clip('p', 4);
  lp.loopStartedAt = 0;
  return {
    laneStates: () => new Map([['A', lp]]),
    now: () => 1 * BAR,
    bpm: () => BPM,
    meter: () => DEFAULT_METER,
    caption: () => 'Main Groove',
    ...over,
  };
}

/** A lane playing a 4-bar clip from 0 with a clip queued at 8 s. */
function queuedLane(): LanePlayState {
  const lp: LanePlayState = { ...emptyLanePlayState('A') };
  lp.playing = clip('p', 4);
  lp.loopStartedAt = 0;
  lp.queued = clip('q', 4);
  lp.queuedBoundary = 4 * BAR;
  return lp;
}

describe('wedgePath', () => {
  it('is empty at zero so nothing is drawn', () => {
    expect(wedgePath(0)).toBe('');
  });

  it('closes a full circle at one without collapsing the arc', () => {
    const d = wedgePath(1);
    expect(d).not.toBe('');
    expect(d).toContain('A'); // an arc command survived
    expect(d.trimEnd().endsWith('Z')).toBe(true);
  });

  it('flips the large-arc flag past the halfway point', () => {
    expect(wedgePath(0.25)).toMatch(/A 15 15 0 0 1/);
    expect(wedgePath(0.75)).toMatch(/A 15 15 0 1 1/);
  });
});

describe('createSceneRing', () => {
  it('builds a .scene-ring root holding an svg and a caption', () => {
    const ring = createSceneRing(makeDeps());
    expect(ring.el.classList.contains('scene-ring')).toBe(true);
    expect(ring.el.querySelector('svg')).not.toBeNull();
    expect(ring.el.querySelector('.ring-caption')).not.toBeNull();
    ring.dispose();
  });

  it('paints the idle state from the lane states', () => {
    const ring = createSceneRing(makeDeps());
    ring.refresh();
    expect(ring.el.classList.contains('idle')).toBe(true);
    expect(ring.el.querySelector('.ring-num')!.textContent).toBe('2');
    expect(ring.el.querySelector('.ring-caption')!.textContent).toBe('Main Groove');
    ring.dispose();
  });

  it('paints the armed state and captions the target', () => {
    const lp = queuedLane();
    const ring = createSceneRing(makeDeps({
      laneStates: () => new Map([['A', lp]]),
      caption: () => '→ Break',
    }));
    ring.refresh();
    expect(ring.el.classList.contains('armed')).toBe(true);
    expect(ring.el.classList.contains('idle')).toBe(false);
    expect(ring.el.querySelector('.ring-caption')!.textContent).toBe('→ Break');
    ring.dispose();
  });

  it('marks the last bar imminent', () => {
    const lp = queuedLane();
    const ring = createSceneRing(makeDeps({
      laneStates: () => new Map([['A', lp]]),
      now: () => 3.5 * BAR,
    }));
    ring.refresh();
    expect(ring.el.classList.contains('imminent')).toBe(true);
    ring.dispose();
  });

  it('empties the wedge and the readings when nothing plays', () => {
    const ring = createSceneRing(makeDeps({ laneStates: () => new Map() }));
    ring.refresh();
    expect(ring.el.querySelector('.ring-wedge')!.getAttribute('d')).toBe('');
    expect(ring.el.querySelector('.ring-num')!.textContent).toBe('');
    ring.dispose();
  });

  it('stops painting after dispose', () => {
    const ring = createSceneRing(makeDeps());
    ring.refresh();
    const before = ring.el.querySelector('.ring-wedge')!.getAttribute('d');
    ring.dispose();
    ring.refresh(); // a late RAF frame must be a no-op, not a crash
    expect(ring.el.querySelector('.ring-wedge')!.getAttribute('d')).toBe(before);
  });
});
