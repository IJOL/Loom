// tools/lane-bench.ts
// How long a LANE takes to render 10 s with a knob in flight, driven through the
// real VoiceManager.
//
// Why this exists, and why param-read-bench.ts was not enough: that bench
// attaches the live params ITSELF, by calling the renderer's hook directly. That
// made its number depend on which hook the bench happened to know about — and
// for subtractive it knew the wrong one. Subtractive never implemented
// setLiveParams (it had its own setLiveSubParams, handed out by the
// VoiceManager), so `r.setLiveParams?.(live)` was a silent no-op and the
// "baseline" measured subtractive's FROZEN trigger-snapshot path: no live reads
// at all, and a Math.pow cache that never invalidated because nothing read the
// knob that was moving. That number was not comparable to anything.
//
// Here the VoiceManager wires the voices, exactly as the worklet does. Whatever
// contract an engine speaks, production's own code picks it — so the same file
// measures the old design and the new one and the comparison is honest.
//
// Realism note: the knob message arrives every CONTROL_INTERVAL samples, not
// every sample, because that is what a UI does. The smoother then ramps toward
// it, so the live values still change every single sample and no read can be
// hoisted out of the loop — which is the property the measurement needs (see the
// refuted "39x" in param-read-bench.ts).

// MODULATION MODES. Production ALWAYS attaches a ModulationRuntime — the worklet
// does it unconditionally (loom-processor.ts) — so a run without one measures a
// path that never ships, and it hides the whole modulation half of the hot loop:
// VoiceManager.fillOffsets is skipped entirely, and every renderer's `mo?.name`
// read short-circuits on an undefined. Two modes, because they cost differently
// and both are real:
//   none — a runtime with NO modulators. The COMMON case, and the interesting
//          one: subtractive still pays 20 named offsetFor calls per sample,
//          each walking an empty list, for nothing at all.
//   lfo  — one LFO on the engine's moving param. What a modulated lane costs.
import { VoiceManager } from '../src/audio-dsp/voice-manager';
import { ModulationRuntime, type ModLite } from '../src/audio-dsp/modulation-runtime';
import '../src/audio-dsp/modulators/lfo-kernel';
import { referenceFor, defaultParams, NOTE, SR } from './gen-engine-reference';
import type { ParamBag } from '../src/audio-dsp/types';

const SECONDS = 10;
const VOICES = 8;
const RUNS = 5;
/** ~10 ms at 48 kHz — a plausible rate for knob messages from the UI. */
const CONTROL_INTERVAL = 512;

/** The continuous param each engine will have in flight. Every engine declares
 *  one, and it is the one a hand actually holds. Same choices as
 *  param-read-bench.ts so the two tools stay legible side by side. */
const MOVING: Record<string, string> = {
  tb303:       'filter.cutoff',
  subtractive: 'filter.cutoff',
  fm:          'amp.mix',
  wavetable:   'filter.cutoff',
  westcoast:   'lpg.cutoff',
  karplus:     'string.damping',
};

/** The name a modulator addresses the moving param by — a param's own dot-id,
 *  for every engine. Subtractive used to be the exception (flat SubParams field
 *  names), and this table kept saying 'filterCutoff' after that stopped being
 *  true: its `lfo` runs were measured with an INERT modulator. The runtime's
 *  "no slot for target" warning is what surfaced it. */
const MOD_TARGET: Record<string, string> = {
  tb303:       'filter.cutoff',
  subtractive: 'filter.cutoff',
  fm:          'amp.mix',
  wavetable:   'filter.cutoff',
  westcoast:   'lpg.cutoff',
  karplus:     'string.damping',
};

function makeLfo(engineId: string): ModLite {
  return {
    id: 'bench-lfo',
    kind: 'lfo',
    driver: 'time',
    enabled: true,
    rateHz: 3,
    waveform: 'sine',
    depthByParam: { [MOD_TARGET[engineId]]: 0.4 },
  };
}

function once(engineId: string, params: ParamBag, mode: 'none' | 'lfo'): number {
  const vm = new VoiceManager(SR, engineId, params);
  vm.setMaxVoices(VOICES);
  // Always attached, like production. `none` means an EMPTY modulator set, not
  // an absent runtime — the difference is the point.
  const runtime = new ModulationRuntime(SR);
  runtime.setMods(mode === 'lfo' ? [makeLfo(engineId)] : []);
  vm.setModulation(runtime);
  for (let v = 0; v < VOICES; v++) {
    vm.spawn({ ...NOTE, midi: NOTE.midi + v, durationSec: SECONDS });
  }

  const moving = MOVING[engineId];
  const base = params[moving] ?? 0.5;
  // One reusable patch object: a fresh literal per message would time the
  // allocator as much as the renderer.
  const patch: ParamBag = { [moving]: base };
  const n = SR * SECONDS;

  const t0 = process.hrtime.bigint();
  let sink = 0;
  for (let i = 0; i < n; i++) {
    if ((i % CONTROL_INTERVAL) === 0) {
      patch[moving] = base * (1 + 0.3 * ((i / CONTROL_INTERVAL) & 1));
      vm.setParams(patch);
    }
    sink += vm.renderSample(i / SR);
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  if (!Number.isFinite(sink)) throw new Error(`${engineId} rendered a non-finite sum`);
  return ms;
}

function median(xs: number[]): number {
  return [...xs].sort((a, b) => a - b)[xs.length >> 1];
}

const engineId = process.argv[2];
const mode = (process.argv[3] ?? 'none') as 'none' | 'lfo';
if (!engineId) {
  console.error('usage: npx tsx tools/lane-bench.ts <engineId> [none|lfo]');
  process.exit(2);
}
if (!(engineId in MOVING)) {
  console.error(`no moving param declared for '${engineId}' — add one to MOVING`);
  process.exit(2);
}
if (mode !== 'none' && mode !== 'lfo') {
  console.error(`unknown mode '${mode}' — expected none or lfo`);
  process.exit(2);
}

// Touch the reference path so the engine (and, for a plugin, its DSP) is loaded
// through exactly the same door the parity test uses.
await referenceFor(engineId);
const params = defaultParams(engineId);

const times: number[] = [];
for (let r = 0; r < RUNS; r++) times.push(once(engineId, params, mode));
console.log(
  `${engineId.padEnd(12)} mods=${mode.padEnd(4)} median ${median(times).toFixed(1)} ms   ` +
  `(${times.map((t) => t.toFixed(0)).join(', ')})   ` +
  `${SECONDS}s x ${VOICES} voices @ ${SR}`,
);
