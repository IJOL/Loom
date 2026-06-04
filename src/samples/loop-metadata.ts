// Pure parser for embedded loop metadata in audio file bytes. Reads RIFF/WAVE
// (fmt /cue /smpl/acid) and AIFF (COMM/MARK/APPL) chunks. Returns null when the
// container is unrecognised. No Web Audio dependency — operates on raw bytes.

export interface LoopMetadata {
  originalBpm?: number;
  beats?: number;
  slicePointsSec?: number[];
  rootNote?: number;
  loopStartSec?: number;
  loopEndSec?: number;
}

function tag(dv: DataView, off: number): string {
  return String.fromCharCode(dv.getUint8(off), dv.getUint8(off + 1), dv.getUint8(off + 2), dv.getUint8(off + 3));
}

export function parseLoopMetadata(bytes: ArrayBuffer): LoopMetadata | null {
  if (bytes.byteLength < 12) return null;
  const dv = new DataView(bytes);
  const head = tag(dv, 0);
  if (head === 'RIFF' && tag(dv, 8) === 'WAVE') return parseWave(dv);
  if (head === 'FORM' && (tag(dv, 8) === 'AIFF' || tag(dv, 8) === 'AIFC')) return parseAiff(dv);
  return null;
}

function parseWave(dv: DataView): LoopMetadata {
  const md: LoopMetadata = {};
  let sampleRate = 44100;
  let off = 12;
  const end = dv.byteLength;
  // first pass: fmt for sample rate (chunks can be in any order). Guard the
  // p+12 read so a truncated `fmt ` can't throw on untrusted input.
  for (let p = 12; p + 8 <= end;) {
    const id = tag(dv, p); const size = dv.getUint32(p + 4, true);
    if (id === 'fmt ' && p + 16 <= end) { sampleRate = dv.getUint32(p + 12, true); break; }
    p += 8 + size + (size & 1);
  }
  // Every chunk-body read is clamped to chunkEnd = min(buffer end, body+size),
  // so a malformed/truncated chunk yields partial metadata instead of throwing.
  while (off + 8 <= end) {
    const id = tag(dv, off);
    const size = dv.getUint32(off + 4, true);
    const body = off + 8;
    const chunkEnd = Math.min(end, body + size);
    if (id === 'cue ' && body + 4 <= chunkEnd) {
      const count = dv.getUint32(body, true);
      const pts: number[] = [];
      for (let i = 0; i < count; i++) {
        const base = body + 4 + i * 24;
        if (base + 24 > chunkEnd) break;
        pts.push(dv.getUint32(base + 20, true) / sampleRate);
      }
      md.slicePointsSec = pts.sort((a, b) => a - b);
    } else if (id === 'smpl' && body + 36 <= chunkEnd) {
      md.rootNote = dv.getUint32(body + 12, true);
      const numLoops = dv.getUint32(body + 28, true);
      if (numLoops > 0 && body + 36 + 16 <= chunkEnd) {
        const loopBase = body + 36;
        md.loopStartSec = dv.getUint32(loopBase + 8, true) / sampleRate;
        md.loopEndSec = dv.getUint32(loopBase + 12, true) / sampleRate;
      }
    } else if (id === 'acid' && body + 24 <= chunkEnd) {
      md.beats = dv.getUint32(body + 12, true);   // dwNumBeats at offset 0x0C
      const tempo = dv.getFloat32(body + 20, true); // fTempo at offset 0x14
      if (Number.isFinite(tempo) && tempo > 1) md.originalBpm = tempo;
    }
    off = body + size + (size & 1);
  }
  return md;
}

/** Decode an 80-bit IEEE-754 extended float (big-endian) to a Number. */
function readExtended(dv: DataView, off: number): number {
  const expo = dv.getUint16(off, false);
  const hi = dv.getUint32(off + 2, false);
  const lo = dv.getUint32(off + 6, false);
  const sign = expo & 0x8000 ? -1 : 1;
  const e = (expo & 0x7fff) - 16383;
  const mant = hi * 2 ** 32 + lo;
  return sign * mant * 2 ** (e - 63);
}

function parseAiff(dv: DataView): LoopMetadata {
  const md: LoopMetadata = {};
  let rate = 44100;
  let off = 12;
  const end = dv.byteLength;
  // first pass: COMM for the sample rate. Guard the 10-byte extended read
  // (channels u16 + frames u32 + bits u16 + 80-bit rate = 18 bytes of body).
  for (let p = 12; p + 8 <= end;) {
    const id = tag(dv, p); const size = dv.getUint32(p + 4, false);
    if (id === 'COMM' && p + 8 + 18 <= end) { rate = readExtended(dv, p + 8 + 8) || 44100; break; }
    p += 8 + size + (size & 1);
  }
  while (off + 8 <= end) {
    const id = tag(dv, off);
    const size = dv.getUint32(off + 4, false);
    const body = off + 8;
    const chunkEnd = Math.min(end, body + size); // clamp marker scan to this chunk
    if (id === 'MARK' && body + 2 <= chunkEnd) {
      const count = dv.getUint16(body, false);
      const pts: number[] = [];
      let o = body + 2;
      // need id(2)+pos(4)+nameLen(1) = 7 bytes before each read; clamped to chunkEnd.
      for (let i = 0; i < count && o + 7 <= chunkEnd; i++) {
        o += 2; // marker id
        const pos = dv.getUint32(o, false); o += 4;
        pts.push(pos / rate);
        const nameLen = dv.getUint8(o); o += 1 + nameLen;
        if ((1 + nameLen) & 1) o += 1; // pad to even
      }
      md.slicePointsSec = pts.sort((a, b) => a - b);
    }
    off = body + size + (size & 1);
  }
  return md;
}
