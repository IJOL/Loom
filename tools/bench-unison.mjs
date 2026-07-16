// Bench: does a dense chord still render once every note is a 7-voice unison stack?
//
// 16 notes x 7 unison x 2 oscillators = 224 oscillators plus 16 subs, all through
// the REAL VoiceManager + SubtractiveVoiceRenderer path. Reports the render time
// against the audio budget: 1 second of audio must take well under 1 second of
// CPU, or the worklet underruns and you hear it.
//
//   npx tsx tools/bench-unison.mjs
import { VoiceManager } from '../src/audio-dsp/voice-manager.ts';
import '../src/audio-dsp/subtractive-renderer.ts';   // self-registers with the renderer registry

const SR = 48000;
const SECS = 2;
const CHORD = [48, 52, 55, 59, 60, 62, 64, 67, 69, 71, 72, 74, 76, 79, 81, 84];   // 16 notes

const bag = (voices, drift) => ({
  'master.tune': 0, 'master.unison': voices, 'master.detune': 25, 'master.drift': drift,
  'osc1.wave': 0, 'osc1.level': 0.6, 'osc1.detune': 0,
  'osc2.wave': 1, 'osc2.level': 0.4, 'osc2.detune': 7,
  'sub.level': 0.3, 'noise.level': 0, 'noise.color': 0.6,
  'filter.cutoff': 0.55, 'filter.resonance': 0.25, 'filter.envAmount': 0.45,
  'filter.drive': 0, 'filter.keyTrack': 0, 'filter.builtinEnv': 1,
  'filter.attack': 0.01, 'filter.decay': 0.3, 'filter.sustain': 0.4, 'filter.release': 0.35,
  'amp.builtinEnv': 1, 'amp.attack': 0.01, 'amp.decay': 0.2, 'amp.sustain': 0.7, 'amp.release': 0.3,
});

function bench(voices, drift, model = 0, type = 0) {
  const vm = new VoiceManager(SR, 'subtractive', { ...bag(voices, drift), 'filter.model': model, 'filter.type': type });
  for (const midi of CHORD) {
    vm.spawn({ midi, beginSec: 0, durationSec: SECS, velocity: 0.8, accent: false, slide: false });
  }
  const n = SR * SECS;
  const t0 = process.hrtime.bigint();
  let acc = 0;
  for (let i = 0; i < n; i++) acc += vm.renderSample(i / SR);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { ms, realtime: ms / (SECS * 1000), acc };
}

const rows = [
  ['unison 1 (today\'s default)', bench(1, 0)],
  ['unison 7', bench(7, 0)],
  ['unison 7 + drift', bench(7, 1)],
  ['unison 7 + drift + MOG ladder', bench(7, 1, 1)],
  ['unison 7 + drift + MOG ladder HP', bench(7, 1, 1, 1)],
];
console.log(`16-note chord, ${SECS}s of audio @ ${SR} Hz, through the real VoiceManager\n`);
for (const [label, r] of rows) {
  const pct = (r.realtime * 100).toFixed(1);
  console.log(`  ${label.padEnd(34)} ${r.ms.toFixed(0).padStart(6)} ms   ${pct.padStart(5)}% of realtime   ${r.realtime < 1 ? 'OK' : 'UNDERRUN'}`);
}
