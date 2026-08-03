// tools/diagnose-transcription-clicks.ts
// Repro + FORENSIC event log for the "glitches agudos / chasquidos" reported on
// the Transcription scene of tb303-bs.json (subtractive lane). Renders the
// clip's notes through the REAL subtractive renderer with an instrumented voice
// host that mirrors VoiceManager.spawn's policies, logging every discontinuity
// SOURCE instead of statistically hunting steps:
//   - policy 'splice'  : same-midi steal = noteOff + immediate removal (CURRENT
//                        VoiceManager behaviour — the release never renders)
//   - policy 'release' : same-midi steal = noteOff only; the voice stays in the
//                        render loop until done (candidate fix)
// Every splice logs the amplitude it just discarded — that amplitude IS the step.
//
// Run: npx vite-node tools/diagnose-transcription-clicks.ts [path-to-save.json]
// Writes test/output/diag-transcription-{splice,release}.wav for listening.
import { readFileSync, mkdirSync } from 'node:fs';
import { ModulationRuntime } from '../src/audio-dsp/modulation-runtime';
import { VoiceManager } from '../src/audio-dsp/voice-manager';
import { createRenderer } from '../src/audio-dsp/renderer-registry';
import type { NoteSpec, ParamBag, VoiceRenderer, VoiceModOffsets } from '../src/audio-dsp/types';
import type { ModLite } from '../src/audio-dsp/modulation-runtime';
import { toModLite } from '../src/engines/worklet-lane-engine';
import type { EngineParamSpec } from '../src/engines/engine-params';
import subtractiveManifest from '../plugins/subtractive/plugin.json';
import { TICKS_PER_QUARTER } from '../src/core/notes';
import { writeWav } from '../test/wav';
import '../test/plugin-dsp';
import '../plugins/subtractive/dsp';

// Subtractive ships as a plugin, so its declared params ARE its manifest.
const SUB_PARAM_SPECS = subtractiveManifest.components[0].params as unknown as EngineParamSpec[];

const SR = 48000;
const savePath = process.argv[2] ?? 'C:/Users/nacho/Downloads/tb303-bs.json';
const save = JSON.parse(readFileSync(savePath, 'utf8'));
const lane = save.sessionState.lanes.find((l: { engineId: string }) => l.engineId === 'subtractive');
const clip = lane.clips.find(Boolean);
const bpm: number = save.bpm;
const secPerTick = 60 / bpm / TICKS_PER_QUARTER;

interface SavedNote { start: number; duration: number; midi: number; velocity: number; }
const notes: SavedNote[] = [...clip.notes].sort((a, b) => a.start - b.start);

const bag: ParamBag = {};
for (const p of SUB_PARAM_SPECS) if (p.kind === 'continuous' || p.kind === 'discrete') bag[p.id] = p.default;
Object.assign(bag, lane.engineState.params ?? {});

interface Slot { midi: number; v: VoiceRenderer; lastOut: number; bornT: number; }
interface Ev { t: number; kind: string; midi: number; amp: number; }

/** Minimal mirror of VoiceManager's render loop with switchable steal policy and
 *  full event logging. Uses the same createRenderer + per-voice ADSR handoff. */
function renderClip(policy: 'splice' | 'release'): { buf: Float32Array; events: Ev[] } {
  const runtime = new ModulationRuntime(SR);
  runtime.setMods(toModLite(lane.engineState.modulators ?? [], bpm));
  const adsrMods: ModLite[] = runtime.getAdsrMods();

  const specs: NoteSpec[] = notes.map((n) => ({
    midi: n.midi, beginSec: n.start * secPerTick, durationSec: n.duration * secPerTick,
    velocity: (n.velocity ?? 100) / 127, accent: false, slide: false,
  }));
  const slots: Slot[] = [];
  const events: Ev[] = [];
  const totalSec = Math.max(...specs.map((s) => s.beginSec + s.durationSec)) + 1.0;
  const buf = new Float32Array(Math.floor(totalSec * SR));
  let next = 0;
  for (let i = 0; i < buf.length; i++) {
    const t = i / SR;
    while (next < specs.length && specs[next].beginSec <= t) {
      const spec = specs[next++];
      for (let k = slots.length - 1; k >= 0; k--) {
        if (slots[k].midi !== spec.midi) continue;
        slots[k].v.noteOff(t);
        if (policy === 'splice') {
          events.push({ t, kind: 'STEAL-SPLICE (amp discarded)', midi: spec.midi, amp: slots[k].lastOut });
          slots.splice(k, 1);
        } else {
          events.push({ t, kind: 'steal-release', midi: spec.midi, amp: slots[k].lastOut });
        }
      }
      const v = createRenderer('subtractive', spec, bag, SR);
      if (adsrMods.length) (v as { setModEnvelopes?(m: ModLite[]): void }).setModEnvelopes?.(adsrMods);
      slots.push({ midi: spec.midi, v, lastOut: 0, bornT: t });
    }
    let out = 0;
    for (let k = slots.length - 1; k >= 0; k--) {
      const s = slots[k];
      const y = s.v.renderSample(t, undefined as unknown as VoiceModOffsets);
      s.lastOut = y;
      out += y;
      if (s.v.done) {
        if (Math.abs(s.lastOut) > 0.005) events.push({ t, kind: 'DONE while audible', midi: s.midi, amp: s.lastOut });
        slots.splice(k, 1);
      }
    }
    buf[i] = out;
  }
  return { buf, events };
}

/** Largest |x[n]-x[n-1]| within ±2 ms of t — the actual rendered step there. */
function stepNear(buf: Float32Array, t: number): number {
  const i0 = Math.max(1, Math.floor((t - 0.002) * SR)), i1 = Math.min(buf.length, Math.floor((t + 0.002) * SR));
  let m = 0;
  for (let i = i0; i < i1; i++) m = Math.max(m, Math.abs(buf[i] - buf[i - 1]));
  return m;
}

/** The REAL VoiceManager, whatever policy the current build implements — the
 *  end-to-end validation render. */
function renderViaVoiceManager(): Float32Array {
  const runtime = new ModulationRuntime(SR);
  runtime.setMods(toModLite(lane.engineState.modulators ?? [], bpm));
  const vm = new VoiceManager(SR, 'subtractive', bag);
  vm.setModulation(runtime);
  const specs: NoteSpec[] = notes.map((n) => ({
    midi: n.midi, beginSec: n.start * secPerTick, durationSec: n.duration * secPerTick,
    velocity: (n.velocity ?? 100) / 127, accent: false, slide: false,
  }));
  const totalSec = Math.max(...specs.map((s) => s.beginSec + s.durationSec)) + 1.0;
  const buf = new Float32Array(Math.floor(totalSec * SR));
  let next = 0;
  for (let i = 0; i < buf.length; i++) {
    const t = i / SR;
    while (next < specs.length && specs[next].beginSec <= t) vm.spawn(specs[next++]);
    buf[i] = vm.renderSample(t);
  }
  return buf;
}

mkdirSync('test/output', { recursive: true });
console.log(`clip: ${notes.length} notes, bpm ${bpm.toFixed(2)}, amp.builtinEnv=${bag['amp.builtinEnv']}`);

let retrigTimes: number[] = [];
for (const policy of ['splice', 'release'] as const) {
  const { buf, events } = renderClip(policy);
  writeWav(buf, `test/output/diag-transcription-${policy}.wav`, SR);
  const loud = events.filter((e) => Math.abs(e.amp) > 0.01);
  if (policy === 'splice') retrigTimes = loud.map((e) => e.t);
  console.log(`\n[policy=${policy}] events with audible amplitude (${loud.length} of ${events.length}):`);
  for (const e of loud) {
    console.log(`  t=${e.t.toFixed(4)}s ${e.kind} midi=${e.midi} amp=${e.amp.toFixed(3)} → rendered step ±2ms: ${stepNear(buf, e.t).toFixed(3)}`);
  }
}

// End-to-end: the real VoiceManager as built, measured at the same retrigger
// instants. With the splice bug this matches 'splice'; fixed it matches 'release'.
const vmBuf = renderViaVoiceManager();
writeWav(vmBuf, 'test/output/diag-transcription-voicemanager.wav', SR);
console.log('\n[real VoiceManager] steps at the audible retrigger instants:');
for (const t of retrigTimes) console.log(`  t=${t.toFixed(4)}s → rendered step ±2ms: ${stepNear(vmBuf, t).toFixed(3)}`);
