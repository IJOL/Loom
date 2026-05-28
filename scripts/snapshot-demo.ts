// One-shot: generate public/demos/minimal-techno.json from the existing
// programmatic demo. Run with `npx tsx scripts/snapshot-demo.ts`. The
// output is the source of truth — re-run only when the demo changes.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PatternBank } from '../src/core/pattern';
import { buildMinimalTechnoDemo } from '../src/demo/demo-minimal-techno';
import { importClassicToSession } from '../src/session/session-migration';
import type { SessionState } from '../src/session/session';

// Per-scene preset map. Order matches the 4 PatternBank slots the demo
// creates: A (warm), B (bright stab), C (glass), D (soft sine). TB-303
// rotates through its three engine presets, drums stays on default kit.
const SCENE_PRESETS: Array<Record<string, string>> = [
  { 'subtractive-1': 'factory:PAD Warm',         'subtractive-2': 'factory:PAD Sweep',          'tb-303-1': 'engine:Acid Classic' },
  { 'subtractive-1': 'factory:LEAD Bright Saw',  'subtractive-2': 'factory:LEAD Soft Sine',     'tb-303-1': 'engine:Dub Sub'      },
  { 'subtractive-1': 'factory:PAD Glass',        'subtractive-2': 'factory:PAD Detuned Strings','tb-303-1': 'engine:Squelch'      },
  { 'subtractive-1': 'factory:LEAD Soft Sine',   'subtractive-2': 'factory:PAD Choir Aah',      'tb-303-1': 'engine:Acid Classic' },
];

function main(): void {
  const bank = new PatternBank(32);
  const patterns = buildMinimalTechnoDemo();
  for (let i = 0; i < 4; i++) bank.slots[i] = patterns[i];
  const state: SessionState = importClassicToSession(bank);

  // Boot preset: scene A's selection per lane.
  for (const lane of state.lanes) {
    const bootPreset = SCENE_PRESETS[0][lane.id];
    if (bootPreset) lane.enginePresetName = bootPreset;
  }
  // Per-scene preset map.
  state.scenes.forEach((scene, idx) => {
    scene.presetPerLane = SCENE_PRESETS[idx] ?? {};
  });

  const outPath = resolve(import.meta.dirname, '../public/demos/minimal-techno.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(state, null, 2) + '\n', 'utf8');
  console.log(`wrote ${outPath} (${state.lanes.length} lanes, ${state.scenes.length} scenes)`);
}

main();
