import { describe, it, expect } from 'vitest';
import {
  songBarSec, songPosBars, seekAnchorSec, reanchorOnSeek,
  barFromRulerX, rulerXOfBar,
} from './song-position';
import { DEFAULT_METER } from './meter';

describe('song-position', () => {
  it('songBarSec: one 4/4 bar at 120bpm is 2s', () => {
    expect(songBarSec(120, DEFAULT_METER)).toBeCloseTo(2, 6);
  });

  it('songPosBars: clamps to 0 before the anchor', () => {
    expect(songPosBars(5, 10, 120)).toBe(0);
  });

  it('songPosBars: 4s after anchor at 120bpm 4/4 is bar 2', () => {
    expect(songPosBars(14, 10, 120)).toBeCloseTo(2, 6);
  });

  it('seekAnchorSec then songPosBars round-trips the target bar', () => {
    const now = 100;
    const anchor = seekAnchorSec(3, now, 120);
    expect(songPosBars(now, anchor, 120)).toBeCloseTo(3, 6);
  });

  it('reanchorOnSeek: phase = targetSongSec mod clipDur', () => {
    // clip loops every 2s; target song-second 5 → phase 1 → anchor = now-1
    expect(reanchorOnSeek(2, 5, 100)).toBeCloseTo(99, 6);
  });

  it('reanchorOnSeek: exact multiple gives phase 0 (anchor = now)', () => {
    expect(reanchorOnSeek(2, 4, 100)).toBeCloseTo(100, 6);
  });

  it('reanchorOnSeek: zero clipDur is a no-op (anchor = now)', () => {
    expect(reanchorOnSeek(0, 5, 100)).toBe(100);
  });

  it('ruler x ↔ bar round-trips', () => {
    expect(barFromRulerX(120, 40)).toBeCloseTo(3, 6);
    expect(rulerXOfBar(3, 40)).toBeCloseTo(120, 6);
  });

  it('barFromRulerX clamps negatives to 0', () => {
    expect(barFromRulerX(-10, 40)).toBe(0);
  });
});
