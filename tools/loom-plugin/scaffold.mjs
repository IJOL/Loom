// Templates for `loom-plugin new`: a minimal engine that actually SOUNDS — a
// sine with an envelope — so a new author hears something on the first build
// instead of debugging silence.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const manifest = (id) => JSON.stringify({
  id, name: id, version: '0.1.0', loomApi: 1,
  main: 'main.js', dsp: 'dsp.js',
  engines: [{
    id, name: id, polyphony: 'poly', clipEditor: 'piano-roll',
    outputTrim: 0.5, shortLabel: id,
    params: [
      { id: 'amp.level', label: 'Level', kind: 'continuous', min: 0, max: 1, default: 0.8 },
      { id: 'amp.release', label: 'Release', kind: 'continuous', min: 0.02, max: 4, default: 0.4, unit: 's' },
    ],
  }],
}, null, 2);

const MAIN = () => `// Main-thread half: hand the host this engine's metadata.
import manifest from './plugin.json';

Loom.registerEngine(manifest.engines[0]);
`;

const DSP_JS = (id) => `// Per-sample DSP half. Runs inside the AudioWorklet, and on the main thread
// for offline render. It may import @loom/plugin-sdk and its own files — nothing else.
import { param, midiToFreq, velGain01 } from '@loom/plugin-sdk';

class Voice {
  constructor(note, p, sampleRate) {
    this.sr = sampleRate;
    this.begin = note.beginSec;
    this.holdEnd = note.beginSec + note.durationSec;
    this.freq = midiToFreq(note.midi);
    this.vel = velGain01(note.velocity, note.accent);
    this.release = param(p, 'amp.release', 0.4);
    this.levelBase = param(p, 'amp.level', 0.8);
    this.live = null;
    this.phase = 0;
    this.done = false;
  }
  noteOff(t) { if (t < this.holdEnd) this.holdEnd = t; }
  setLiveParams(live) { this.live = live; }
  renderSample(t) {
    if (t < this.begin) return 0;
    const level = this.live ? param(this.live, 'amp.level', this.levelBase) : this.levelBase;
    let env = 1;
    if (t > this.holdEnd) {
      env = Math.exp(-(t - this.holdEnd) / this.release);
      if (env < 0.001) { this.done = true; return 0; }
    }
    this.phase += (2 * Math.PI * this.freq) / this.sr;
    return Math.sin(this.phase) * env * level * this.vel;
  }
}

Loom.registerRenderer('${id}', (note, p, sr) => new Voice(note, p, sr));
`;

export function scaffoldPlugin({ dir, id, lang }) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'plugin.json'), manifest(id));
  writeFileSync(join(dir, lang === 'js' ? 'main.js' : 'main.ts'), MAIN(id));
  writeFileSync(join(dir, lang === 'js' ? 'dsp.js' : 'dsp.ts'), DSP_JS(id));
}
