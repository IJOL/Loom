// src/midi/midi-parse.ts — pure SMF parser. No DOM, no audio.

export interface ParsedTrack {
  index: number;
  name: string;
  program: number;
  notes: { startTick: number; duration: number; midi: number; velocity: number; channel: number }[];
}

export interface ParsedMidi {
  division: number;
  bpm: number | null;
  tracks: ParsedTrack[];
}

export function parseMidiFile(buf: Uint8Array): ParsedMidi {
  let p = 0;
  const u8 = () => buf[p++];
  const u16 = () => (buf[p++] << 8) | buf[p++];
  const u32 = () => (buf[p++] * 0x1000000) + (buf[p++] << 16) + (buf[p++] << 8) + buf[p++];
  const vlq = () => { let v = 0, b; do { b = buf[p++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };

  if (String.fromCharCode(buf[0], buf[1], buf[2], buf[3]) !== 'MThd') throw new Error('not SMF');
  p = 4;
  const hLen = u32(); u16(); /* format */ const ntracks = u16(); const division = u16();
  p = 4 + 4 + hLen;
  const tracks: ParsedTrack[] = [];
  let bpm: number | null = null;
  let nextIndex = 0;

  for (let t = 0; t < ntracks; t++) {
    if (String.fromCharCode(buf[p], buf[p+1], buf[p+2], buf[p+3]) !== 'MTrk') break;
    p += 4;
    const tlen = u32();
    const tend = p + tlen;
    let abs = 0; let lastStatus = 0; let name = '';
    const noteOn = new Map<number, { start: number; velocity: number }>();
    // Demultiplex by MIDI channel: a format-0 file (and any multitimbral track)
    // carries every instrument in ONE MTrk, distinguished only by channel. Bucket
    // notes + program per channel so each becomes its own ParsedTrack below.
    const byCh = new Map<number, { program: number; notes: ParsedTrack['notes'] }>();
    const order: number[] = [];
    const chBucket = (ch: number) => {
      let e = byCh.get(ch);
      if (!e) { e = { program: -1, notes: [] }; byCh.set(ch, e); order.push(ch); }
      return e;
    };

    while (p < tend) {
      abs += vlq();
      let status = buf[p];
      if (status < 0x80) { status = lastStatus; } else { p++; lastStatus = status; }

      if (status === 0xff) {
        const type = u8(); const len = vlq();
        if (type === 0x03) {
          // Strip null terminators / control chars (0x00-0x1f) some exporters leave
          // in the track-name meta so lane + clip names are clean.
          name = String.fromCharCode(...buf.slice(p, p + len))
            .split('').filter((c) => c.charCodeAt(0) >= 0x20).join('').trim();
        } else if (type === 0x51 && len === 3 && bpm === null) {
          const us = (buf[p] << 16) | (buf[p+1] << 8) | buf[p+2];
          bpm = 60_000_000 / us;
        }
        p += len;
      } else if (status === 0xf0 || status === 0xf7) {
        const len = vlq(); p += len;
      } else {
        const high = status & 0xf0;
        const ch = status & 0x0f;
        if (high === 0x80 || high === 0x90) {
          const note = u8(); const vel = u8();
          const isOff = high === 0x80 || vel === 0;
          const key = (ch << 8) | note;
          if (!isOff) noteOn.set(key, { start: abs, velocity: vel });
          else {
            const onEvt = noteOn.get(key);
            if (onEvt != null) {
              chBucket(ch).notes.push({ startTick: onEvt.start, duration: abs - onEvt.start, midi: note, velocity: onEvt.velocity, channel: ch });
              noteOn.delete(key);
            }
          }
        } else if (high === 0xc0) {
          chBucket(ch).program = u8();
        } else if (high === 0xa0 || high === 0xb0 || high === 0xe0) {
          p += 2;
        } else if (high === 0xd0) {
          p += 1;
        }
      }
    }
    p = tend; // resync in case a malformed event left p mid-track

    const channels = order.filter((ch) => byCh.get(ch)!.notes.length > 0);
    if (channels.length === 0) {
      // meta-only MTrk (e.g. a tempo/marker track) — keep one empty entry.
      tracks.push({ index: nextIndex++, name, program: -1, notes: [] });
    } else if (channels.length === 1) {
      const e = byCh.get(channels[0])!;
      tracks.push({ index: nextIndex++, name, program: e.program, notes: e.notes });
    } else {
      // Multi-channel MTrk → one virtual track per channel. The MTrk name (a song
      // title in format-0) doesn't identify an instrument, so drop it; the import
      // titles each lane from the channel's GM program instead.
      for (const ch of channels) {
        const e = byCh.get(ch)!;
        tracks.push({ index: nextIndex++, name: '', program: e.program, notes: e.notes });
      }
    }
  }
  return { division, bpm, tracks };
}
