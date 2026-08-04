// Templates for `loom-plugin new`: a minimal engine that actually SOUNDS — a
// sine with an envelope — so a new author hears something on the first build
// instead of debugging silence.
//
// No main.ts template: the host adopts a component straight from plugin.json
// (the file it just validated), so a scaffolded plugin with no main-thread
// work of its own — this one — ships no main.js at all. dsp.js is the only
// code a plugin like this needs.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const manifest = (id) => JSON.stringify({
  id, name: id, version: '0.1.0', loomApi: 1,
  dsp: 'dsp.js',
  components: [{
    kind: 'engine', id, name: id, polyphony: 'poly',
    params: [
      { id: 'amp.level', label: 'Level', kind: 'continuous', min: 0, max: 1, default: 0.8 },
      { id: 'amp.release', label: 'Release', kind: 'continuous', min: 0.02, max: 4, default: 0.4, unit: 's' },
    ],
    capabilities: { clipContent: 'notes', outputTrim: 0.5, shortLabel: id },
  }],
}, null, 2);

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
  writeFileSync(join(dir, lang === 'js' ? 'dsp.js' : 'dsp.ts'), DSP_JS(id));
}
