import { describe, it, expect } from 'vitest';
import { parseLoopMetadata } from './loop-metadata';

// ── tiny RIFF/WAVE builder for fixtures ──────────────────────────────────────
function chunk(id: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + body.length + (body.length % 2));
  const dv = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) out[i] = id.charCodeAt(i);
  dv.setUint32(4, body.length, true);
  out.set(body, 8);
  return out;
}
function riff(...chunks: Uint8Array[]): ArrayBuffer {
  const bodyLen = chunks.reduce((a, c) => a + c.length, 0) + 4;
  const out = new Uint8Array(8 + bodyLen);
  const dv = new DataView(out.buffer);
  out[0] = 82; out[1] = 73; out[2] = 70; out[3] = 70; // RIFF
  dv.setUint32(4, bodyLen, true);
  out[8] = 87; out[9] = 65; out[10] = 86; out[11] = 69; // WAVE
  let off = 12;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out.buffer;
}
function fmt(sampleRate: number): Uint8Array {
  const b = new Uint8Array(16); const dv = new DataView(b.buffer);
  dv.setUint16(0, 1, true); dv.setUint16(2, 2, true);
  dv.setUint32(4, sampleRate, true); dv.setUint32(8, sampleRate * 4, true);
  dv.setUint16(12, 4, true); dv.setUint16(14, 16, true);
  return chunk('fmt ', b);
}
function cue(sampleRate: number, offsetsSec: number[]): Uint8Array {
  const body = new Uint8Array(4 + offsetsSec.length * 24);
  const dv = new DataView(body.buffer);
  dv.setUint32(0, offsetsSec.length, true);
  offsetsSec.forEach((sec, i) => {
    const base = 4 + i * 24;
    dv.setUint32(base, i + 1, true);            // dwName
    dv.setUint32(base + 20, Math.round(sec * sampleRate), true); // dwSampleOffset
  });
  return chunk('cue ', body);
}
function acid(beats: number, tempo: number): Uint8Array {
  const b = new Uint8Array(24); const dv = new DataView(b.buffer);
  dv.setUint32(0, 0, true);
  dv.setUint32(8, beats, true);
  dv.setFloat32(20, tempo, true);
  return chunk('acid', b);
}

describe('parseLoopMetadata', () => {
  it('returns null for non-RIFF bytes', () => {
    expect(parseLoopMetadata(new Uint8Array([1, 2, 3, 4]).buffer)).toBeNull();
  });
  it('reads cue points as slice seconds using fmt sample rate', () => {
    const buf = riff(fmt(48000), cue(48000, [0.0, 0.25, 0.5, 0.75]));
    const md = parseLoopMetadata(buf);
    expect(md?.slicePointsSec).toEqual([0, 0.25, 0.5, 0.75]);
  });
  it('reads acid tempo + beats', () => {
    const buf = riff(fmt(44100), acid(8, 174));
    const md = parseLoopMetadata(buf);
    expect(md?.originalBpm).toBeCloseTo(174, 3);
    expect(md?.beats).toBe(8);
  });
});
