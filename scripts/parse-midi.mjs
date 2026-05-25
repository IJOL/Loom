// Quick SMF parser — prints note events with absolute tick / sec time per track.
// Usage: node scripts/parse-midi.mjs <path>
import fs from 'node:fs';

const path = process.argv[2];
if (!path) { console.error('usage: parse-midi.mjs <midi>'); process.exit(1); }
const buf = fs.readFileSync(path);

let p = 0;
const u8  = () => buf[p++];
const u16 = () => (buf[p++] << 8) | buf[p++];
const u32 = () => ((buf[p++]) * 0x1000000) + (buf[p++] << 16) + (buf[p++] << 8) + buf[p++];
const vlq = () => {
  let v = 0, b;
  do { b = buf[p++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80);
  return v;
};
const bytes = (n) => { const out = buf.slice(p, p + n); p += n; return out; };

if (buf.slice(0, 4).toString() !== 'MThd') throw new Error('not SMF');
p = 4;
const headerLen = u32();
const format = u16();
const ntracks = u16();
const division = u16();
p = 4 + 4 + headerLen;

console.log(`SMF format=${format} tracks=${ntracks} division=${division} (ticks/quarter)`);

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const noteName = (n) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;

let tempoUsPerQuarter = 500000; // default 120 BPM

for (let t = 0; t < ntracks; t++) {
  if (buf.slice(p, p + 4).toString() !== 'MTrk') break;
  p += 4;
  const trackLen = u32();
  const trackEnd = p + trackLen;

  let abs = 0;
  let lastStatus = 0;
  const noteOn = new Map(); // note -> startTick
  const events = [];
  let trackName = '';
  let programs = new Set();

  while (p < trackEnd) {
    abs += vlq();
    let status = buf[p];
    if (status < 0x80) { status = lastStatus; } else { p++; lastStatus = status; }

    if (status === 0xff) {
      const type = u8();
      const len = vlq();
      const data = bytes(len);
      if (type === 0x03) trackName = data.toString();
      else if (type === 0x51 && len === 3) {
        tempoUsPerQuarter = (data[0] << 16) | (data[1] << 8) | data[2];
      }
    } else if (status === 0xf0 || status === 0xf7) {
      const len = vlq(); bytes(len);
    } else {
      const high = status & 0xf0;
      const ch   = status & 0x0f;
      if (high === 0x80 || high === 0x90) {
        const note = u8();
        const vel = u8();
        const isOff = high === 0x80 || vel === 0;
        if (!isOff) {
          noteOn.set(note, abs);
        } else {
          const start = noteOn.get(note);
          if (start != null) {
            events.push({ start, end: abs, note, ch });
            noteOn.delete(note);
          }
        }
      } else if (high === 0xc0) {
        programs.add(u8());
      } else if (high === 0xa0 || high === 0xb0 || high === 0xe0) {
        p += 2; // 2-byte messages
      } else if (high === 0xd0) {
        p += 1;
      }
    }
  }

  const secPerTick = (tempoUsPerQuarter / 1e6) / division;
  console.log(`\n=== Track ${t}: "${trackName}" — ${events.length} notes, programs=${[...programs]}`);
  // Print up to first 64 notes
  for (let i = 0; i < Math.min(events.length, 64); i++) {
    const e = events[i];
    const secStart = e.start * secPerTick;
    const beatStart = e.start / division;
    const durSec = (e.end - e.start) * secPerTick;
    console.log(`  ${beatStart.toFixed(3).padStart(7)}b ${secStart.toFixed(2).padStart(6)}s  ch${e.ch}  ${noteName(e.note).padEnd(4)}(${e.note})  dur ${durSec.toFixed(2)}s`);
  }
  if (events.length > 64) console.log(`  ... (+${events.length - 64} more)`);
}
