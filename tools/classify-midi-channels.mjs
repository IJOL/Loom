// Classify MIDI files by number of distinct note-bearing channels.
// 1-4 channels  -> "loops" (simple); >4 channels -> full arrangements.
// Usage:
//   node tools/classify-midi-channels.mjs [dir]            # dry run, prints a table
//   node tools/classify-midi-channels.mjs [dir] --move     # also moves 1-4ch files into <dir>/loops/
import { readFileSync, readdirSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'midi-library';
const MOVE = process.argv.includes('--move');

function readVarLen(buf, pos) {
  let value = 0, byte;
  do { byte = buf[pos++]; value = (value << 7) | (byte & 0x7f); } while (byte & 0x80);
  return [value, pos];
}

// Returns { channels:Set<number> (with note-on/off events), ntrks }
function analyze(buf) {
  if (buf.toString('ascii', 0, 4) !== 'MThd') throw new Error('not a Standard MIDI File');
  const ntrks = buf.readUInt16BE(10);
  let pos = 14;
  const channels = new Set();
  for (let t = 0; t < ntrks; t++) {
    if (buf.toString('ascii', pos, pos + 4) !== 'MTrk') break;
    const len = buf.readUInt32BE(pos + 4);
    pos += 8;
    const end = pos + len;
    let running = 0;
    while (pos < end) {
      let dt; [dt, pos] = readVarLen(buf, pos); // delta time
      let status = buf[pos];
      if (status & 0x80) { pos++; }            // new status byte
      else { status = running; }                // running status: byte is data, don't advance
      const hi = status & 0xf0;
      if (status === 0xff) {                     // meta: type + varlen + data
        pos++; let mlen; [mlen, pos] = readVarLen(buf, pos); pos += mlen; running = 0;
      } else if (status === 0xf0 || status === 0xf7) { // sysex: varlen + data
        let slen; [slen, pos] = readVarLen(buf, pos); pos += slen; running = 0;
      } else if (hi >= 0x80 && hi <= 0xe0) {     // channel voice
        running = status;
        const ch = status & 0x0f;
        if (hi === 0x90 || hi === 0x80) channels.add(ch); // count channels that actually play notes
        pos += (hi === 0xc0 || hi === 0xd0) ? 1 : 2;       // program change / channel pressure = 1 data byte
      } else {
        break; // malformed — stop this track
      }
    }
    pos = end;
  }
  return { channels, ntrks };
}

const files = readdirSync(DIR).filter((f) => /\.midi?$/i.test(f));
const rows = [];
for (const f of files) {
  try {
    const { channels, ntrks } = analyze(readFileSync(join(DIR, f)));
    rows.push({ f, n: channels.size, chs: [...channels].sort((a, b) => a - b).join(','), ntrks });
  } catch (e) {
    rows.push({ f, n: -1, chs: 'ERR ' + e.message, ntrks: -1 });
  }
}
rows.sort((a, b) => a.n - b.n || a.f.localeCompare(b.f));

console.log('ch  trk  file                                                         channels');
for (const r of rows) {
  console.log(`${String(r.n).padStart(2)}  ${String(r.ntrks).padStart(3)}  ${r.f.padEnd(58)} [${r.chs}]`);
}
const loops = rows.filter((r) => r.n >= 1 && r.n <= 4);
const full = rows.filter((r) => r.n > 4);
const err = rows.filter((r) => r.n < 0);
console.log(`\nTOTAL ${rows.length} | loops(1-4ch) ${loops.length} | full(>4ch) ${full.length} | err ${err.length}`);

if (MOVE) {
  const loopsDir = join(DIR, 'loops');
  if (!existsSync(loopsDir)) mkdirSync(loopsDir);
  let moved = 0;
  for (const r of loops) { renameSync(join(DIR, r.f), join(loopsDir, r.f)); moved++; }
  console.log(`\nMOVED ${moved} loop file(s) -> ${loopsDir}`);
} else {
  console.log('\n(dry run — re-run with --move to move the 1-4ch files into loops/)');
}
