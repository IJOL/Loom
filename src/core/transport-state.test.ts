import { describe, it, expect } from 'vitest';
import { createGlobalTransport, createLaneTransport } from './transport-state';

describe('transport state', () => {
  it('createGlobalTransport defaults to stopped, bpm=120', () => {
    const g = createGlobalTransport();
    expect(g.isPlaying).toBe(false);
    expect(g.bpm).toBe(120);
    expect(g.startedAt).toBe(0);
  });

  it('createLaneTransport defaults to stopped, no clip', () => {
    const l = createLaneTransport();
    expect(l.playing).toBe(false);
    expect(l.currentClipIndex).toBeNull();
    expect(l.loopStartedAt).toBe(0);
  });
});
