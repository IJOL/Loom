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
var unisonGain = (n) => 1 / Math.pow(n, 0.3);

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

// plugins/fm/dsp.ts
var ALGORITHMS = [
  [[1], [2], [3], []],
  // 0: Serial 4→3→2→1  (op0 = carrier)
  [[1, 2, 3], [], [], []],
  // 1: Parallel mods → op0  (op0 = carrier)
  [[1], [], [3], []],
  // 2: Two pairs (op3→op2, op1→op0)  (op0, op2 = carriers)
  [[], [], [], []]
  // 3: Additive — all four are carriers
];
var CARRIERS = [
  [0],
  [0],
  [0, 2],
  [0, 1, 2, 3]
];
var FM_DEPTH = 3;
var FB_DEPTH = 2;
var FM_DRIVE = 1;
var OP_RATIO_IDS = ["op1.ratio", "op2.ratio", "op3.ratio", "op4.ratio"];
var OP_DETUNE_IDS = ["op1.detune", "op2.detune", "op3.detune", "op4.detune"];
var OP_LEVEL_IDS = ["op1.level", "op2.level", "op3.level", "op4.level"];
var FmSine = class {
  constructor(sr) {
    this.sr = sr;
  }
  phase = 0;
  next(freq, fmHz = 0) {
    const v = Math.sin(this.phase * 2 * Math.PI);
    this.phase = (this.phase + (freq + fmHz) / this.sr) % 1;
    return v;
  }
};
var FMRenderer = class {
  constructor(note, p, sr) {
    this.sr = sr;
    this.begin = note.beginSec;
    this.holdEnd = note.beginSec + note.durationSec;
    const f = midiToFreq(note.midi);
    this.f0 = f;
    this.algoIdx = Math.max(0, Math.min(3, Math.round(param(p, "algorithm", 0))));
    this.feedback = param(p, "feedback", 0);
    this.mix = param(p, "amp.mix", 0.7);
    this.outputTrim = param(p, "output.trim", 1);
    this.vel = velGain01(note.velocity, note.accent);
    this.oscs = [];
    this.envs = [];
    this.opA = [];
    this.opD = [];
    this.opS = [];
    this.opR = [];
    this.lvl = [];
    for (let i = 1; i <= 4; i++) {
      this.envs.push(new Adsr());
      this.ratioBase.push(param(p, `op${i}.ratio`, 1));
      this.detuneBase.push(param(p, `op${i}.detune`, 0));
      this.opA.push(Math.max(1e-3, param(p, `op${i}.attack`, 0.01)));
      this.opD.push(Math.max(1e-3, param(p, `op${i}.decay`, 0.3)));
      this.opS.push(param(p, `op${i}.sustain`, 0.7));
      this.opR.push(Math.max(5e-3, param(p, `op${i}.release`, 0.3)));
      this.lvl.push(param(p, `op${i}.level`, 0.6));
    }
    const nCp = Math.max(1, Math.min(5, Math.round(param(p, "unison.count", 1))));
    const uMode = UNISON_MODES[Math.max(0, Math.min(UNISON_MODES.length - 1, Math.round(param(p, "unison.mode", 0))))];
    const spreadC = param(p, "unison.spread", 10);
    this.nCopies = nCp;
    this.copyMul = new Float64Array(nCp);
    for (let u = 0; u < nCp; u++) {
      const pos = nCp === 1 ? 0 : u / (nCp - 1) * 2 - 1;
      this.copyMul[u] = Math.pow(2, (uMode.semisFor(u, nCp) * 100 + pos * spreadC) / 1200);
    }
    this.stackGain = unisonGain(nCp);
    this.fbStates = new Float64Array(nCp);
    for (let u = 0; u < nCp * 4; u++) this.oscs.push(new FmSine(sr));
  }
  begin;
  holdEnd;
  oscs;
  envs;
  ratioBase = [];
  detuneBase = [];
  f0 = 0;
  freqEff = new Float64Array(4);
  // Cache for the per-operator ratio/detune → Hz conversion (a pow call), keyed
  // on the EFFECTIVE (base + mod offset) values that actually feed it — an LFO
  // riding detune must not read a value frozen from the last knob move.
  opRatioRaw = new Float64Array(4).fill(NaN);
  opDetuneRaw = new Float64Array(4).fill(NaN);
  opA;
  opD;
  opS;
  opR;
  lvl;
  algoIdx;
  feedback;
  mix;
  vel;
  outputTrim;
  // Unison: N copies of the whole 4-op chain (one by default). Per-copy state
  // is only what makes a copy a different SOUND — oscillator phases (oscs holds
  // 4·N, copy u at offset 4u) and the op4 feedback sample. The envelopes and
  // levels stay shared: they are the note's, not the chain's.
  nCopies;
  copyMul;
  stackGain;
  fbStates;
  envVal = new Float64Array(4);
  lvlEff = new Float64Array(4);
  modEnv = new ModEnvHost();
  /** The lane's live (smoothed) values, or null when this voice runs standalone
   *  (the offline kernel builds renderers directly). Addressed by the slots
   *  below, resolved ONCE in setLiveValues; -1 means the lane does not declare
   *  that id, so the trigger snapshot stands. The per-op ones matter most here:
   *  three string lookups per operator per sample used to be twelve. */
  live = null;
  sFeedback = -1;
  sMix = -1;
  sTrim = -1;
  sRatio = new Int32Array(4).fill(-1);
  sDetune = new Int32Array(4).fill(-1);
  sLevel = new Int32Array(4).fill(-1);
  /** The synthetic tremolo target. Not a declared param — the index appends it,
   *  which is what those three synthetic slots are for. */
  sAmpGain = -1;
  // Pooled per-sample scratch — allocated once, reused every renderSample call
  // so the audio thread allocates nothing.
  opOut = new Float64Array(4);
  done = false;
  noteOff(t) {
    if (t < this.holdEnd) this.holdEnd = t;
  }
  setModEnvelopes(mods, index) {
    this.modEnv.setModEnvelopes(mods, index);
  }
  getAdsrOffsets() {
    return this.modEnv.getAdsrOffsets();
  }
  setLiveValues(values, index) {
    this.live = values;
    this.sFeedback = slotOf(index, "feedback");
    this.sMix = slotOf(index, "amp.mix");
    this.sTrim = slotOf(index, "output.trim");
    this.sAmpGain = slotOf(index, "amp.gain");
    for (let i = 0; i < 4; i++) {
      this.sRatio[i] = slotOf(index, OP_RATIO_IDS[i]);
      this.sDetune[i] = slotOf(index, OP_DETUNE_IDS[i]);
      this.sLevel[i] = slotOf(index, OP_LEVEL_IDS[i]);
    }
  }
  renderSample(t, moIn) {
    if (t < this.begin) return 0;
    const gate = t <= this.holdEnd ? 1 : 0;
    const mo = this.modEnv.active ? this.modEnv.combine(t, gate, moIn) : moIn;
    const L = this.live;
    const feedbackKnob = L && this.sFeedback >= 0 ? L[this.sFeedback] : this.feedback;
    const mixKnob = L && this.sMix >= 0 ? L[this.sMix] : this.mix;
    const outputTrimKnob = L && this.sTrim >= 0 ? L[this.sTrim] : this.outputTrim;
    const feedback = mo?.[this.sFeedback] ? Math.max(0, feedbackKnob + mo[this.sFeedback]) : feedbackKnob;
    const algo = ALGORITHMS[this.algoIdx];
    const carriers = CARRIERS[this.algoIdx];
    const opOut = this.opOut;
    const fe = this.freqEff;
    for (let i = 0; i < 4; i++) {
      const ratioKnob = L && this.sRatio[i] >= 0 ? L[this.sRatio[i]] : this.ratioBase[i];
      const detuneKnob = L && this.sDetune[i] >= 0 ? L[this.sDetune[i]] : this.detuneBase[i];
      const rMod = mo?.[this.sRatio[i]], dMod = mo?.[this.sDetune[i]];
      const effRatio = Math.max(0.01, ratioKnob + (rMod ?? 0) * 2);
      const effDetune = detuneKnob + (dMod ?? 0) * 50;
      if (effRatio !== this.opRatioRaw[i] || effDetune !== this.opDetuneRaw[i]) {
        this.opRatioRaw[i] = effRatio;
        this.opDetuneRaw[i] = effDetune;
        fe[i] = this.f0 * effRatio * Math.pow(2, effDetune / 1200);
      }
    }
    const ev = this.envVal;
    const le = this.lvlEff;
    for (let i = 0; i < 4; i++) {
      ev[i] = this.envs[i].update(t, gate, this.opA[i], this.opD[i], this.opS[i], this.opR[i]);
      const lvlBase = L && this.sLevel[i] >= 0 ? L[this.sLevel[i]] : this.lvl[i];
      const lo = mo?.[this.sLevel[i]];
      le[i] = lo ? clamp01(lvlBase + lo) : lvlBase;
    }
    let out = 0;
    for (let u = 0; u < this.nCopies; u++) {
      const mul = this.copyMul[u];
      const off = u * 4;
      for (let i = 3; i >= 0; i--) {
        let fmHz = 0;
        for (const mIdx of algo[i]) {
          fmHz += opOut[mIdx] * fe[mIdx] * mul * le[mIdx] * FM_DEPTH;
        }
        if (i === 3 && feedback > 0) {
          fmHz += this.fbStates[u] * fe[3] * mul * feedback * FB_DEPTH;
        }
        opOut[i] = this.oscs[off + i].next(fe[i] * mul, fmHz) * ev[i];
      }
      this.fbStates[u] = opOut[3];
      let copyOut = 0;
      for (const c of carriers) copyOut += opOut[c] * le[c];
      out += Math.tanh(copyOut * FM_DRIVE);
    }
    out *= this.stackGain;
    let allOff = true;
    for (let i = 0; i < 4; i++) {
      if (!this.envs[i].isOff) {
        allOff = false;
        break;
      }
    }
    if (gate === 0 && allOff && t > this.holdEnd) {
      this.done = true;
    }
    const mix = mo?.[this.sMix] ? Math.max(0, mixKnob + mo[this.sMix]) : mixKnob;
    let s = out * outputTrimKnob * mix * this.vel;
    if (mo?.[this.sAmpGain]) s *= Math.max(0, Math.min(2, 1 + mo[this.sAmpGain]));
    return s;
  }
};
Loom.registerRenderer("fm", (n, p, sr) => new FMRenderer(n, p, sr));
export {
  FMRenderer
};
