// Defaults-unchanged proof: render the SAME patches through the subtractive
// renderer at a git ref AND in the working tree, sample by sample, and report the
// largest absolute difference. Presets are voiced against the engine as it stands,
// so a change that claims to be opt-in must be bit-identical when not opted into
// — not merely close.
//
// It compares real revision against real revision (a pristine `git archive` of the
// ref into .baseline/, cleaned up afterwards), which is what a guard test inside
// one revision cannot do: that only proves "absent key == explicit default".
//
//   npx tsx tools/verify-defaults-unchanged.mjs [ref]      (default ref: HEAD)
import { execSync } from 'node:child_process';
import { rmSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REF = process.argv[2] ?? 'HEAD';
const BASE = resolve(ROOT, '.baseline');

rmSync(BASE, { recursive: true, force: true });
mkdirSync(BASE, { recursive: true });
// Unpack the ref's src/ verbatim. Relative imports resolve inside the copy, and
// node_modules still resolves by walking up to the repo root. Written as two
// pipe-free calls so it does not depend on which shell node happens to spawn.
// Both run WITH cwd set and relative paths: GNU tar reads a leading `C:\` as a
// remote host:path and refuses it.
const TAR = resolve(BASE, '_src.tar');
execSync(`git archive ${REF} src --format=tar --output="${TAR}"`, { cwd: ROOT, stdio: 'inherit' });
execSync('tar -xf _src.tar', { cwd: BASE, stdio: 'inherit' });
rmSync(TAR, { force: true });
if (!existsSync(resolve(BASE, 'src/audio-dsp/subtractive-renderer.ts'))) {
  console.error(`could not extract src/ from ${REF}`);
  process.exit(2);
}
const sha = execSync(`git rev-parse --short ${REF}`, { cwd: ROOT }).toString().trim();

// Dynamic, so the baseline exists before the module is resolved.
const { SubtractiveVoiceRenderer: Head } = await import('../.baseline/src/audio-dsp/subtractive-renderer.ts');
const { SubtractiveVoiceRenderer: Work } = await import('../src/audio-dsp/subtractive-renderer.ts');

const SR = 48000;
const note = (over = {}) => ({ midi: 57, beginSec: 0, durationSec: 0.4, velocity: 0.8, accent: false, slide: false, ...over });

// The engine defaults, exactly as a real lane sends them — with NO unison and NO
// filter.type keys, i.e. every preset that exists today.
const DEFAULTS = {
  'master.tune': 0,
  'osc1.wave': 0, 'osc1.level': 0.6, 'osc1.detune': 0, 'osc1.pw': 0.5,
  'osc2.wave': 1, 'osc2.level': 0.4, 'osc2.detune': 7, 'osc2.pw': 0.5,
  'sub.level': 0.3, 'noise.level': 0, 'noise.color': 0.6,
  'filter.cutoff': 0.55, 'filter.resonance': 0.25, 'filter.envAmount': 0.45,
  'filter.drive': 0, 'filter.keyTrack': 0, 'filter.builtinEnv': 1,
  'filter.attack': 0.01, 'filter.decay': 0.3, 'filter.sustain': 0.4, 'filter.release': 0.35,
  'amp.builtinEnv': 1, 'amp.attack': 0.01, 'amp.decay': 0.2, 'amp.sustain': 0.7, 'amp.release': 0.3,
};

// A spread of real patch shapes, so this is not one lucky configuration.
const CASES = [
  ['engine defaults', DEFAULTS, {}],
  ['DIG + resonance 1.0', { ...DEFAULTS, 'filter.resonance': 1.0 }, {}],
  ['MOG ladder', { ...DEFAULTS, 'filter.model': 1 }, {}],
  ['303 diode ladder', { ...DEFAULTS, 'filter.model': 2 }, {}],
  ['noise + drive', { ...DEFAULTS, 'noise.level': 0.5, 'filter.drive': 0.6 }, {}],
  ['square/PWM patch', { ...DEFAULTS, 'osc1.wave': 1, 'osc1.pw': 0.3 }, {}],
  ['tri + sine, detuned', { ...DEFAULTS, 'osc1.wave': 2, 'osc2.wave': 3, 'osc2.detune': 12 }, {}],
  ['accent note', DEFAULTS, { accent: true }],
  ['bass note (midi 33)', DEFAULTS, { midi: 33 }],
  ['high note (midi 93)', DEFAULTS, { midi: 93 }],
  ['low velocity', DEFAULTS, { velocity: 0.15 }],
  // Modulated: the LFO offset path must be untouched too.
  ['+ cutoff LFO', DEFAULTS, {}, (t) => ({ filterCutoff: Math.sin(2 * Math.PI * 5 * t) * 0.5 })],
  ['+ PWM LFO', { ...DEFAULTS, 'osc1.wave': 1 }, {}, (t) => ({ osc1Pw: Math.sin(2 * Math.PI * 4 * t) })],
  ['+ detune LFO', DEFAULTS, {}, (t) => ({ osc1Detune: Math.sin(2 * Math.PI * 3 * t) })],
];

// The noise oscillator is Math.random() — it can never be sample-identical across
// two instances, so a noise patch is compared on RMS instead of per sample.
const isNoisy = (bag) => (bag['noise.level'] ?? 0) > 0;

let worst = 0, worstCase = '', failures = 0;
console.log(`Rendering ${CASES.length} patches through ${REF} (${sha}) vs the working tree\n`);
for (const [label, bag, over, mod] of CASES) {
  const a = new Head(note(over), bag, SR);
  const b = new Work(note(over), bag, SR);
  let maxDelta = 0, sumA = 0, sumB = 0, n = 0;
  for (let i = 0; i < SR * 0.5; i++) {
    const t = i / SR;
    const m = mod ? mod(t) : undefined;
    const va = a.renderSample(t, m);
    const vb = b.renderSample(t, m);
    maxDelta = Math.max(maxDelta, Math.abs(va - vb));
    sumA += va * va; sumB += vb * vb; n++;
  }
  const rmsA = Math.sqrt(sumA / n), rmsB = Math.sqrt(sumB / n);
  if (isNoisy(bag)) {
    const rel = Math.abs(rmsA - rmsB) / Math.max(1e-9, rmsA);
    const ok = rel < 0.05;
    if (!ok) failures++;
    console.log(`  ${label.padEnd(22)} rms ${rmsA.toFixed(6)} vs ${rmsB.toFixed(6)}  (random noise: RMS within ${(rel * 100).toFixed(2)}%)  ${ok ? 'OK' : 'DIFFERS'}`);
    continue;
  }
  if (maxDelta > worst) { worst = maxDelta; worstCase = label; }
  const ok = maxDelta === 0;
  if (!ok) failures++;
  console.log(`  ${label.padEnd(22)} max|delta| = ${maxDelta}   rms ${rmsA.toFixed(6)}   ${ok ? 'BIT-IDENTICAL' : 'DIFFERS'}`);
}
console.log(`\nWorst non-noise delta: ${worst} (${worstCase || 'none'})`);
console.log(failures === 0 ? 'PASS — the defaults did not move.' : `FAIL — ${failures} case(s) changed.`);
rmSync(BASE, { recursive: true, force: true });
process.exit(failures === 0 ? 0 : 1);
