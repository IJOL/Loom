#!/usr/bin/env node
// Usage: npx tsx scripts/bake-midi-demo.mjs <fixtureName>
//   <fixtureName>  e.g. "sweet-dreams" (resolves to tests/fixtures/midi/sweet-dreams.mid)
//
// Reads tests/fixtures/midi/<name>.mapping.json and writes the resulting
// SessionState to public/demos/<name>.json. The mapping JSON drives the
// importer's per-track preset choices.
//
// If the MIDI has ch10 notes, midiToSession returns a drumClip + drumKitMatch.
// The bake script wraps them in a dedicated drums lane (engineId 'drums-machine')
// so the demo is self-contained — load it and drums play out of the box.

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

// Rename lanes/clips to the preset name. SMF track names often carry
// song-header metadata ("Sweet Dreams", "(Are Made Of This)", …) split across
// multiple track-name events, which makes for ugly lane labels. Using the
// preset name ("BASS Reese", "LEAD Square") gives the user a meaningful label
// that reflects what each lane sounds like. mapping.nameOverridePerTrack can
// still override per track index if a fixture needs custom labels.
const overrides = mapping.nameOverridePerTrack ?? {};
const stripFactoryPrefix = (s) => s.replace(/^factory:/, '');
let laneIdx = 0;
for (const trIdx of mapping.selectedTrackIndices) {
  const tr = parsed.tracks.find((t) => t.index === trIdx);
  if (!tr) continue;
  const isDrum = tr.notes.some((n) => n.channel === 9);
  if (isDrum) continue;
  const lane = result.newLanes[laneIdx++];
  if (!lane) break;
  const newName = overrides[String(trIdx)] ?? stripFactoryPrefix(lane.enginePresetName ?? '') ?? lane.name;
  lane.name = newName;
  if (lane.clips[0]) lane.clips[0].name = newName;
}

// Wrap the drumClip in a real session lane and wire it into the scene.
const lanes = [...result.newLanes];
if (result.drumClip) {
  const drumKit = result.drumKitMatch ?? { engineId: 'drums-machine', presetName: 'KIT Standard' };
  const drumLane = {
    id: `lane-drums-${name}`,
    engineId: drumKit.engineId,
    name: drumKit.presetName,
    clips: [result.drumClip],
    enginePresetName: `factory:${drumKit.presetName}`,
  };
  lanes.push(drumLane);
  result.scene.clipPerLane[drumLane.id] = 0;
}

const sessionState = {
  lanes,
  scenes: [result.scene],
  globalQuantize: '1/1',
};

mkdirSync('public/demos', { recursive: true });
writeFileSync(resolve('public/demos', `${name}.json`), JSON.stringify(sessionState, null, 2));
console.log(`wrote public/demos/${name}.json — ${lanes.length} lanes${result.drumClip ? ' (incl. drums)' : ''}, bpm ${result.bpm ?? '(none)'}`);
