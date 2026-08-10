// What is actually IN the pattern library, harmonically.
//
//   npx tsx tools/loop-fingerprints.ts [style] [kind]
//   npx tsx tools/loop-fingerprints.ts acid-techno bass
//   npx tsx tools/loop-fingerprints.ts --styles          (one line per style)
//
// WEAVE's automatic mode draws loops at random and nothing measures whether the
// one it picks agrees with the one already playing. Before deciding what a
// better rule looks like, it is worth SEEING what the library holds: which
// notes each loop leans on, and therefore which loops could follow which.
//
// Read-only. It loads the same JSON the app fetches at boot and prints; it
// writes nothing and changes nothing.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setLibrary, patternNotes, patternsFor, stylesWithPatterns } from '../src/patterns/pattern-library';
import { profileFromNotes } from '../src/analysis/pitch-profile';
import { detectKey } from '../src/analysis/key-detect';
import { TICKS_PER_QUARTER } from '../src/core/notes';
import { rootName, type StyleId } from '../src/core/musicality';
import type { PatternKind } from '../src/patterns/pattern-library';

const BAR = TICKS_PER_QUARTER * 4;
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** The library as the browser gets it, read off disk instead of fetched. */
function loadLibrary(): void {
  const dir = join(process.cwd(), 'public', 'patterns');
  const read = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
  setLibrary({
    synth: read('patterns-s1.json'),
    drums: read('patterns-t8-drums.json'),
    bass: read('patterns-t8-bass.json'),
    catalog: read('catalog.json'),
  } as never);
}

/** The pitch classes a loop leans on, biggest share first, as a readable line.
 *  Anything under 5% is left out — it is passing colour, not what the loop is
 *  about, and printing it would bury the two notes that matter. */
function fingerprint(profile: Float32Array): string {
  const sum = [...profile].reduce((a, b) => a + b, 0);
  if (sum === 0) return '(silent)';
  return [...profile]
    .map((v, pc) => ({ pc, share: v / sum }))
    .filter((x) => x.share >= 0.05)
    .sort((a, b) => b.share - a.share)
    .map((x) => `${NOTE_NAMES[x.pc].padEnd(2)}${(x.share * 100).toFixed(0).padStart(3)}%`)
    .join('  ');
}

/** Every loop of one shelf, one line each. */
function printShelf(style: StyleId, kind: PatternKind): void {
  const entries = patternsFor(style, kind);
  if (entries.length === 0) {
    console.log(`\n${style} / ${kind}: nothing on this shelf\n`);
    return;
  }
  // The root the weave itself uses for this kind (weave-loops.ts rootFor), so
  // the pitches printed are the pitches that would actually sound.
  const root = kind === 'bass' ? 36 : 48;
  console.log(`\n${style} / ${kind} — ${entries.length} loops, root ${root}\n`);
  console.log(`${'loop'.padEnd(26)} ${'range'.padEnd(11)} ${'key'.padEnd(11)} leans on`);
  console.log('-'.repeat(96));

  for (const e of entries) {
    const notes = patternNotes(style, kind, e.index, root);
    if (notes.length === 0) continue;
    const lo = Math.min(...notes.map((n) => n.midi));
    const hi = Math.max(...notes.map((n) => n.midi));
    const profile = profileFromNotes(notes, BAR);
    const k = detectKey(profile);
    // Percussion has no key worth reporting: a drum note picks a voice, not a
    // pitch, so the detector would be reading the GM map as if it were music.
    const key = kind === 'drums' ? '—' : `${rootName(k.key)} ${k.scale}`.padEnd(11);
    console.log(
      `${e.name.slice(0, 25).padEnd(26)} ${`${lo}..${hi}`.padEnd(11)} ${key} ${fingerprint(profile)}`,
    );
  }
}

/** One line per style: how many loops on each shelf, and how much they agree. */
function printStyles(): void {
  console.log(`\n${'style'.padEnd(16)} ${'bass'.padStart(5)} ${'synth'.padStart(6)} ${'drums'.padStart(6)}   most common root among melodic loops`);
  console.log('-'.repeat(96));
  for (const style of stylesWithPatterns()) {
    const counts = (['bass', 'synth', 'drums'] as PatternKind[])
      .map((k) => patternsFor(style, k).length);
    const roots = new Map<number, number>();
    for (const kind of ['bass', 'synth'] as PatternKind[]) {
      for (const e of patternsFor(style, kind)) {
        const notes = patternNotes(style, kind, e.index, kind === 'bass' ? 36 : 48);
        if (notes.length === 0) continue;
        const k = detectKey(profileFromNotes(notes, BAR));
        roots.set(k.key, (roots.get(k.key) ?? 0) + 1);
      }
    }
    const total = [...roots.values()].reduce((a, b) => a + b, 0);
    const top = [...roots.entries()].sort((a, b) => b[1] - a[1])[0];
    const agree = top && total
      ? `${rootName(top[0])} (${((top[1] / total) * 100).toFixed(0)}% of ${total})`
      : '—';
    console.log(
      `${style.padEnd(16)} ${String(counts[0]).padStart(5)} ${String(counts[1]).padStart(6)} ${String(counts[2]).padStart(6)}   ${agree}`,
    );
  }
  console.log('');
}

loadLibrary();
const [a, b] = process.argv.slice(2);
if (!a || a === '--styles') printStyles();
else printShelf(a as StyleId, (b ?? 'bass') as PatternKind);
