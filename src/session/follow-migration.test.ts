// A follower's leaderId is a reference into the same session, and the loader is
// the one place that can tell whether it still resolves.

import { describe, it, expect } from 'vitest';
import { migrateLoadedSessionState } from './session-migration';
import type { SessionState } from './session';

const lane = (id: string, extra: Record<string, unknown> = {}) => ({
  id, engineId: 'subtractive', clips: [null], inserts: [], ...extra,
});

const load = (lanes: unknown[]) =>
  migrateLoadedSessionState({ lanes } as unknown as SessionState);

describe('lane.follow survives a load', () => {
  it('keeps a leaderId that names a lane still present', () => {
    const out = load([lane('a'), lane('b', { follow: { leaderId: 'a' } })]);
    expect(out.lanes[1].follow).toEqual({ leaderId: 'a' });
  });

  it('drops a leaderId naming a lane that is gone', () => {
    const out = load([lane('b', { follow: { leaderId: 'ghost' } })]);
    expect(out.lanes[0].follow).toBeUndefined();
  });

  it('drops a lane following ITSELF — the cycle of one', () => {
    const out = load([lane('b', { follow: { leaderId: 'b' } })]);
    expect(out.lanes[0].follow).toBeUndefined();
  });

  it('leaves a lane that follows nobody alone', () => {
    const out = load([lane('a')]);
    expect(out.lanes[0].follow).toBeUndefined();
  });

  it('resolves a leader declared AFTER the follower', () => {
    // The check runs after the per-lane loop precisely so order cannot matter:
    // a follower listed first must still find a leader listed second.
    const out = load([lane('b', { follow: { leaderId: 'a' } }), lane('a')]);
    expect(out.lanes[0].follow).toEqual({ leaderId: 'a' });
  });
});
