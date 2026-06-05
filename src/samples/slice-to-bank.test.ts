// src/samples/slice-to-bank.test.ts
import { describe, it, expect } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { slicesToKeymap, audioBufferToWavBytes } from './slice-to-bank';
import { SLICE_BASE_NOTE } from '../core/slice-clip';

describe('slicesToKeymap', () => {
  it('maps each slice id to a single-note entry from SLICE_BASE_NOTE', () => {
    const km = slicesToKeymap(['a', 'b', 'c']);
    expect(km).toHaveLength(3);
    expect(km[0]).toEqual({ sampleId: 'a', rootNote: SLICE_BASE_NOTE, loNote: SLICE_BASE_NOTE, hiNote: SLICE_BASE_NOTE });
    expect(km[2].rootNote).toBe(SLICE_BASE_NOTE + 2);
    expect(km[2].loNote).toBe(km[2].hiNote); // single-note range
  });
});

describe('audioBufferToWavBytes', () => {
  it('encodes a buffer to RIFF/WAVE bytes', async () => {
    const ctx = new OfflineAudioContext(1, 1000, 44100);
    const buf = ctx.createBuffer(1, 1000, 44100);
    const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.sin(i / 10);
    const bytes = await audioBufferToWavBytes(buf as unknown as AudioBuffer);
    const head = new Uint8Array(bytes, 0, 4);
    expect(String.fromCharCode(...head)).toBe('RIFF');
    expect(bytes.byteLength).toBeGreaterThan(44);
  });
});
