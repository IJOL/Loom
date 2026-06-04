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
  // ACID chunk layout: type(0) rootNote(4) ?(6) ?(8 float) numBeats(12)
  // meterDen(16) meterNum(18) tempo(20 float).
  const b = new Uint8Array(24); const dv = new DataView(b.buffer);
  dv.setUint32(0, 0, true);
  dv.setUint32(12, beats, true);   // dwNumBeats at 0x0C
  dv.setFloat32(20, tempo, true);  // fTempo at 0x14
  return chunk('acid', b);
}
// smpl chunk: 9 leading dwords (rootNote at +12, numLoops at +28), then per-loop
// 24-byte records (start at +8, end at +12 within the record).
function smpl(sampleRate: number, rootNote: number, startSec: number, endSec: number): Uint8Array {
  const b = new Uint8Array(36 + 24); const dv = new DataView(b.buffer);
  dv.setUint32(12, rootNote, true);   // dwMIDIUnityNote
  dv.setUint32(28, 1, true);          // cSampleLoops = 1
  dv.setUint32(36 + 8, Math.round(startSec * sampleRate), true);  // loop start (samples)
  dv.setUint32(36 + 12, Math.round(endSec * sampleRate), true);   // loop end (samples)
  return chunk('smpl', b);
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
  it('reads smpl root note + loop points', () => {
    const buf = riff(fmt(48000), smpl(48000, 60, 0.5, 1.5));
    const md = parseLoopMetadata(buf);
    expect(md?.rootNote).toBe(60);
    expect(md?.loopStartSec).toBeCloseTo(0.5, 5);
    expect(md?.loopEndSec).toBeCloseTo(1.5, 5);
  });
  it('does not throw on truncated chunks (untrusted input)', () => {
    // a real WAVE header followed by acid/smpl chunks whose declared size runs
    // past the buffer end — the parser must clamp, not throw.
    const truncatedAcid = chunk('acid', new Uint8Array(4)); // declares 4 bytes < 24 needed
    const buf = riff(fmt(44100), truncatedAcid);
    expect(() => parseLoopMetadata(buf)).not.toThrow();
    // garbage tail that looks like a chunk header with a huge size
    const garbage = new Uint8Array(40);
    const dv = new DataView(garbage.buffer);
    garbage[0] = 82; garbage[1] = 73; garbage[2] = 70; garbage[3] = 70; // RIFF
    dv.setUint32(4, 32, true);
    garbage[8] = 87; garbage[9] = 65; garbage[10] = 86; garbage[11] = 69; // WAVE
    for (let i = 0; i < 4; i++) garbage[12 + i] = 'cue '.charCodeAt(i);
    dv.setUint32(16, 0xffffffff, true); // absurd chunk size
    expect(() => parseLoopMetadata(garbage.buffer)).not.toThrow();
  });
});

// 80-bit IEEE extended (big-endian) encoder for a positive integer rate.
function ext80(value: number): Uint8Array {
  const out = new Uint8Array(10);
  let m = value, e = 16383 + 31;
  while ((m & 0x80000000) === 0 && m !== 0) { m <<= 1; e--; }
  const dv = new DataView(out.buffer);
  dv.setUint16(0, e, false);
  dv.setUint32(2, m >>> 0, false);
  dv.setUint32(6, 0, false);
  return out;
}
function aiffChunkBE(id: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + body.length + (body.length & 1));
  const dv = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) out[i] = id.charCodeAt(i);
  dv.setUint32(4, body.length, false);
  out.set(body, 8);
  return out;
}
function comm(rate: number, frames: number): Uint8Array {
  const b = new Uint8Array(18); const dv = new DataView(b.buffer);
  dv.setUint16(0, 2, false);       // channels
  dv.setUint32(2, frames, false);  // sampleFrames
  dv.setUint16(6, 16, false);      // bits
  b.set(ext80(rate), 8);           // sampleRate (80-bit extended)
  return aiffChunkBE('COMM', b);
}
function mark(framesList: number[]): Uint8Array {
  // numMarkers(u16), then per-marker: id(u16), position(u32), pstring name
  let len = 2;
  for (const _ of framesList) len += 2 + 4 + 2; // 1-char padded pstring
  const b = new Uint8Array(len); const dv = new DataView(b.buffer);
  dv.setUint16(0, framesList.length, false);
  let o = 2;
  framesList.forEach((f, i) => {
    dv.setUint16(o, i + 1, false); o += 2;
    dv.setUint32(o, f, false); o += 4;
    dv.setUint8(o, 0); o += 1; dv.setUint8(o, 0); o += 1; // empty pstring, padded
  });
  return aiffChunkBE('MARK', b);
}
function formAiff(...chunks: Uint8Array[]): ArrayBuffer {
  const bodyLen = chunks.reduce((a, c) => a + c.length, 0) + 4;
  const out = new Uint8Array(8 + bodyLen); const dv = new DataView(out.buffer);
  'FORM'.split('').forEach((ch, i) => { out[i] = ch.charCodeAt(0); });
  dv.setUint32(4, bodyLen, false);
  'AIFF'.split('').forEach((ch, i) => { out[8 + i] = ch.charCodeAt(0); });
  let off = 12; for (const c of chunks) { out.set(c, off); off += c.length; }
  return out.buffer;
}

describe('parseLoopMetadata AIFF', () => {
  it('reads MARK marker positions as slice seconds via COMM rate', () => {
    const rate = 44100;
    const buf = formAiff(comm(rate, rate), mark([0, rate / 4, rate / 2]));
    const md = parseLoopMetadata(buf);
    expect(md?.slicePointsSec).toEqual([0, 0.25, 0.5]);
  });
});
