// Characterises the ring's caption source: the label recorded at the launch
// site, honoured only while the boundary it was recorded against is pending.
import { describe, it, expect } from 'vitest';
import { queuedLabelFor, type QueuedLabel } from './session-host-queued-label';
import { emptyLanePlayState, type LanePlayState } from './session-runtime';
import type { SessionClip } from './session';

function clip(id: string): SessionClip {
  return { color: '#a8c8e8', gridResolution: '1/16', id, lengthBars: 4, notes: [] };
}

function queuedAt(boundary: number): Map<string, LanePlayState> {
  const lp: LanePlayState = { ...emptyLanePlayState('A') };
  lp.playing = clip('p');
  lp.queued = clip('q');
  lp.queuedBoundary = boundary;
  return new Map([['A', lp]]);
}

describe('queuedLabelFor', () => {
  it('returns the recorded label while its boundary is still pending', () => {
    const rec: QueuedLabel = { label: 'Break', boundary: 8 };
    expect(queuedLabelFor(rec, queuedAt(8))).toBe('Break');
  });

  it('ignores a label recorded against a different boundary', () => {
    const rec: QueuedLabel = { label: 'Break', boundary: 8 };
    expect(queuedLabelFor(rec, queuedAt(16))).toBeNull();
  });

  it('ignores the label once nothing is queued', () => {
    const rec: QueuedLabel = { label: 'Break', boundary: 8 };
    const lp: LanePlayState = { ...emptyLanePlayState('A') };
    lp.playing = clip('p');
    expect(queuedLabelFor(rec, new Map([['A', lp]]))).toBeNull();
  });

  it('returns null when nothing was ever recorded', () => {
    expect(queuedLabelFor(null, queuedAt(8))).toBeNull();
  });

  it('matches the NEAREST pending boundary, not just any of them', () => {
    const a: LanePlayState = { ...emptyLanePlayState('A') };
    a.playing = clip('pa'); a.queued = clip('qa'); a.queuedBoundary = 4;
    const b: LanePlayState = { ...emptyLanePlayState('B') };
    b.playing = clip('pb'); b.queued = clip('qb'); b.queuedBoundary = 8;
    const m = new Map([['A', a], ['B', b]]);
    expect(queuedLabelFor({ label: 'Near', boundary: 4 }, m)).toBe('Near');
    expect(queuedLabelFor({ label: 'Far', boundary: 8 }, m)).toBeNull();
  });
});
