// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { mountWaveformHeader, renderAudioClipEditor } from './clip-waveform-header';
import type { SessionClip } from '../session';
import { DEFAULT_METER } from '../../core/meter';

function stubCanvas() {
  const ctx2d = new Proxy({}, { get: () => () => {} }) as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx2d as never);
}

const audioClip = (): SessionClip => ({
  id: 'c1', name: 'beat', lengthBars: 2, notes: [],
  sample: { sampleId: 'smp-x', mode: 'loop', warp: true, warpMode: 'stretch', originalBpm: 120, trimStart: 0, trimEnd: 4 },
});

describe('clip-waveform-header', () => {
  it('mountWaveformHeader mounts a canvas and returns a redraw handle', () => {
    stubCanvas();
    const host = document.createElement('div');
    const handle = mountWaveformHeader(host, audioClip(), DEFAULT_METER);
    expect(host.querySelector('canvas')).toBeTruthy();
    expect(typeof handle.redraw).toBe('function');
  });

  it('renderAudioClipEditor shows the warp toggle but NO BPM/bars spans nor Slice → pads button', () => {
    stubCanvas();
    const host = document.createElement('div');
    renderAudioClipEditor(host, audioClip(), DEFAULT_METER, {});
    // The audio lane is a pure WAV channel now: warp stays; BPM/length live in
    // the inspector (no duplicate spans here), slicing is gone.
    const pill = host.querySelector('.audio-clip-warp') as HTMLElement;
    expect(pill).toBeTruthy();
    expect(pill.textContent === 'ON' || pill.textContent === 'OFF').toBe(true);
    expect(host.querySelector('.audio-clip-bpm')).toBeNull();
    expect(host.querySelector('.audio-clip-slice')).toBeNull();
  });

  it('mounts the warp marker editor only when the clip sample is the warpRef', () => {
    stubCanvas();
    const host = document.createElement('div');
    const clip = audioClip();
    clip.sample!.warpRef = true;
    clip.sample!.warpMarkers = [{ srcSec: 0, beat: 0 }, { srcSec: 4, beat: 16 }];
    renderAudioClipEditor(host, clip, DEFAULT_METER, { warp: { getOnsets: () => [], bpm: 120, onMarkersChange: () => {} } });
    expect(host.querySelector('.warp-layer')).toBeTruthy();

    const host2 = document.createElement('div');
    renderAudioClipEditor(host2, audioClip(), DEFAULT_METER, {}); // no warpRef
    expect(host2.querySelector('.warp-layer')).toBeNull();
  });
});
