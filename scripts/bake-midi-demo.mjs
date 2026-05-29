#!/usr/bin/env node
// Usage: npx tsx scripts/bake-midi-demo.mjs <fixtureName>
//   <fixtureName>  e.g. "sweet-dreams" (resolves to tests/fixtures/midi/sweet-dreams.mid)
//
// Reads tests/fixtures/midi/<name>.mapping.json and writes the resulting
// SessionState to public/demos/<name>.json. The mapping JSON drives the
// importer's per-track preset choices.
//
// NOTE: This intentionally bakes ONLY tonal lanes — the drumClip produced by
// midiToSession is NOT written to the demo JSON. The drum lane (with its kit)
// is created/managed by the live importer flow (Add/Replace path); the pure
// transform does not own that lane. Baked demos are "tonal-only" content; the
// user adds drums interactively.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseMidiFile } from '../src/midi/midi-parse.ts';
import { midiToSession } from '../src/midi/midi-to-session.ts';

const name = process.argv[2];
if (!name) { console.error('usage: bake-midi-demo <fixtureName>'); process.exit(1); }

const midiBuf  = new Uint8Array(readFileSync(resolve('tests/fixtures/midi', `${name}.mid`)));
const mapping  = JSON.parse(readFileSync(resolve('tests/fixtures/midi', `${name}.mapping.json`), 'utf8'));
const parsed   = parseMidiFile(midiBuf);
const result   = midiToSession(parsed, {
  selectedTrackIndices: mapping.selectedTrackIndices,
  presetPerTrack: mapping.presetPerTrack ?? {},
  drumKitMatch: mapping.drumKitMatch ?? null,
});

const sessionState = {
  lanes: result.newLanes,
  scenes: [result.scene],
  globalQuantize: '1/1',
};

mkdirSync('public/demos', { recursive: true });
writeFileSync(resolve('public/demos', `${name}.json`), JSON.stringify(sessionState, null, 2));
console.log(`wrote public/demos/${name}.json — ${result.newLanes.length} lanes, ${result.drumClip ? 'with drums (NOT baked)' : 'no drums'}, bpm ${result.bpm ?? '(none)'}`);
