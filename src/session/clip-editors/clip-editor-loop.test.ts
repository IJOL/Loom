// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderLoopEditor } from './clip-editor-loop';
import type { SessionClip } from '../session';
import { DEFAULT_METER } from '../../core/meter';

function clip(): SessionClip {
  return {
    id: 'c1', lengthBars: 1,
    notes: [
      { start: 0, duration: 24, midi: 36, velocity: 90 },
      { start: 48, duration: 24, midi: 37, velocity: 90 },
    ],
    sample: {
      sampleId: 'smp-x', mode: 'loop', warp: true, warpMode: 'slice', originalBpm: 120,
      trimStart: 0, trimEnd: 2,
      slices: [{ start: 0, end: 1, note: 36 }, { start: 1, end: 2, note: 37 }],
    },
  };
}

describe('renderLoopEditor', () => {
  it('mounts a toolbar + canvas and shows the detected bpm', () => {
    const host = document.createElement('div');
    // jsdom's canvas getContext returns null; stub a no-op 2d context.
    const ctx2d = new Proxy({}, { get: () => () => {} }) as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx2d as never);
    const handle = renderLoopEditor(host, clip(), undefined, DEFAULT_METER, {});
    expect(host.querySelector('canvas')).toBeTruthy();
    expect(host.textContent).toContain('120'); // detected bpm shown in toolbar
    expect(typeof handle.redraw).toBe('function');
  });
});
