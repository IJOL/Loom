// src/export/wav-encoder.test.ts
import { describe, it, expect } from 'vitest';
import { encodeWavPcm16, wavEncoder } from './wav-encoder';

function readStr(view: DataView, offset: number, len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

describe('encodeWavPcm16', () => {
  it('writes a valid 16-bit stereo WAV header', async () => {
    const left = Float32Array.from([0, 0.5, -0.5, 1]);
    const right = Float32Array.from([0, -0.5, 0.5, -1]);
    const blob = encodeWavPcm16([left, right], 48000);
    const buf = await blob.arrayBuffer();
    const view = new DataView(buf);

    expect(readStr(view, 0, 4)).toBe('RIFF');
    expect(readStr(view, 8, 4)).toBe('WAVE');
    expect(readStr(view, 12, 4)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1);        // PCM
    expect(view.getUint16(22, true)).toBe(2);        // stereo
    expect(view.getUint32(24, true)).toBe(48000);    // sample rate
    expect(view.getUint16(34, true)).toBe(16);       // bits/sample
    expect(readStr(view, 36, 4)).toBe('data');
    // 4 frames * 2 ch * 2 bytes = 16 data bytes; file = 44 + 16.
    expect(view.getUint32(40, true)).toBe(16);
    expect(buf.byteLength).toBe(60);
  });

  it('interleaves L/R and round-trips full-scale samples', async () => {
    const left = Float32Array.from([1, -1]);
    const right = Float32Array.from([-1, 1]);
    const buf = await encodeWavPcm16([left, right], 44100).arrayBuffer();
    const view = new DataView(buf);
    // Frame 0: L=+1 → 32767, R=-1 → -32768. Frame 1: L=-1, R=+1.
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
    expect(view.getInt16(48, true)).toBe(-32768);
    expect(view.getInt16(50, true)).toBe(32767);
  });

  it('exposes a wavEncoder AudioEncoder', () => {
    expect(wavEncoder.extension).toBe('wav');
    expect(wavEncoder.mimeType).toBe('audio/wav');
    expect(wavEncoder.encode([Float32Array.of(0)], 48000)).toBeInstanceOf(Blob);
  });

  it('encodes a mono (single-channel) WAV', async () => {
    const mono = Float32Array.from([1, -1, 0.5]);
    const buf = await encodeWavPcm16([mono], 48000).arrayBuffer();
    const view = new DataView(buf);
    expect(view.getUint16(22, true)).toBe(1);   // numChannels = 1
    expect(view.getUint16(32, true)).toBe(2);   // blockAlign = 1ch * 2 bytes
    expect(view.getUint32(40, true)).toBe(6);   // dataSize = 3 frames * 2 bytes
    expect(buf.byteLength).toBe(50);            // 44 header + 6 data
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
    expect(view.getInt16(48, true)).toBe(16384); // round(0.5 * 32767)
  });

  it('produces a valid empty WAV when given no channels', async () => {
    const buf = await encodeWavPcm16([], 48000).arrayBuffer();
    const view = new DataView(buf);
    expect(buf.byteLength).toBe(44);            // header only, no data
    expect(view.getUint16(22, true)).toBe(1);   // numChannels clamped to 1
    expect(view.getUint32(40, true)).toBe(0);   // dataSize = 0
  });
});
