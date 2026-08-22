// Measures how loud every shipped preset actually is, and writes the table a
// LAYER slot is normalised against.
//
//   npx tsx tools/measure-preset-energy.ts        (writes public/presets/preset-energy.json)
//
// Rendered through the REAL VoiceManager and the REAL plugin DSP — the same
// path the worklet takes — because the only honest answer to "how loud is this
// patch" is to play it. Anything derived from the params instead would be a
// second implementation of every engine, wrong in a different way for each.
//
// ENERGY is the RMS of a whole three-second note: the strike, the body and the
// tail. Not peak — a Rhodes spikes and gets out of the way while a sustaining
// saw sits at its peak all note, so matching peaks leaves the Rhodes buried.
// Not the sustained body alone either, which would punish anything percussive.
//
// The measurement INCLUDES both declared trims (the engine's manifest
// `outputTrim` and the preset's own `output.trim`), so what is left for the
// normaliser to correct is exactly what those two did not already fix.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const g = globalThis as unknown as Record<string, unknown>;
g.Loom = {
  apiVersion: 1,
  registerRenderer: (id: string, make: unknown) => { CAPTURED.set(id, make); },
  registerModulatorKernel: () => { /* not needed to measure a bare note */ },
};
const CAPTURED = new Map<string, unknown>();

const { VoiceManager } = await import('../src/audio-dsp/voice-manager');
const { registerRenderer } = await import('../src/audio-dsp/renderer-registry');
const { pluginSynthTrim } = await import('../src/plugins/capabilities');

const ENGINES = ['tb303', 'subtractive', 'fm', 'wavetable', 'karplus', 'westcoast'];
for (const id of ENGINES) await import(`../plugins/${id}/dsp`);
for (const [id, make] of CAPTURED) registerRenderer(id, make as never);

interface Preset { name: string; params: Record<string, number> }
interface Manifest { components: { params: { id: string; default: number }[] }[] }

const SR = 48000;
const SECONDS = 3;
const NOTE = { midi: 60, beginSec: 0, durationSec: 1.5, velocity: 0.9, accent: false, slide: false };

/** How many renders are averaged per preset.
 *
 *  More than one because some engines are NOT deterministic: karplus excites
 *  its string with noise, so the same patch measured twice can differ by 2.7 dB
 *  — enough to move a shipped number by more than the thing it is correcting.
 *  Found by a test whose two halves disagreed run to run. Averaging five brings
 *  the spread of the published figure down to a fraction of a decibel, and
 *  costs seconds in a tool nobody runs in a loop. */
const PASSES = 5;

/** One preset's energy, exactly as a slot will render it before normalisation. */
function energyOf(engineId: string, manifest: Manifest, preset: Preset): number {
  let acc = 0;
  for (let k = 0; k < PASSES; k++) acc += renderOnce(engineId, manifest, preset);
  return acc / PASSES;
}

function renderOnce(engineId: string, manifest: Manifest, preset: Preset): number {
  const bag: Record<string, number> = {};
  for (const c of manifest.components) for (const p of c.params) bag[p.id] = p.default;
  for (const [k, v] of Object.entries(preset.params)) if (typeof v === 'number') bag[k] = v;
  bag['output.trim'] = preset.params['output.trim'] ?? 1;
  const vm = new VoiceManager(SR, engineId, bag);
  vm.spawn(NOTE as never);
  let sum = 0, n = 0;
  for (let i = 0; i < SR * SECONDS; i++) {
    const s = vm.renderSample(i / SR);
    if (!Number.isFinite(s)) break;
    sum += s * s; n++;
  }
  return n === 0 ? 0 : Math.sqrt(sum / n) * (pluginSynthTrim(engineId) ?? 1);
}

const levels: Record<string, number> = {};
for (const id of ENGINES) {
  const manifest = (await import(`../plugins/${id}/plugin.json`, { with: { type: 'json' } })).default as Manifest;
  const file = (await import(`../plugins/${id}/presets.json`, { with: { type: 'json' } })).default as { presets: Preset[] };
  for (const p of file.presets) levels[`${id}::${p.name}`] = +energyOf(id, manifest, p).toFixed(6);
  console.log(`${id}: ${file.presets.length} presets`);
}

const sorted = Object.values(levels).sort((a, b) => a - b);
const target = +sorted[Math.floor(sorted.length / 2)].toFixed(6);

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'presets');
mkdirSync(OUT, { recursive: true });
// The TARGET ships with the numbers it was derived from. Computing it at load
// time from whatever the table happens to contain would let a plugin's presets
// move the centre of the catalogue simply by being installed.
writeFileSync(join(OUT, 'preset-energy.json'),
  JSON.stringify({ target, levels }, null, 2) + '\n');
const db = (x: number) => (20 * Math.log10(x)).toFixed(1);
console.log(`\ntarget (median) = ${target}`);
console.log(`spread ${db(sorted[sorted.length - 1] / sorted[0])} dB across ${sorted.length} presets`);
console.log('wrote public/presets/preset-energy.json');
