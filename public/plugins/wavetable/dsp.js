// packages/loom-plugin-sdk/src/types.ts
var param = (b, id, d) => b[id] ?? d;
var slotOf = (ix, id) => ix.slot[id] ?? -1;

// packages/loom-plugin-sdk/src/dsp/util.ts
var midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
var clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;

// packages/loom-plugin-sdk/src/dsp/velocity.ts
var ACCENT_PUNCH = 1.1;
function velGain01(v01, accent, accentMul = ACCENT_PUNCH) {
  const g = 0.3 + 1.1 * Math.max(0, Math.min(1, v01));
  return accent ? g * accentMul : g;
}

// packages/loom-plugin-sdk/src/dsp/adsr.ts
function lerp(x, y0, y1, exponent = 1) {
  if (x <= 0) return y0;
  if (x >= 1) return y1;
  const cx = exponent === 0 ? x : exponent > 0 ? Math.pow(x, exponent) : 1 - Math.pow(1 - x, -exponent);
  return y0 + (y1 - y0) * cx;
}
var Adsr = class {
  state = "off";
  startTime = 0;
  startVal = 0;
  decayCurve = 2;
  get isOff() {
    return this.state === "off";
  }
  update(t, gate, attack, decay, sustain, release) {
    switch (this.state) {
      case "off":
        if (gate > 0) {
          this.state = "attack";
          this.startTime = t;
          this.startVal = 0;
        }
        return 0;
      case "attack": {
        const dt = t - this.startTime;
        const cur = lerp(dt / attack, this.startVal, 1, 1);
        if (gate <= 0) {
          this.state = "release";
          this.startTime = t;
          this.startVal = cur;
          return cur;
        }
        if (dt > attack) {
          this.state = "decay";
          this.startTime = t;
          return 1;
        }
        return cur;
      }
      case "decay": {
        const dt = t - this.startTime;
        const cur = lerp(dt / decay, 1, sustain, -this.decayCurve);
        if (gate <= 0) {
          this.state = "release";
          this.startTime = t;
          this.startVal = cur;
          return cur;
        }
        if (dt > decay) {
          this.state = "sustain";
          this.startTime = t;
          return sustain;
        }
        return cur;
      }
      case "sustain":
        if (gate <= 0) {
          this.state = "release";
          this.startTime = t;
          this.startVal = sustain;
        }
        return sustain;
      case "release": {
        const dt = t - this.startTime;
        if (dt > release) {
          this.state = "off";
          return 0;
        }
        const cur = lerp(dt / release, this.startVal, 0, -this.decayCurve);
        if (gate > 0) {
          this.state = "attack";
          this.startTime = t;
          this.startVal = cur;
        }
        return cur;
      }
    }
  }
};

// packages/loom-plugin-sdk/src/dsp/mod-env-host.ts
var EMPTY = new Float64Array(0);
var ModEnvHost = class {
  modEnvs = [];
  eff = EMPTY;
  adsrOnly = EMPTY;
  /** Every slot any of this voice's envelopes writes. The combine loop walks
   *  THIS rather than the whole array: an ADSR usually drives one or two params,
   *  and a lane declares dozens. */
  touched = new Int32Array(0);
  /** Hand this voice its per-voice ADSR modulators (one Adsr each), at spawn,
   *  together with the lane's numbering so their targets resolve to slots. */
  setModEnvelopes(mods, index) {
    this.eff = new Float64Array(index.length);
    this.adsrOnly = new Float64Array(index.length);
    const touched = /* @__PURE__ */ new Set();
    this.modEnvs = mods.map((m) => {
      const slots = [];
      const depths = [];
      for (const id in m.depthByParam) {
        const depth = m.depthByParam[id];
        if (!depth) continue;
        const slot = index.slot[id];
        if (slot === void 0) continue;
        slots.push(slot);
        depths.push(depth);
        touched.add(slot);
      }
      return { adsr: new Adsr(), m, slots: Int32Array.from(slots), depths: Float64Array.from(depths) };
    });
    this.touched = Int32Array.from(touched);
  }
  /** True when this voice carries ADSR mods (lets the renderer skip combine()). */
  get active() {
    return this.modEnvs.length > 0;
  }
  /** This voice's ADSR-only offsets by slot (the UI knob-ring source). */
  getAdsrOffsets() {
    return this.adsrOnly;
  }
  /** Fold the gated ADSR envelopes into the shared-LFO offsets (moIn), returning
   *  a pooled array addressed by the same slots. moIn carries the LFO base for
   *  this lane; copying it resets every slot before the ADSR adds on top.
   *  Allocates nothing per sample. */
  combine(t, gate, moIn) {
    const e = this.eff;
    const a = this.adsrOnly;
    for (const s of this.touched) a[s] = 0;
    for (const me of this.modEnvs) {
      const env = me.adsr.update(
        t,
        gate,
        me.m.attackSec ?? 0.01,
        me.m.decaySec ?? 0.3,
        me.m.sustain ?? 0.7,
        me.m.releaseSec ?? 0.3
      );
      const { slots, depths } = me;
      for (let i = 0; i < slots.length; i++) a[slots[i]] += env * depths[i];
    }
    if (moIn) e.set(moIn);
    else e.fill(0);
    for (const s of this.touched) e[s] += a[s];
    return e;
  }
};

// packages/loom-plugin-sdk/src/dsp/ladder.ts
var TWO_PI = Math.PI * 2;

// packages/loom-plugin-sdk/src/dsp/filter.ts
var clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
var Svf = class {
  constructor(sr) {
    this.sr = sr;
  }
  s0 = 0;
  // bandpass state
  s1 = 0;
  // lowpass state
  lp = 0;
  bp = 0;
  hp = 0;
  notch = 0;
  update(input, cutoffHz, resonance) {
    const res = Math.max(resonance, 0);
    const cutoff = Math.min(cutoffHz, this.sr * 0.45);
    let c = 2 * Math.sin(cutoff * Math.PI / this.sr);
    c = clamp(c, 0, 1.14);
    const r = Math.pow(0.5, (res + 0.125) / 0.125);
    const mrc = 1 - r * c;
    this.s0 = mrc * this.s0 - c * this.s1 + c * input;
    this.s1 = mrc * this.s1 + c * this.s0;
    this.bp = this.s0;
    this.lp = this.s1;
    this.hp = input - this.lp - r * this.bp;
    this.notch = input - 2 * r * this.bp;
  }
};

// packages/loom-plugin-sdk/src/dsp/unison.ts
var harmonicSemis = (k) => 12 * Math.log2(k);
var cycle = (semis) => (u) => semis[u % semis.length];
var UNISON_MODES = [
  // The classic supersaw: every copy at the root, only the spread separates
  // them. Mode 0 so an unaware caller gets exactly the pre-mode stack.
  { id: "unison", label: "Unison", semisFor: () => 0 },
  { id: "octave", label: "Octave", semisFor: cycle([0, 12]) },
  // The middle copy drops an octave — a sub under the spread. Needs a stack
  // wide enough to HAVE a middle that is not the root.
  { id: "center-drop", label: "Center Drop", semisFor: (u, n) => n >= 3 && u === n >> 1 ? -12 : 0 },
  { id: "power-chord", label: "Power Chord", semisFor: cycle([0, 7, 12]) },
  { id: "major", label: "Major", semisFor: cycle([0, 4, 7, 12]) },
  { id: "minor", label: "Minor", semisFor: cycle([0, 3, 7, 12]) },
  // The harmonic series itself: copy u sings partial u+1. Not equal-tempered
  // on purpose — 19.02, 27.86… is what makes it sound like an organ drawbar
  // rig instead of a chord.
  { id: "harmonics", label: "Harmonics", semisFor: (u) => harmonicSemis(u + 1) },
  { id: "odd-harmonics", label: "Odd Harmonics", semisFor: (u) => harmonicSemis(2 * u + 1) }
];
var TWO_PI2 = Math.PI * 2;

// packages/loom-plugin-sdk/src/dsp/filter-kinds.ts
var FILTER_MODES = [
  { value: "dig", label: "DIG", taps: ["lp", "hp", "bp", "notch"] },
  { value: "mog", label: "MOG", taps: ["lp", "hp", "bp"] },
  { value: "acid", label: "303", taps: ["lp", "hp", "bp"] },
  { value: "comb", label: "COMB", taps: ["comb+", "comb-", "combff"] }
];
var TAP_LABELS = {
  lp: "LP",
  hp: "HP",
  bp: "BP",
  notch: "NOTCH",
  "comb+": "POS",
  "comb-": "NEG",
  combff: "FF"
};
var clampIdx = (v, n) => Math.max(0, Math.min(n - 1, Math.round(v)));
function typeOptionsFor(model) {
  const m = FILTER_MODES[clampIdx(model, FILTER_MODES.length)];
  return m.taps.map((t) => ({ value: t, label: TAP_LABELS[t] }));
}
var TYPE_OPTIONS_BY_MODE = Object.fromEntries(FILTER_MODES.map((_m, i) => [String(i), typeOptionsFor(i)]));
var FILTER_MODE_OPTIONS = FILTER_MODES.map((m) => ({ value: m.value, label: m.label }));

// packages/loom-plugin-sdk/src/dsp/pattern.ts
var GOLDEN_PATTERN = (Math.sqrt(5) - 1) / 2;

// plugins/wavetable/wavetable-data.ts
var N = 2048;
var HARMONICS = 64;
function makeSine() {
  const real = new Float32Array(HARMONICS);
  const imag = new Float32Array(HARMONICS);
  imag[1] = 1;
  return { name: "Sine", real, imag };
}
function makeTriangle() {
  const real = new Float32Array(HARMONICS);
  const imag = new Float32Array(HARMONICS);
  for (let k = 1; k < HARMONICS; k += 2) {
    imag[k] = 8 / (Math.PI * Math.PI * k * k) * ((k - 1) / 2 % 2 === 0 ? 1 : -1);
  }
  return { name: "Triangle", real, imag };
}
function makeSawtooth() {
  const real = new Float32Array(HARMONICS);
  const imag = new Float32Array(HARMONICS);
  for (let k = 1; k < HARMONICS; k++) {
    imag[k] = 2 / (Math.PI * k) * (k % 2 === 0 ? 1 : -1);
  }
  return { name: "Sawtooth", real, imag };
}
function makeSquare() {
  const real = new Float32Array(HARMONICS);
  const imag = new Float32Array(HARMONICS);
  for (let k = 1; k < HARMONICS; k += 2) {
    imag[k] = 4 / (Math.PI * k);
  }
  return { name: "Square", real, imag };
}
function makePWM(duty) {
  const real = new Float32Array(HARMONICS);
  const imag = new Float32Array(HARMONICS);
  for (let k = 1; k < HARMONICS; k++) {
    imag[k] = 2 / (Math.PI * k) * Math.sin(Math.PI * k * duty);
  }
  return { name: `PWM ${Math.round(duty * 100)}%`, real, imag };
}
function makeOrgan() {
  const real = new Float32Array(HARMONICS);
  const imag = new Float32Array(HARMONICS);
  imag[1] = 1;
  imag[2] = 0.8;
  imag[3] = 0.6;
  imag[4] = 0.4;
  imag[8] = 0.3;
  return { name: "Organ", real, imag };
}
function makeBrass() {
  const real = new Float32Array(HARMONICS);
  const imag = new Float32Array(HARMONICS);
  for (let k = 1; k < Math.min(HARMONICS, 20); k++) {
    imag[k] = 1 / Math.pow(k, 0.7);
  }
  return { name: "Brass", real, imag };
}
function makeVocal() {
  const real = new Float32Array(HARMONICS);
  const imag = new Float32Array(HARMONICS);
  imag[1] = 1;
  imag[2] = 0.7;
  imag[3] = 0.5;
  imag[4] = 0.9;
  imag[5] = 0.6;
  imag[6] = 0.3;
  imag[7] = 0.4;
  imag[10] = 0.25;
  imag[12] = 0.2;
  return { name: "Vocal", real, imag };
}
var WAVETABLES = [
  makeSine(),
  makeTriangle(),
  makeSawtooth(),
  makeSquare(),
  makePWM(0.25),
  makeOrgan(),
  makeBrass(),
  makeVocal()
];
function synth(spec) {
  const out = new Float32Array(N);
  for (let n = 0; n < N; n++) {
    const ph = n / N * 2 * Math.PI;
    let s = 0;
    for (let k = 1; k < spec.imag.length; k++) {
      s += (spec.imag[k] ?? 0) * Math.sin(k * ph);
      if (spec.real[k]) s += spec.real[k] * Math.cos(k * ph);
    }
    out[n] = s;
  }
  let pk = 0;
  for (const v of out) pk = Math.max(pk, Math.abs(v));
  if (pk > 1e-9) for (let n = 0; n < N; n++) out[n] /= pk;
  return out;
}
var cache = null;
function getWaveTables() {
  if (!cache) cache = WAVETABLES.map(synth);
  return cache;
}
var SPECTRAL_MODES = ["Stretch", "Smear", "Low-pass", "Random"];
var SPECTRAL_STEPS = 32;
function hash01(n) {
  let h = (n ^ 2654435769) >>> 0;
  h = Math.imul(h ^ h >>> 16, 73244475) >>> 0;
  h = Math.imul(h ^ h >>> 16, 73244475) >>> 0;
  return ((h ^ h >>> 16) >>> 0) / 4294967295;
}
function warpSpec(src, mode, amt, waveIdx) {
  const real = new Float32Array(HARMONICS);
  const imag = new Float32Array(HARMONICS);
  if (mode === 0) {
    const f = 1 + amt;
    for (let k = 1; k < HARMONICS; k++) {
      const kk = Math.round(k * f);
      if (kk < HARMONICS) {
        real[kk] += src.real[k];
        imag[kk] += src.imag[k];
      }
    }
  } else if (mode === 1) {
    const w = Math.max(1, Math.round(amt * 6));
    for (let k = 1; k < HARMONICS; k++) {
      let r = 0;
      let i2 = 0;
      let cnt = 0;
      for (let j = Math.max(1, k - w); j <= Math.min(HARMONICS - 1, k + w); j++) {
        r += src.real[j];
        i2 += src.imag[j];
        cnt++;
      }
      real[k] = r / cnt;
      imag[k] = i2 / cnt;
    }
  } else if (mode === 2) {
    const kc = 1 + (HARMONICS - 1) * Math.pow(1 - amt, 2);
    for (let k = 1; k < HARMONICS; k++) {
      const g = k <= kc ? 1 : Math.exp(-(k - kc) / 2);
      real[k] = src.real[k] * g;
      imag[k] = src.imag[k] * g;
    }
  } else {
    for (let k = 1; k < HARMONICS; k++) {
      const g = 1 - amt + amt * 1.5 * hash01(k * 31 + waveIdx * 977);
      real[k] = src.real[k] * g;
      imag[k] = src.imag[k] * g;
    }
  }
  return { name: src.name, real, imag };
}
var warped = /* @__PURE__ */ new Map();
function getWarpedTable(waveIdx, mode, step) {
  const tables = getWaveTables();
  const wi = Math.max(0, Math.min(tables.length - 1, Math.round(waveIdx)));
  const s = Math.max(0, Math.min(SPECTRAL_STEPS, Math.round(step)));
  if (s === 0) return tables[wi];
  const m = Math.max(0, Math.min(SPECTRAL_MODES.length - 1, Math.round(mode)));
  const key = wi << 16 | m << 8 | s;
  const hit = warped.get(key);
  if (hit) return hit;
  if (warped.size > 96) warped.clear();
  const t = synth(warpSpec(WAVETABLES[wi], m, s / SPECTRAL_STEPS, wi));
  warped.set(key, t);
  return t;
}

// plugins/wavetable/dsp.ts
var MOD_DETUNE_CENTS = 50;
function sampleTable(tab, phase) {
  const x = phase * tab.length;
  const i = Math.floor(x);
  const f = x - i;
  return tab[i % tab.length] * (1 - f) + tab[(i + 1) % tab.length] * f;
}
var WavetableRenderer = class {
  constructor(note, p, sr) {
    this.sr = sr;
    const tables = getWaveTables();
    const ai = Math.max(0, Math.min(tables.length - 1, Math.round(param(p, "osc.waveA", 2))));
    const bi = Math.max(0, Math.min(tables.length - 1, Math.round(param(p, "osc.waveB", 3))));
    this.waveA = ai;
    this.waveB = bi;
    this.specMode = param(p, "osc.spectral", 0);
    this.spectralBase = clamp01(param(p, "osc.spectralAmt", 0));
    this.specStep = Math.round(this.spectralBase * SPECTRAL_STEPS);
    this.tA = getWarpedTable(ai, this.specMode, this.specStep);
    this.tB = getWarpedTable(bi, this.specMode, this.specStep);
    this.morphBase = param(p, "osc.morph", 0);
    this.detuneBase = param(p, "osc.detune", 0);
    this.f0 = midiToFreq(note.midi);
    this.filter = new Svf(sr);
    this.cutoffBase = param(p, "filter.cutoff", 0.55);
    this.qBase = clamp01(param(p, "filter.resonance", 0.2));
    this.begin = note.beginSec;
    this.holdEnd = note.beginSec + note.durationSec;
    this.aA = Math.max(1e-3, param(p, "amp.attack", 0.01));
    this.aD = Math.max(1e-3, param(p, "amp.decay", 0.3));
    this.aS = param(p, "amp.sustain", 0.7);
    this.aR = Math.max(1e-3, param(p, "amp.release", 0.3));
    this.ampOn = param(p, "amp.builtinEnv", 1) >= 0.5;
    this.vel = velGain01(note.velocity, note.accent);
  }
  tA;
  tB;
  // Spectral warp: the MODE is structural (frozen at trigger); the AMOUNT is
  // live and quantised to SPECTRAL_STEPS, so moving it swaps precomputed
  // tables (cached in wavetable-data) — phase carries across the swap.
  waveA;
  waveB;
  specMode;
  spectralBase;
  sSpectral = -1;
  specStep;
  phA = 0;
  phB = 0;
  f0;
  // base note frequency (Hz), for live detune
  morphBase;
  detuneBase;
  filter;
  cutoffBase;
  // 0..1 knob value (for live cutoff modulation)
  qBase;
  ampEnv = new Adsr();
  begin;
  holdEnd;
  aA;
  aD;
  aS;
  aR;
  ampOn;
  vel;
  // Per-voice ADSR modulators. This used to be a hand-rolled copy of ModEnvHost
  // — the shared host exists precisely so a renderer does not carry its own.
  modEnv = new ModEnvHost();
  /** The lane's live (smoothed) values, or null when this voice runs standalone
   *  (the offline kernel builds renderers directly). Addressed by the slots
   *  below, resolved ONCE in setLiveValues; -1 means the lane does not declare
   *  that id, so the trigger snapshot stands. */
  live = null;
  sMorph = -1;
  sDetune = -1;
  sCutoff = -1;
  sRes = -1;
  /** The synthetic tremolo target. Not a declared param — the index appends it,
   *  which is what those three synthetic slots are for. */
  sAmpGain = -1;
  // Cached expensive conversions, refreshed only when their raw input moves.
  cutRaw = NaN;
  cutHz = 0;
  detRaw = NaN;
  fACache = 0;
  fBCache = 0;
  done = false;
  noteOff(t) {
    if (t < this.holdEnd) this.holdEnd = t;
  }
  /** Receive this voice's per-voice ADSR modulators (one Adsr each), at spawn,
   *  with the lane's numbering so their targets resolve to slots once. */
  setModEnvelopes(mods, index) {
    this.modEnv.setModEnvelopes(mods, index);
  }
  /** This voice's ADSR-only offsets by slot (for the UI knob ring). */
  getAdsrOffsets() {
    return this.modEnv.getAdsrOffsets();
  }
  setLiveValues(values, index) {
    this.live = values;
    this.sMorph = slotOf(index, "osc.morph");
    this.sSpectral = slotOf(index, "osc.spectralAmt");
    this.sDetune = slotOf(index, "osc.detune");
    this.sCutoff = slotOf(index, "filter.cutoff");
    this.sRes = slotOf(index, "filter.resonance");
    this.sAmpGain = slotOf(index, "amp.gain");
  }
  renderSample(t, moIn) {
    if (t < this.begin) return 0;
    const gate = t <= this.holdEnd ? 1 : 0;
    const mo = this.modEnv.active ? this.modEnv.combine(t, gate, moIn) : moIn;
    const L = this.live;
    const morphKnob = L && this.sMorph >= 0 ? L[this.sMorph] : this.morphBase;
    const detuneKnob = L && this.sDetune >= 0 ? L[this.sDetune] : this.detuneBase;
    const cutoffKnob = L && this.sCutoff >= 0 ? L[this.sCutoff] : this.cutoffBase;
    const qKnob = L && this.sRes >= 0 ? clamp01(L[this.sRes]) : this.qBase;
    const spectralKnob = L && this.sSpectral >= 0 ? clamp01(L[this.sSpectral]) : this.spectralBase;
    const spectralEff = mo?.[this.sSpectral] ? clamp01(spectralKnob + mo[this.sSpectral]) : spectralKnob;
    const step = Math.round(spectralEff * SPECTRAL_STEPS);
    if (step !== this.specStep) {
      this.specStep = step;
      this.tA = getWarpedTable(this.waveA, this.specMode, step);
      this.tB = getWarpedTable(this.waveB, this.specMode, step);
    }
    const morph = mo?.[this.sMorph] ? clamp01(morphKnob + mo[this.sMorph]) : morphKnob;
    const gA = Math.cos(morph * Math.PI * 0.5);
    const gB = Math.sin(morph * Math.PI * 0.5);
    const osc = sampleTable(this.tA, this.phA) * gA + sampleTable(this.tB, this.phB) * gB;
    const det = mo?.[this.sDetune] ? detuneKnob + mo[this.sDetune] * MOD_DETUNE_CENTS : detuneKnob;
    if (det !== this.detRaw) {
      this.detRaw = det;
      this.fACache = this.f0 * Math.pow(2, -det / 1200);
      this.fBCache = this.f0 * Math.pow(2, det / 1200);
    }
    this.phA = (this.phA + this.fACache / this.sr) % 1;
    this.phB = (this.phB + this.fBCache / this.sr) % 1;
    const cutoff01 = mo?.[this.sCutoff] ? clamp01(cutoffKnob + mo[this.sCutoff]) : cutoffKnob;
    if (cutoff01 !== this.cutRaw) {
      this.cutRaw = cutoff01;
      this.cutHz = Math.min(18e3, 60 * Math.pow(220, cutoff01));
    }
    const q = mo?.[this.sRes] ? clamp01(qKnob + mo[this.sRes]) : qKnob;
    this.filter.update(osc, this.cutHz, q);
    const env = this.ampOn ? this.ampEnv.update(t, gate, this.aA, this.aD, this.aS, this.aR) : 1;
    if (gate === 0 && this.ampEnv.isOff && t > this.holdEnd) this.done = true;
    let out = this.filter.lp * env * this.vel;
    if (mo?.[this.sAmpGain]) out *= Math.max(0, Math.min(2, 1 + mo[this.sAmpGain]));
    return out;
  }
};
Loom.registerRenderer("wavetable", (n, p, sr) => new WavetableRenderer(n, p, sr));
export {
  WavetableRenderer
};
