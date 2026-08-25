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

// packages/loom-plugin-sdk/src/dsp/osc.ts
function polyBlep(t, dt) {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}
var SawOsc = class {
  constructor(sr) {
    this.sr = sr;
  }
  phase = 0;
  update(freq) {
    const dt = freq / this.sr;
    const p = polyBlep(this.phase, dt);
    const s = 2 * this.phase - 1 - p;
    this.phase += dt;
    if (this.phase > 1) this.phase -= 1;
    return s;
  }
};
var TriOsc = class {
  constructor(sr) {
    this.sr = sr;
  }
  phase = 0;
  update(freq) {
    this.phase += freq / this.sr;
    const p = this.phase % 1;
    const v = p < 0.5 ? 2 * p : 1 - 2 * (p - 0.5);
    return v * 2 - 1;
  }
};
var SineOsc = class {
  constructor(sr) {
    this.sr = sr;
  }
  phase = 0;
  update(freq) {
    const v = Math.sin(this.phase * 2 * Math.PI);
    this.phase = (this.phase + freq / this.sr) % 1;
    return v;
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
  update(input, cutoffHz2, resonance) {
    const res = Math.max(resonance, 0);
    const cutoff = Math.min(cutoffHz2, this.sr * 0.45);
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
var TWO_PI2 = Math.PI * 2;

// packages/loom-plugin-sdk/src/dsp/fold.ts
var FOLD_STAGES = 4;
function fold(input, driveGain) {
  const x = Math.max(-1, Math.min(1, input * driveGain));
  return Math.sin(x * FOLD_STAGES * Math.PI);
}

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

// plugins/westcoast/dsp.ts
var MAIN_WAVE_OSC = [
  (sr) => new SineOsc(sr),
  // 0 = sine
  (sr) => new TriOsc(sr),
  // 1 = triangle
  (sr) => new SawOsc(sr)
  // 2 = sawtooth
];
var MOD_WAVE_OSC = [
  (sr) => new SineOsc(sr),
  // 0 = sine
  (sr) => new TriOsc(sr)
  // 1 = triangle
];
var SUBDIV_VALUES = [0, 2, 3, 4];
function cutoffHz(norm) {
  return Math.min(18e3, 60 * Math.pow(220, norm));
}
var CUTOFF_ENV_SCALE = 3;
var AdContour = class {
  constructor(atk, dec, amount, cmode, cycle, holdEnd) {
    this.atk = atk;
    this.dec = dec;
    this.amount = amount;
    this.cmode = cmode;
    this.cycle = cycle;
    this.holdEnd = holdEnd;
    this.peak = amount;
  }
  val = 0;
  phase = "idle";
  phaseStart = 0;
  peak = 0;
  // Set once the note gate ends. A cycling contour keeps re-triggering only while
  // the note is held; after gate-off it finishes its current decay and goes
  // 'done' so the voice is reaped (otherwise a cycling LPG voice is immortal).
  ended = false;
  /** Signal gate-off to the contour. Stops a cycling contour from re-triggering
   *  and releases a sustained one. */
  noteOff(t) {
    this.ended = true;
    if (this.phase === "sustain") {
      this.phase = "release";
      this.phaseStart = t;
    }
  }
  tick(t) {
    switch (this.phase) {
      case "idle": {
        this.phase = "attack";
        this.phaseStart = t;
        return 0;
      }
      case "attack": {
        const dt = t - this.phaseStart;
        if (dt >= this.atk) {
          this.phase = this.cmode === 1 ? "sustain" : "decay";
          this.phaseStart = t;
          this.val = this.peak;
          return this.peak;
        }
        this.val = this.peak * (dt / this.atk);
        return this.val;
      }
      case "decay": {
        const dt = t - this.phaseStart;
        const tau = this.dec / 3;
        this.val = this.peak * Math.exp(-dt / tau);
        if (this.val < 1e-4) {
          if (this.cycle && !this.ended) {
            this.phase = "attack";
            this.phaseStart = t;
            this.val = 0;
          } else {
            this.phase = "done";
            this.val = 0;
          }
        }
        return this.val;
      }
      case "sustain": {
        this.val = this.peak;
        return this.val;
      }
      case "release": {
        const dt = t - this.phaseStart;
        const tau = this.dec / 3;
        this.val = this.peak * Math.exp(-dt / tau);
        if (this.val < 1e-4) {
          this.phase = "done";
          this.val = 0;
        }
        return this.val;
      }
      case "done":
        return 0;
    }
  }
  get isDone() {
    return this.phase === "done";
  }
};
var WestcoastRenderer = class {
  constructor(note, p, sr) {
    this.sr = sr;
    this.begin = note.beginSec;
    this.holdEnd = note.beginSec + note.durationSec;
    this.freq0 = midiToFreq(note.midi);
    this.tuneBase = param(p, "master.tune", 0);
    this.detuneBase = param(p, "osc.detune", 0);
    this.ratioBase = param(p, "osc.ratio", 2);
    this.subDiv = SUBDIV_VALUES[Math.round(param(p, "osc.subDiv", 0))] ?? 0;
    const mainWave = Math.max(0, Math.min(2, Math.round(param(p, "osc.mainWave", 0))));
    const modWave = Math.max(0, Math.min(1, Math.round(param(p, "osc.modWave", 0))));
    this.main = (MAIN_WAVE_OSC[mainWave] ?? MAIN_WAVE_OSC[0])(sr);
    this.mod = (MOD_WAVE_OSC[modWave] ?? MOD_WAVE_OSC[0])(sr);
    this.sub = new SineOsc(sr);
    this.fmIndexBase = param(p, "osc.fmIndex", 0.2);
    this.ringBase = param(p, "osc.ring", 0);
    this.mainGain = 0.7;
    this.subLevelBase = param(p, "osc.subLevel", 0.3);
    this.foldBase = param(p, "timbre.fold", 0.5);
    const accentMul = note.accent ? 1.3 : 1;
    this.symmetryBase = param(p, "timbre.symmetry", 0);
    this.filter = new Svf(sr);
    const mode = Math.round(param(p, "lpg.mode", 2));
    this.filterMode = mode === 0 || mode === 2;
    this.vcaMode = mode === 1 || mode === 2;
    this.cutoffNorm = param(p, "lpg.cutoff", 0.6);
    this.lpgResBase = Math.max(0, Math.min(1, param(p, "lpg.resonance", 0.2)));
    const cmode = Math.round(param(p, "contour.mode", 0));
    const atk = Math.max(1e-3, param(p, "contour.attack", 5e-3));
    const dec = Math.max(5e-3, param(p, "contour.decay", 0.4));
    const amount = param(p, "contour.amount", 0.9);
    const cycle = Math.round(param(p, "contour.cycle", 0)) >= 1;
    this.contour = new AdContour(atk, dec, amount, cmode, cycle, this.holdEnd);
    this.levelBase = param(p, "amp.level", 0.8);
    this.ampTrim = velGain01(note.velocity, note.accent);
    this.accentMul = accentMul;
  }
  main;
  mod;
  sub;
  freq0;
  // structural base frequency (from note.midi)
  subDiv;
  mainGain;
  // LPG
  filter;
  filterMode;
  // drives filter cutoff with contour
  vcaMode;
  // drives VCA with contour; if false, VCA is fixed 1
  // Contour
  contour;
  // Modulation: ModEnvHost (per-voice ADSR) + saved knob bases so generic LFO/ADSR
  // and live knob turns can recompute the timbre params (cutoff, fold, resonance,
  // fmIndex) plus the rest of the LIVE set (ring, subLevel, ratio, detune, tune,
  // symmetry, amp.level) on the note ALREADY sounding.
  modEnv = new ModEnvHost();
  foldBase;
  fmIndexBase;
  cutoffNorm;
  // 0..1 lpg.cutoff knob
  lpgResBase;
  ratioBase;
  detuneBase;
  tuneBase;
  ringBase;
  subLevelBase;
  symmetryBase;
  // raw 0..1 knob (the ×0.5 DC-bias scale is applied at read time)
  levelBase;
  ampTrim;
  // velocity gain — the frozen part of the amp scalar
  accentMul;
  /** The lane's live (smoothed) values, or null when this voice runs standalone
   *  (the offline kernel builds renderers directly). Addressed by the slots
   *  below, resolved ONCE in setLiveValues; -1 means the lane does not declare
   *  that id, so the trigger snapshot stands. */
  live = null;
  sTune = -1;
  sDetune = -1;
  sRatio = -1;
  sFmIndex = -1;
  sRing = -1;
  sSubLevel = -1;
  sSymmetry = -1;
  sFold = -1;
  sCutoff = -1;
  sLpgRes = -1;
  sLevel = -1;
  /** The synthetic tremolo target. Not a declared param — the index appends it,
   *  which is what those three synthetic slots are for. */
  sAmpGain = -1;
  // Cached expensive conversions, refreshed only when their raw input moves.
  pitchRaw = NaN;
  freqEffCache = 0;
  cutRaw = NaN;
  cutHzCached = 0;
  // Timing
  begin;
  holdEnd;
  contourGateTriggered = false;
  done = false;
  noteOff(t) {
    if (!(t >= this.holdEnd)) this.holdEnd = t;
    this.contour.noteOff(t);
  }
  setModEnvelopes(mods, index) {
    this.modEnv.setModEnvelopes(mods, index);
  }
  getAdsrOffsets() {
    return this.modEnv.getAdsrOffsets();
  }
  setLiveValues(values, index) {
    this.live = values;
    this.sTune = slotOf(index, "master.tune");
    this.sDetune = slotOf(index, "osc.detune");
    this.sRatio = slotOf(index, "osc.ratio");
    this.sFmIndex = slotOf(index, "osc.fmIndex");
    this.sRing = slotOf(index, "osc.ring");
    this.sSubLevel = slotOf(index, "osc.subLevel");
    this.sSymmetry = slotOf(index, "timbre.symmetry");
    this.sFold = slotOf(index, "timbre.fold");
    this.sCutoff = slotOf(index, "lpg.cutoff");
    this.sLpgRes = slotOf(index, "lpg.resonance");
    this.sLevel = slotOf(index, "amp.level");
    this.sAmpGain = slotOf(index, "amp.gain");
  }
  renderSample(t, moIn) {
    if (t < this.begin) return 0;
    const gate = t <= this.holdEnd ? 1 : 0;
    const mo = this.modEnv.active ? this.modEnv.combine(t, gate, moIn) : moIn;
    const L = this.live;
    const tuneKnob = L && this.sTune >= 0 ? L[this.sTune] : this.tuneBase;
    const detuneKnob = L && this.sDetune >= 0 ? L[this.sDetune] : this.detuneBase;
    const ratioKnob = L && this.sRatio >= 0 ? L[this.sRatio] : this.ratioBase;
    const pitchCents = tuneKnob * 100 + detuneKnob;
    if (pitchCents !== this.pitchRaw) {
      this.pitchRaw = pitchCents;
      this.freqEffCache = this.freq0 * Math.pow(2, pitchCents / 1200);
    }
    const freq = this.freqEffCache;
    const modFreq = freq * ratioKnob;
    const subFreq = this.subDiv > 0 ? freq / this.subDiv : freq;
    const fmIndexKnob = L && this.sFmIndex >= 0 ? L[this.sFmIndex] : this.fmIndexBase;
    const fmFactor = freq * ratioKnob * 2;
    const fmIndexEff = mo?.[this.sFmIndex] ? Math.max(0, fmIndexKnob + mo[this.sFmIndex]) : fmIndexKnob;
    const fmDepthHz = fmIndexEff * fmFactor;
    const modSample = this.mod.update(modFreq);
    const mainFreq = freq + modSample * fmDepthHz;
    const mainSample = this.main.update(mainFreq);
    const ringKnob = L && this.sRing >= 0 ? L[this.sRing] : this.ringBase;
    const ringSample = mainSample * modSample * ringKnob;
    const subLevelKnob = L && this.sSubLevel >= 0 ? L[this.sSubLevel] : this.subLevelBase;
    const subSample = this.subDiv > 0 ? this.sub.update(subFreq) * subLevelKnob : 0;
    const symmetryKnob = L && this.sSymmetry >= 0 ? L[this.sSymmetry] : this.symmetryBase;
    const mixRaw = mainSample * this.mainGain + ringSample + subSample + symmetryKnob * 0.5;
    const foldKnob = L && this.sFold >= 0 ? L[this.sFold] : this.foldBase;
    const foldEff = mo?.[this.sFold] ? clamp01(foldKnob + mo[this.sFold]) : foldKnob;
    const driveGain = (0.1 + foldEff * 0.9) * this.accentMul;
    const folded = fold(mixRaw, driveGain);
    if (!this.contourGateTriggered && t >= this.holdEnd) {
      this.contourGateTriggered = true;
      this.contour.noteOff(t);
    }
    const contourVal = this.contour.tick(t);
    const cutoffKnob = L && this.sCutoff >= 0 ? L[this.sCutoff] : this.cutoffNorm;
    const cutoffEff = mo?.[this.sCutoff] ? clamp01(cutoffKnob + mo[this.sCutoff]) : cutoffKnob;
    if (cutoffEff !== this.cutRaw) {
      this.cutRaw = cutoffEff;
      this.cutHzCached = cutoffHz(cutoffEff);
    }
    const cutoffBaseHz = this.cutHzCached;
    const cutoffEnvScale = this.filterMode ? cutoffBaseHz * CUTOFF_ENV_SCALE * this.accentMul : 0;
    const resKnob = L && this.sLpgRes >= 0 ? clamp01(L[this.sLpgRes]) : this.lpgResBase;
    const lpgRes = mo?.[this.sLpgRes] ? clamp01(resKnob + mo[this.sLpgRes]) : resKnob;
    const dynamicCutoff = cutoffBaseHz + contourVal * cutoffEnvScale;
    this.filter.update(folded, dynamicCutoff, lpgRes);
    const vca = this.vcaMode ? contourVal : 1;
    const levelKnob = L && this.sLevel >= 0 ? L[this.sLevel] : this.levelBase;
    let out = this.filter.lp * vca * levelKnob * this.ampTrim;
    if (mo?.[this.sAmpGain]) out *= Math.max(0, Math.min(2, 1 + mo[this.sAmpGain]));
    if (this.contour.isDone) {
      this.done = true;
    }
    return out;
  }
};
Loom.registerRenderer("westcoast", (n, p, sr) => new WestcoastRenderer(n, p, sr));
export {
  WestcoastRenderer
};
