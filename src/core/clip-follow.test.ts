import { describe, it, expect, beforeEach } from 'vitest';
import {
  isFollowEnabled, setFollowEnabled, toggleFollow, followScrollTarget,
} from './clip-follow';

describe('Follow flag', () => {
  beforeEach(() => setFollowEnabled(true));

  it('defaults to enabled', () => {
    expect(isFollowEnabled()).toBe(true);
  });
  it('set + toggle update and report state', () => {
    setFollowEnabled(false);
    expect(isFollowEnabled()).toBe(false);
    expect(toggleFollow()).toBe(true);
    expect(isFollowEnabled()).toBe(true);
  });
});

describe('followScrollTarget', () => {
  it('returns null when the content fits the viewport', () => {
    expect(followScrollTarget(50, 400, 400, 0)).toBeNull();
    expect(followScrollTarget(50, 400, 300, 0)).toBeNull();
  });
  it('centers the playhead when zoomed (content wider than viewport)', () => {
    // playhead at 1000, viewport 400 -> target = 1000 - 200 = 800
    expect(followScrollTarget(1000, 400, 4000, 0)).toBe(800);
  });
  it('clamps to [0, contentWidth - viewportWidth]', () => {
    expect(followScrollTarget(50, 400, 4000, 1000)).toBe(0);      // near start
    expect(followScrollTarget(3990, 400, 4000, 0)).toBe(3600);    // near end
  });
  it('returns null when already within threshold of the target', () => {
    // target would be 800; current 799 -> delta 1 < 2 -> null
    expect(followScrollTarget(1000, 400, 4000, 799)).toBeNull();
    expect(followScrollTarget(1000, 400, 4000, 700)).toBe(800);
  });
});
