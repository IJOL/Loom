// tools/fetch-strudel-piano.mjs
// ONE-SHOT. Fetches the piano bank Strudel's `.piano()` actually plays and
// writes it as a bundled Loom instrument.
//
//   node tools/fetch-strudel-piano.mjs
//
// Six of the ported tunes end on `.piano()`. That is not a soundfont: it is a
// 29-sample bank of a real piano (felixroos/dough-samples/piano.json), rooted
// every three semitones from A0 to C8. Rendering a GM piano instead would have
// been the cheaper path and it is the one thing that would NOT sound like the
// original, so the bank comes over as-is.
//
// The mp3s are kept as mp3: `decodeAudioData` reads them, and re-encoding to
// WAV would multiply 9 MB by about eight for no gain in fidelity.

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'public', 'instruments', 'strudel-piano');
const MANIFEST = 'https://raw.githubusercontent.com/felixroos/dough-samples/main/piano.json';

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** `Ds1` / `A0` — the bank's own note spelling, where `s` is a sharp. */
function noteToMidi(name) {
  const m = /^([A-G])(s?)(-?\d+)$/.exec(name);
  if (!m) throw new Error(`not a note name: ${name}`);
  return PC[m[1]] + (m[2] ? 1 : 0) + (Number(m[3]) + 1) * 12;
}

const bank = await fetch(MANIFEST).then((r) => r.json());
const base = bank._base;
const entries = Object.entries(bank.piano)
  .map(([note, file]) => ({ midi: noteToMidi(note), note, file }))
  .sort((a, b) => a.midi - b.midi);

mkdirSync(OUT, { recursive: true });
for (const e of entries) {
  const dest = join(OUT, e.file);
  if (existsSync(dest)) { console.log(`  = ${e.file}`); continue; }
  const bytes = Buffer.from(await fetch(base + e.file).then((r) => r.arrayBuffer()));
  writeFileSync(dest, bytes);
  console.log(`  + ${e.file}  ${(bytes.length / 1024).toFixed(0)} kB`);
}

// Each zone reaches halfway to its neighbours, so no note is repitched by more
// than a tone and a half. The lowest and highest run to the ends of MIDI rather
// than leaving the extremes silent.
const zones = entries.map((e, i) => {
  const prev = entries[i - 1];
  const next = entries[i + 1];
  return {
    file: `strudel-piano/${e.file}`,
    rootNote: e.midi,
    loNote: prev ? Math.floor((prev.midi + e.midi) / 2) + 1 : 0,
    hiNote: next ? Math.floor((e.midi + next.midi) / 2) : 127,
  };
});

writeFileSync(
  join(OUT, '..', 'strudel-piano.json'),
  JSON.stringify({ id: 'strudel-piano', name: 'Piano', family: 'melodic', zones }, null, 2) + '\n',
);
console.log(`wrote strudel-piano.json — ${zones.length} zones, MIDI ${zones[0].loNote}..${zones[zones.length - 1].hiNote}`);
