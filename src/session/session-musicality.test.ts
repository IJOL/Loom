import { describe, it, expect } from 'vitest';
import { resolveTonality, DEFAULT_MUSICALITY, emptySessionState } from './session';
import type { SessionState, SessionLane } from './session';

const baseState = (): SessionState => ({
  lanes: [], scenes: [], globalQuantize: 'immediate',
  musicality: { key: 9, scale: 'minor', style: 'acid', lock: true },
});

describe('resolveTonality', () => {
  it('uses the global tonality when the lane has no override', () => {
    const lane = { id: 'l1', engineId: 'tb303', clips: [] } as SessionLane;
    expect(resolveTonality(lane, baseState())).toEqual({ key: 9, scale: 'minor' });
  });
  it('lets a lane override key and/or scale field-by-field', () => {
    const lane = { id: 'l1', engineId: 'tb303', clips: [], musicalityOverride: { scale: 'major' } } as SessionLane;
    expect(resolveTonality(lane, baseState())).toEqual({ key: 9, scale: 'major' });
  });
  it('falls back to DEFAULT_MUSICALITY when the state has none', () => {
    const lane = { id: 'l1', engineId: 'tb303', clips: [] } as SessionLane;
    const s = { lanes: [], scenes: [], globalQuantize: 'immediate' } as SessionState;
    expect(resolveTonality(lane, s)).toEqual({ key: DEFAULT_MUSICALITY.key, scale: DEFAULT_MUSICALITY.scale });
  });
});

describe('emptySessionState seeds the default musicality', () => {
  it('a fresh session has the default tonality with the scale lock OFF', () => {
    expect(emptySessionState().musicality).toEqual(DEFAULT_MUSICALITY);
    // Scale lock defaults OFF: a new session must never silently constrain
    // which notes the user can place. The lock is opt-in via the tonality bar.
    expect(emptySessionState().musicality?.lock).toBe(false);
  });
});
