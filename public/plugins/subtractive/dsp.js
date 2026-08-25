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
var SquareOsc = class {
  constructor(sr) {
    this.sr = sr;
  }
  phase = 0;
  saw(offset, dt) {
    const phase = (this.phase + offset) % 1;
    return 2 * phase - 1 - polyBlep(phase, dt);
  }
  update(freq, pw = 0.5) {
    const dt = freq / this.sr;
    const pulse = this.saw(0, dt) - this.saw(pw, dt);
    this.phase = (this.phase + dt) % 1;
    return pulse + pw * 2 - 1;
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
var WhiteNoise = class {
  update() {
    return Math.random() * 2 - 1;
  }
};

// packages/loom-plugin-sdk/src/dsp/sync-osc.ts
function polyBlep2(t, dt) {
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
var SyncOsc = class {
  // advances at freq * ratio, reset when master wraps
  constructor(sr) {
    this.sr = sr;
  }
  master = 0;
  // 0..1, advances at the note frequency
  slave = 0;
  /** One sample. `freq` is the master (the pitch); the second argument is the
   *  sync ratio (the timbre) — named to satisfy the shared Osc interface, whose
   *  other members read it as pulse width. Ratios below 1 are clamped up. */
  update(freq, ratio = 2) {
    const dt = freq / this.sr;
    const r = Math.max(1, ratio);
    const slaveDt = dt * r;
    this.master += dt;
    this.slave += slaveDt;
    if (this.master >= 1) {
      this.master -= 1;
      this.slave = this.master * r;
    }
    const p = this.slave % 1;
    let s = 2 * p - 1;
    s -= polyBlep2(this.master, dt);
    return Math.max(-1, Math.min(1, s));
  }
};

// packages/loom-plugin-sdk/src/dsp/ladder.ts
function diodeClip(v) {
  return v > 0 ? Math.tanh(v * 1.2) : Math.tanh(v * 0.8);
}
var TWO_PI = Math.PI * 2;
var SELF_OSC_FEEDBACK = 4;
var RES_MAKEUP = 0.12;
var HP_MAKEUP = 2.2;
var BP_MAKEUP = 3;
function softTap(x) {
  const KNEE = 2.5;
  const a = Math.abs(x);
  if (a <= KNEE) return x;
  const over = a - KNEE;
  const shaped = KNEE + Math.tanh(over / KNEE) * KNEE * 0.8;
  return x < 0 ? -shaped : shaped;
}
var LadderFilter = class {
  constructor(model, sr, tap = "lp") {
    this.model = model;
    this.sr = sr;
    this.tap = tap;
  }
  // The four stage outputs. Plain fields, not an array: this runs per sample.
  y0 = 0;
  y1 = 0;
  y2 = 0;
  y3 = 0;
  /** Clear the stages. A pooled voice must not inherit the last note's tail. */
  reset() {
    this.y0 = 0;
    this.y1 = 0;
    this.y2 = 0;
    this.y3 = 0;
  }
  /**
   * One sample through the ladder.
   * @param x         input sample
   * @param cutoffHz  cutoff in Hz (clamped below Nyquist)
   * @param res       resonance 0..1 — past ~0.9 it approaches self-oscillation
   */
  update(x, cutoffHz, res) {
    const wc = TWO_PI * Math.min(cutoffHz, this.sr * 0.45) / this.sr;
    const g = Math.min(
      1,
      0.9892 * wc - 0.4342 * wc * wc + 0.1381 * wc * wc * wc - 0.0202 * wc * wc * wc * wc
    );
    const diode = this.model === "diode";
    const k = Math.max(0, res) * SELF_OSC_FEEDBACK * (diode ? 1.1 : 1);
    const fb = k * (this.y3 - x * 5e-4);
    const input = diode ? x - fb : x - Math.tanh(fb);
    const shape = diode ? diodeClip : Math.tanh;
    const s0 = this.y0 + g * (shape(input) - shape(this.y0));
    const s1 = this.y1 + g * (shape(s0) - shape(this.y1));
    const s2 = this.y2 + g * (shape(s1) - shape(this.y2));
    const s3 = this.y3 + g * (shape(s2) - shape(this.y3));
    this.y0 = Math.abs(s0) < 1e-15 ? 0 : s0;
    this.y1 = Math.abs(s1) < 1e-15 ? 0 : s1;
    this.y2 = Math.abs(s2) < 1e-15 ? 0 : s2;
    this.y3 = Math.abs(s3) < 1e-15 ? 0 : s3;
    if (this.tap === "hp") return softTap((input - 4 * s0 + 6 * s1 - 4 * s2 + s3) * HP_MAKEUP);
    if (this.tap === "bp") return softTap((s1 - 2 * s2 + s3) * BP_MAKEUP);
    return s3 * 3 * (1 + k * RES_MAKEUP);
  }
};

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
function makeOsc(wave, sr) {
  switch (wave) {
    case 1:
      return new SquareOsc(sr);
    case 2:
      return new TriOsc(sr);
    case 3:
      return new SineOsc(sr);
    case 4:
      return new SyncOsc(sr);
    default:
      return new SawOsc(sr);
  }
}
var MAX_UNISON = 7;
var TWO_PI2 = Math.PI * 2;
var driftDepthFor = (freq) => freq < 200 ? 2e-3 : 5e-3;
var UnisonStack = class {
  oscs = [];
  /** Where each copy sits across the spread, -1..+1. */
  pos;
  /** Frequency ratio per copy, cached against the inputs that produced it. */
  ratio;
  cachedBase = NaN;
  cachedSpread = NaN;
  driftPhase;
  driftRate;
  n;
  invSr;
  /** N copies must not be N times louder. */
  gain;
  constructor(wave, count, sr) {
    const n = Math.max(1, Math.min(MAX_UNISON, Math.round(count)));
    this.n = n;
    this.invSr = 1 / sr;
    this.gain = 1 / Math.pow(n, 0.3);
    this.pos = new Float64Array(n);
    this.ratio = new Float64Array(n);
    this.driftPhase = new Float64Array(n);
    this.driftRate = new Float64Array(n);
    for (let u = 0; u < n; u++) {
      this.oscs.push(makeOsc(wave, sr));
      this.pos[u] = n === 1 ? 0 : u / (n - 1) * 2 - 1;
      this.driftRate[u] = 0.15 + Math.random() * 0.2;
      this.driftPhase[u] = Math.random();
    }
  }
  /**
   * One sample of the whole stack, gain-compensated.
   * @param freq        note frequency (Hz)
   * @param pw          pulse width (bites on squares only)
   * @param baseCents   this oscillator's own detune
   * @param spreadCents half-width of the unison spread
   * @param driftAmt    drift depth as a fraction of freq; 0 skips it entirely
   */
  update(freq, pw, baseCents, spreadCents, driftAmt) {
    if (baseCents !== this.cachedBase || spreadCents !== this.cachedSpread) {
      for (let u = 0; u < this.n; u++) {
        this.ratio[u] = Math.pow(2, (baseCents + this.pos[u] * spreadCents) / 1200);
      }
      this.cachedBase = baseCents;
      this.cachedSpread = spreadCents;
    }
    let sum = 0;
    if (driftAmt > 0) {
      for (let u = 0; u < this.n; u++) {
        const d = 1 + Math.sin(TWO_PI2 * this.driftPhase[u]) * driftAmt;
        sum += this.oscs[u].update(freq * d * this.ratio[u], pw);
        this.driftPhase[u] = (this.driftPhase[u] + this.driftRate[u] * this.invSr) % 1;
      }
    } else {
      for (let u = 0; u < this.n; u++) sum += this.oscs[u].update(freq * this.ratio[u], pw);
    }
    return sum * this.gain;
  }
};

// packages/loom-plugin-sdk/src/dsp/comb.ts
var MIN_TUNE_HZ = 30;
var CombFilter = class {
  constructor(sr) {
    this.sr = sr;
    this.size = Math.ceil(sr / MIN_TUNE_HZ) + 2;
    this.buf = new Float32Array(this.size);
  }
  buf;
  size;
  w = 0;
  /**
   * One sample.
   * @param tuneHz    the frequency the peaks are spaced by (the Cutoff knob)
   * @param feedback  0..1 how much comes back (the Resonance knob)
   */
  update(x, tuneHz, feedback, tap) {
    const hz = tuneHz < MIN_TUNE_HZ ? MIN_TUNE_HZ : tuneHz > this.sr * 0.45 ? this.sr * 0.45 : tuneHz;
    const delay = Math.min(this.size - 1, Math.max(1, Math.round(this.sr / hz)));
    let r = this.w - delay;
    if (r < 0) r += this.size;
    const delayed = this.buf[r];
    const g = feedback < 0 ? 0 : feedback > 0.97 ? 0.97 : feedback;
    let out;
    if (tap === "combff") {
      out = x + g * delayed;
      this.buf[this.w] = x;
    } else {
      const s = tap === "comb-" ? -1 : 1;
      out = x + s * g * delayed;
      this.buf[this.w] = out;
    }
    this.w = this.w + 1 >= this.size ? 0 : this.w + 1;
    return out * 0.5;
  }
};

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
function tapFor(model, type) {
  const m = FILTER_MODES[clampIdx(model, FILTER_MODES.length)];
  return m.taps[clampIdx(type, m.taps.length)];
}
function typeOptionsFor(model) {
  const m = FILTER_MODES[clampIdx(model, FILTER_MODES.length)];
  return m.taps.map((t) => ({ value: t, label: TAP_LABELS[t] }));
}
var TYPE_OPTIONS_BY_MODE = Object.fromEntries(FILTER_MODES.map((_m, i) => [String(i), typeOptionsFor(i)]));
var FILTER_MODE_OPTIONS = FILTER_MODES.map((m) => ({ value: m.value, label: m.label }));
var ROUTING_OFF = 0;
var ROUTING_SER = 1;
var ROUTING_PAR = 2;
var ROUTING_DIFF = 3;

// packages/loom-plugin-sdk/src/dsp/filter-stack.ts
var CUTOFF_MIN_HZ = 20;
var CUTOFF_MAX_HZ = 18e3;
function trackedCutoff(baseBHz, aRatio, track) {
  const hz = baseBHz * (1 + track * (aRatio - 1));
  return hz < CUTOFF_MIN_HZ ? CUTOFF_MIN_HZ : hz > CUTOFF_MAX_HZ ? CUTOFF_MAX_HZ : hz;
}
var FilterBlock = class {
  svf = null;
  ladder = null;
  comb = null;
  tap;
  constructor(model, type, sr) {
    const mode = FILTER_MODES[Math.max(0, Math.min(FILTER_MODES.length - 1, Math.round(model)))];
    this.tap = tapFor(model, type);
    if (mode.value === "comb") this.comb = new CombFilter(sr);
    else if (mode.value === "mog" || mode.value === "acid") {
      this.ladder = new LadderFilter(mode.value === "mog" ? "moog" : "diode", sr, this.tap);
    } else this.svf = new Svf(sr);
  }
  update(x, cutoffHz, res) {
    if (this.comb) return this.comb.update(x, cutoffHz, res, this.tap);
    if (this.ladder) return this.ladder.update(x, cutoffHz, res);
    const f = this.svf;
    f.update(x, cutoffHz, res);
    switch (this.tap) {
      case "hp":
        return f.hp;
      case "bp":
        return f.bp;
      case "notch":
        return f.notch;
      default:
        return f.lp;
    }
  }
};
var FilterStack = class {
  a;
  /** Built only when the routing asks for it: OFF costs exactly what one filter
   *  cost before this module existed. */
  b;
  routing;
  constructor(modelA, typeA, modelB, typeB, routing, sr) {
    this.routing = Math.round(routing);
    this.a = new FilterBlock(modelA, typeA, sr);
    this.b = this.routing === ROUTING_OFF ? null : new FilterBlock(modelB, typeB, sr);
  }
  /**
   * One sample through both blocks.
   * @param blend how much of B is in the result, in EVERY mode: 0 is filter A
   *              alone whatever the routing says, 1 is the mode at full.
   */
  update(x, cutA, resA, cutB, resB, blend) {
    const a = this.a.update(x, cutA, resA);
    const b = this.b;
    if (!b) return a;
    return this.combine(a, x, b, cutB, resB, blend);
  }
  /** The three real routing modes, plus OFF's fallthrough (unreachable: `update`
   *  never calls this without a B block, but `default` keeps it total). */
  combine(a, x, b, cutB, resB, blend) {
    switch (this.routing) {
      case ROUTING_SER: {
        const chained = b.update(a, cutB, resB);
        return a + blend * (chained - a);
      }
      case ROUTING_PAR:
        return a + blend * b.update(x, cutB, resB);
      case ROUTING_DIFF:
        return a - blend * b.update(x, cutB, resB);
      default:
        return a;
    }
  }
};

// packages/loom-plugin-sdk/src/dsp/pattern.ts
var GOLDEN_PATTERN = (Math.sqrt(5) - 1) / 2;

// plugins/subtractive/dsp.ts
var NO_SLOTS = new Float64Array(0);
function subParamsInto(b, out) {
  out.masterTune = param(b, "master.tune", 0);
  out.unisonVoices = param(b, "master.unison", 1);
  out.unisonDetune = param(b, "master.detune", 25);
  out.unisonDrift = param(b, "master.drift", 0);
  out.osc1Wave = param(b, "osc1.wave", 0);
  out.osc1Level = param(b, "osc1.level", 0.6);
  out.osc1Detune = param(b, "osc1.detune", 0);
  out.osc1Pw = param(b, "osc1.pw", 0.5);
  out.osc2Pw = param(b, "osc2.pw", 0.5);
  out.osc1Sync = param(b, "osc1.sync", 2);
  out.osc2Sync = param(b, "osc2.sync", 2);
  out.osc2Wave = param(b, "osc2.wave", 1);
  out.osc2Level = param(b, "osc2.level", 0.4);
  out.osc2Detune = param(b, "osc2.detune", 7);
  out.ringLevel = param(b, "ring.level", 0);
  out.subLevel = param(b, "sub.level", 0.3);
  out.noiseLevel = param(b, "noise.level", 0);
  out.noiseColor = param(b, "noise.color", 0.6);
  out.filterCutoff = param(b, "filter.cutoff", 0.55);
  out.filterResonance = param(b, "filter.resonance", 0.25);
  out.filterEnvAmount = param(b, "filter.envAmount", 0.45);
  out.filterModel = param(b, "filter.model", 0);
  out.filterType = param(b, "filter.type", 0);
  out.filterRouting = param(b, "filter.routing", 0);
  out.filterBlend = param(b, "filter.blend", 1);
  out.filter2Model = param(b, "filter2.model", 0);
  out.filter2Type = param(b, "filter2.type", 1);
  out.filter2Cutoff = param(b, "filter2.cutoff", 0.25);
  out.filter2Resonance = param(b, "filter2.resonance", 0.2);
  out.filter2Track = param(b, "filter2.track", 0);
  out.filterDrive = param(b, "filter.drive", 0);
  out.filterKeyTrack = param(b, "filter.keyTrack", 0);
  out.filterBuiltinEnv = param(b, "filter.builtinEnv", 1);
  out.filterAttack = param(b, "filter.attack", 0.01);
  out.filterDecay = param(b, "filter.decay", 0.3);
  out.filterSustain = param(b, "filter.sustain", 0.4);
  out.filterRelease = param(b, "filter.release", 0.35);
  out.ampBuiltinEnv = param(b, "amp.builtinEnv", 1);
  out.ampAttack = param(b, "amp.attack", 0.01);
  out.ampDecay = param(b, "amp.decay", 0.2);
  out.ampSustain = param(b, "amp.sustain", 0.7);
  out.ampRelease = param(b, "amp.release", 0.3);
  return out;
}
function subParamsFromBag(b) {
  return subParamsInto(b, {});
}
var clampPw = (v) => Math.min(0.95, Math.max(0.05, v));
var clampSpread = (v) => Math.min(50, Math.max(0, v));
var MOD_UNISON_CENTS = 50;
var MOD_PW_RANGE = 0.45;
var WAVE_SYNC = 4;
var clampSync = (v) => Math.min(8, Math.max(1, v));
var MOD_SYNC_RANGE = 3.5;
var MOD_TUNE_SEMIS = 12;
var MOD_DETUNE_CENTS = 50;
function driveShape(x, amount) {
  const k = 1 + amount * amount * 25;
  return Math.tanh(x * k) / Math.tanh(k);
}
var SubtractiveVoiceRenderer = class {
  sr;
  // osc1/osc2 are UNISON STACKS: N detuned copies each (N=1 by default, which is
  // one oscillator at unity gain — exactly what they were before).
  osc1;
  osc2;
  /** How far this note's drift can pull the pitch — a fraction of its frequency,
   *  fixed at trigger because it depends only on the note. */
  driftDepth;
  sub;
  noise = new WhiteNoise();
  noiseLp;
  /** Both filter blocks and the routing between them. Built once, at trigger:
   *  a topology is not something you sweep mid-note. */
  stack;
  ampEnv = new Adsr();
  filtEnv = new Adsr();
  begin;
  holdEnd;
  /** The trigger-time snapshot. It is the FROZEN structural source (waveform,
   *  filter kind, envelope times) AND the fallback for a live param whose slot
   *  the lane does not declare — the same role `xBase` plays in the other
   *  renderers, which is all this struct is now. */
  p;
  /** The lane's live (smoothed) values, or null when this voice runs standalone
   *  (the offline kernel builds renderers directly). */
  live = null;
  sMasterTune = -1;
  sUnisonDetune = -1;
  sUnisonDrift = -1;
  sOsc1Level = -1;
  sOsc1Detune = -1;
  sOsc1Pw = -1;
  sOsc1Sync = -1;
  sOsc2Level = -1;
  sOsc2Detune = -1;
  sOsc2Pw = -1;
  sOsc2Sync = -1;
  sRingLevel = -1;
  sSubLevel = -1;
  sNoiseLevel = -1;
  sNoiseColor = -1;
  sFilterCutoff = -1;
  sFilterResonance = -1;
  sFilterEnvAmount = -1;
  sFilterDrive = -1;
  sFilterKeyTrack = -1;
  sFilter2Cutoff = -1;
  sFilter2Resonance = -1;
  sFilter2Track = -1;
  sFilterBlend = -1;
  /** The synthetic tremolo target. */
  sAmpGain = -1;
  velPeak;
  // Kept for live recompute of keytrack/env ranges when cutoff/keyTrack/envAmount
  // are modulated (those ranges scale with the live base cutoff).
  keySemiDelta;
  accentMul;
  // Trigger-time frozen structure. `this.p` becomes the LANE's live snapshot once
  // setLiveValues runs, so anything that must NOT change mid-note is copied
  // here at spawn: the two oscillator waves (a Sync wave reinterprets its second
  // argument), the two envelope switches and all eight envelope TIMES.
  osc1WaveFrozen;
  osc2WaveFrozen;
  ampBuiltinFrozen;
  filterBuiltinFrozen;
  ampA;
  ampD;
  ampS;
  ampR;
  filtA;
  filtD;
  filtS;
  filtR;
  /** Cached cutoff conversion: 60·220^x is not a per-sample cost while nothing moves. */
  cutRaw = NaN;
  cutHzCached = 0;
  /** Same cache, for filter B's own cutoff knob (before Track is applied). */
  cut2Raw = NaN;
  cut2HzCached = 0;
  /** Cached master-tune conversion (the note's base frequency). */
  tuneRaw = NaN;
  baseFreqCached = 0;
  noteHz;
  done = false;
  /** Per-voice ADSR modulators, handed in at spawn. Empty ⇒ LFO-only fast path. */
  modEnvs = [];
  /** Pooled effective-offset struct (shared LFO + this voice's ADSR), reused each
   *  sample so the render loop allocates nothing on the audio thread. */
  effMo = NO_SLOTS;
  /** This voice's ADSR-only contribution per slot (NOT including the LFO),
   *  refreshed each sample. The worklet reads the most-recent voice's copy to
   *  drive the knob ring (the LFO part is added from the shared activeOffsets). */
  adsrOnly = NO_SLOTS;
  /** Every ADDITIVE slot this voice's envelopes write — 'amp' and 'filter.env'
   *  excluded, since those become envelopes rather than offsets. */
  touched = new Int32Array(0);
  /** The two envelope targets, resolved once so the per-sample loop compares
   *  numbers instead of strings. */
  sAmpTarget = -1;
  sFilterEnvTarget = -1;
  /** When an ADSR is routed to the 'amp' target it BECOMES this voice's amplitude
   *  envelope (multiplicative 0..1), replacing the built-in amp env. null ⇒ none. */
  ampEnvValue = null;
  /** The Adsr driving 'amp' (for the done test) when an ADSR governs amplitude. */
  ampEnvAdsr = null;
  /** When an ADSR is routed to 'filterEnv' it BECOMES this voice's filter envelope
   *  (0..1, scaled by envRangeHz exactly like the built-in), replacing it. null ⇒ none. */
  filterEnvValue = null;
  constructor(note, params, sampleRate) {
    this.sr = sampleRate;
    const p = subParamsFromBag(params);
    this.p = p;
    this.begin = note.beginSec;
    this.holdEnd = note.beginSec + note.durationSec;
    this.noteHz = midiToFreq(note.midi);
    const baseFreq = this.noteHz * Math.pow(2, p.masterTune / 12);
    this.osc1 = new UnisonStack(p.osc1Wave, p.unisonVoices, sampleRate);
    this.osc2 = new UnisonStack(p.osc2Wave, p.unisonVoices, sampleRate);
    this.driftDepth = driftDepthFor(baseFreq);
    this.sub = new SineOsc(sampleRate);
    this.noiseLp = new Svf(sampleRate);
    this.stack = new FilterStack(
      p.filterModel,
      p.filterType,
      p.filter2Model,
      p.filter2Type,
      p.filterRouting,
      sampleRate
    );
    this.velPeak = param(params, "output.trim", 1) * velGain01(note.velocity, note.accent);
    this.keySemiDelta = note.midi - 60;
    this.accentMul = note.accent ? 1.3 : 1;
    this.osc1WaveFrozen = p.osc1Wave;
    this.osc2WaveFrozen = p.osc2Wave;
    this.ampBuiltinFrozen = p.ampBuiltinEnv;
    this.filterBuiltinFrozen = p.filterBuiltinEnv;
    this.ampA = p.ampAttack;
    this.ampD = p.ampDecay;
    this.ampS = p.ampSustain;
    this.ampR = p.ampRelease;
    this.filtA = p.filterAttack;
    this.filtD = p.filterDecay;
    this.filtS = p.filterSustain;
    this.filtR = p.filterRelease;
  }
  noteOff(t) {
    if (t < this.holdEnd) this.holdEnd = t;
  }
  /** Receive this voice's per-voice ADSR modulators (one Adsr each). Called once
   *  at spawn by the VoiceManager. LFOs are NOT here — they stay shared. The
   *  lane's numbering comes with them so each target resolves to a slot HERE,
   *  not on every sample. */
  setModEnvelopes(mods, index) {
    this.effMo = new Float64Array(index.length);
    this.adsrOnly = new Float64Array(index.length);
    this.sAmpTarget = slotOf(index, "amp");
    this.sFilterEnvTarget = slotOf(index, "filter.env");
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
        if (slot !== this.sAmpTarget && slot !== this.sFilterEnvTarget) touched.add(slot);
      }
      return { adsr: new Adsr(), m, slots: Int32Array.from(slots), depths: Float64Array.from(depths) };
    });
    this.touched = Int32Array.from(touched);
  }
  /** Swap this voice's param source for the lane's LIVE snapshot. Everything
   *  structural was already copied out in the constructor. */
  setLiveValues(values, index) {
    this.live = values;
    this.sMasterTune = slotOf(index, "master.tune");
    this.sUnisonDetune = slotOf(index, "master.detune");
    this.sUnisonDrift = slotOf(index, "master.drift");
    this.sOsc1Level = slotOf(index, "osc1.level");
    this.sOsc1Detune = slotOf(index, "osc1.detune");
    this.sOsc1Pw = slotOf(index, "osc1.pw");
    this.sOsc1Sync = slotOf(index, "osc1.sync");
    this.sOsc2Level = slotOf(index, "osc2.level");
    this.sOsc2Detune = slotOf(index, "osc2.detune");
    this.sOsc2Pw = slotOf(index, "osc2.pw");
    this.sOsc2Sync = slotOf(index, "osc2.sync");
    this.sRingLevel = slotOf(index, "ring.level");
    this.sSubLevel = slotOf(index, "sub.level");
    this.sNoiseLevel = slotOf(index, "noise.level");
    this.sNoiseColor = slotOf(index, "noise.color");
    this.sFilterCutoff = slotOf(index, "filter.cutoff");
    this.sFilterResonance = slotOf(index, "filter.resonance");
    this.sFilterEnvAmount = slotOf(index, "filter.envAmount");
    this.sFilterDrive = slotOf(index, "filter.drive");
    this.sFilterKeyTrack = slotOf(index, "filter.keyTrack");
    this.sFilter2Cutoff = slotOf(index, "filter2.cutoff");
    this.sFilter2Resonance = slotOf(index, "filter2.resonance");
    this.sFilter2Track = slotOf(index, "filter2.track");
    this.sFilterBlend = slotOf(index, "filter.blend");
    this.sAmpGain = slotOf(index, "amp.gain");
  }
  /** Fold this voice's gated ADSR envelopes into the shared-LFO offsets, returning
   *  one effective offset set the rest of renderSample reads. Reuses the pooled
   *  struct; `moIn` carries the full subtractive set, so copying it first
   *  resets every field before the ADSR contributions are added on top. */
  combineMods(t, gate, moIn) {
    const e = this.effMo;
    const a = this.adsrOnly;
    for (const s of this.touched) a[s] = 0;
    this.ampEnvValue = null;
    this.ampEnvAdsr = null;
    this.filterEnvValue = null;
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
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        const depth = depths[i];
        if (slot === this.sAmpTarget) {
          this.ampEnvValue = (this.ampEnvValue ?? 0) + env * depth;
          this.ampEnvAdsr = me.adsr;
          continue;
        }
        if (slot === this.sFilterEnvTarget) {
          this.filterEnvValue = (this.filterEnvValue ?? 0) + env * depth;
          continue;
        }
        a[slot] += env * depth;
      }
    }
    if (moIn) e.set(moIn);
    else e.fill(0);
    for (const s of this.touched) e[s] += a[s];
    return e;
  }
  /** This voice's ADSR-only offsets (for the UI knob ring). The worklet reads the
   *  most-recent voice's copy and adds the shared-LFO part on top. */
  getAdsrOffsets() {
    return this.adsrOnly;
  }
  renderSample(t, moIn) {
    if (t < this.begin) return 0;
    const p = this.p;
    const L = this.live;
    const gate = t <= this.holdEnd ? 1 : 0;
    const mo = this.modEnvs.length > 0 ? this.combineMods(t, gate, moIn) : moIn;
    const osc1Level = mo?.[this.sOsc1Level] ? clamp01((L && this.sOsc1Level >= 0 ? L[this.sOsc1Level] : p.osc1Level) + mo[this.sOsc1Level]) : L && this.sOsc1Level >= 0 ? L[this.sOsc1Level] : p.osc1Level;
    const osc2Level = mo?.[this.sOsc2Level] ? clamp01((L && this.sOsc2Level >= 0 ? L[this.sOsc2Level] : p.osc2Level) + mo[this.sOsc2Level]) : L && this.sOsc2Level >= 0 ? L[this.sOsc2Level] : p.osc2Level;
    const subLevel = mo?.[this.sSubLevel] ? clamp01((L && this.sSubLevel >= 0 ? L[this.sSubLevel] : p.subLevel) + mo[this.sSubLevel]) : L && this.sSubLevel >= 0 ? L[this.sSubLevel] : p.subLevel;
    const ringLevel = mo?.[this.sRingLevel] ? clamp01((L && this.sRingLevel >= 0 ? L[this.sRingLevel] : p.ringLevel) + mo[this.sRingLevel]) : L && this.sRingLevel >= 0 ? L[this.sRingLevel] : p.ringLevel;
    const noiseLevel = mo?.[this.sNoiseLevel] ? clamp01((L && this.sNoiseLevel >= 0 ? L[this.sNoiseLevel] : p.noiseLevel) + mo[this.sNoiseLevel]) : L && this.sNoiseLevel >= 0 ? L[this.sNoiseLevel] : p.noiseLevel;
    if ((L && this.sMasterTune >= 0 ? L[this.sMasterTune] : p.masterTune) !== this.tuneRaw) {
      this.tuneRaw = L && this.sMasterTune >= 0 ? L[this.sMasterTune] : p.masterTune;
      this.baseFreqCached = this.noteHz * Math.pow(2, (L && this.sMasterTune >= 0 ? L[this.sMasterTune] : p.masterTune) / 12);
    }
    const baseFreq = this.baseFreqCached;
    const f = mo?.[this.sMasterTune] ? baseFreq * Math.pow(2, mo[this.sMasterTune] * MOD_TUNE_SEMIS / 12) : baseFreq;
    const det1 = mo?.[this.sOsc1Detune] ? (L && this.sOsc1Detune >= 0 ? L[this.sOsc1Detune] : p.osc1Detune) + mo[this.sOsc1Detune] * MOD_DETUNE_CENTS : L && this.sOsc1Detune >= 0 ? L[this.sOsc1Detune] : p.osc1Detune;
    const det2 = mo?.[this.sOsc2Detune] ? (L && this.sOsc2Detune >= 0 ? L[this.sOsc2Detune] : p.osc2Detune) + mo[this.sOsc2Detune] * MOD_DETUNE_CENTS : L && this.sOsc2Detune >= 0 ? L[this.sOsc2Detune] : p.osc2Detune;
    const pw1 = this.osc1WaveFrozen === WAVE_SYNC ? clampSync(mo?.[this.sOsc1Sync] ? (L && this.sOsc1Sync >= 0 ? L[this.sOsc1Sync] : p.osc1Sync) + mo[this.sOsc1Sync] * MOD_SYNC_RANGE : L && this.sOsc1Sync >= 0 ? L[this.sOsc1Sync] : p.osc1Sync) : mo?.[this.sOsc1Pw] ? clampPw((L && this.sOsc1Pw >= 0 ? L[this.sOsc1Pw] : p.osc1Pw) + mo[this.sOsc1Pw] * MOD_PW_RANGE) : L && this.sOsc1Pw >= 0 ? L[this.sOsc1Pw] : p.osc1Pw;
    const pw2 = this.osc2WaveFrozen === WAVE_SYNC ? clampSync(mo?.[this.sOsc2Sync] ? (L && this.sOsc2Sync >= 0 ? L[this.sOsc2Sync] : p.osc2Sync) + mo[this.sOsc2Sync] * MOD_SYNC_RANGE : L && this.sOsc2Sync >= 0 ? L[this.sOsc2Sync] : p.osc2Sync) : mo?.[this.sOsc2Pw] ? clampPw((L && this.sOsc2Pw >= 0 ? L[this.sOsc2Pw] : p.osc2Pw) + mo[this.sOsc2Pw] * MOD_PW_RANGE) : L && this.sOsc2Pw >= 0 ? L[this.sOsc2Pw] : p.osc2Pw;
    const spread = mo?.[this.sUnisonDetune] ? clampSpread((L && this.sUnisonDetune >= 0 ? L[this.sUnisonDetune] : p.unisonDetune) + mo[this.sUnisonDetune] * MOD_UNISON_CENTS) : L && this.sUnisonDetune >= 0 ? L[this.sUnisonDetune] : p.unisonDetune;
    const drift = mo?.[this.sUnisonDrift] ? clamp01((L && this.sUnisonDrift >= 0 ? L[this.sUnisonDrift] : p.unisonDrift) + mo[this.sUnisonDrift]) : L && this.sUnisonDrift >= 0 ? L[this.sUnisonDrift] : p.unisonDrift;
    const driftAmt = drift * this.driftDepth;
    const o1 = this.osc1.update(f, pw1, det1, spread, driftAmt);
    const o2 = this.osc2.update(f, pw2, det2, spread, driftAmt);
    let mix = o1 * osc1Level + o2 * osc2Level + this.sub.update(f * 0.5) * subLevel;
    if (ringLevel > 0) mix += o1 * o2 * ringLevel;
    if (noiseLevel > 0) {
      const noiseColor = mo?.[this.sNoiseColor] ? clamp01((L && this.sNoiseColor >= 0 ? L[this.sNoiseColor] : p.noiseColor) + mo[this.sNoiseColor]) : L && this.sNoiseColor >= 0 ? L[this.sNoiseColor] : p.noiseColor;
      this.noiseLp.update(this.noise.update(), 200 + noiseColor * 14800, 0);
      mix += this.noiseLp.lp * noiseLevel;
    }
    const drive = mo?.[this.sFilterDrive] ? clamp01((L && this.sFilterDrive >= 0 ? L[this.sFilterDrive] : p.filterDrive) + mo[this.sFilterDrive]) : L && this.sFilterDrive >= 0 ? L[this.sFilterDrive] : p.filterDrive;
    if (drive > 0) mix = mix + driveShape(mix, 1) * drive;
    const cut01 = mo?.[this.sFilterCutoff] ? clamp01((L && this.sFilterCutoff >= 0 ? L[this.sFilterCutoff] : p.filterCutoff) + mo[this.sFilterCutoff]) : L && this.sFilterCutoff >= 0 ? L[this.sFilterCutoff] : p.filterCutoff;
    if (cut01 !== this.cutRaw) {
      this.cutRaw = cut01;
      this.cutHzCached = Math.min(60 * Math.pow(220, cut01), 18e3);
    }
    const baseCutoffHz = this.cutHzCached;
    const kt = mo?.[this.sFilterKeyTrack] ? clamp01((L && this.sFilterKeyTrack >= 0 ? L[this.sFilterKeyTrack] : p.filterKeyTrack) + mo[this.sFilterKeyTrack]) : L && this.sFilterKeyTrack >= 0 ? L[this.sFilterKeyTrack] : p.filterKeyTrack;
    const keyTrackHz = this.keySemiDelta * baseCutoffHz * (Math.pow(2, 1 / 12) - 1) * kt;
    const envAmt = mo?.[this.sFilterEnvAmount] ? clamp01((L && this.sFilterEnvAmount >= 0 ? L[this.sFilterEnvAmount] : p.filterEnvAmount) + mo[this.sFilterEnvAmount]) : L && this.sFilterEnvAmount >= 0 ? L[this.sFilterEnvAmount] : p.filterEnvAmount;
    const envRangeHz = Math.min(baseCutoffHz * 7, 16e3) * envAmt * this.accentMul;
    let fe;
    if (this.filterBuiltinFrozen >= 0.5) {
      fe = this.filtEnv.update(t, gate, this.filtA, this.filtD, this.filtS, this.filtR);
    } else if (this.filterEnvValue != null) {
      fe = this.filterEnvValue;
    } else {
      fe = 0;
    }
    const cutoff = baseCutoffHz + keyTrackHz + fe * envRangeHz;
    const q = mo?.[this.sFilterResonance] ? clamp01((L && this.sFilterResonance >= 0 ? L[this.sFilterResonance] : p.filterResonance) + mo[this.sFilterResonance]) : L && this.sFilterResonance >= 0 ? L[this.sFilterResonance] : p.filterResonance;
    const cut2Raw01 = mo?.[this.sFilter2Cutoff] ? clamp01((L && this.sFilter2Cutoff >= 0 ? L[this.sFilter2Cutoff] : p.filter2Cutoff) + mo[this.sFilter2Cutoff]) : L && this.sFilter2Cutoff >= 0 ? L[this.sFilter2Cutoff] : p.filter2Cutoff;
    if (cut2Raw01 !== this.cut2Raw) {
      this.cut2Raw = cut2Raw01;
      this.cut2HzCached = Math.min(60 * Math.pow(220, cut2Raw01), 18e3);
    }
    const track = mo?.[this.sFilter2Track] ? clamp01((L && this.sFilter2Track >= 0 ? L[this.sFilter2Track] : p.filter2Track) + mo[this.sFilter2Track]) : L && this.sFilter2Track >= 0 ? L[this.sFilter2Track] : p.filter2Track;
    const q2 = mo?.[this.sFilter2Resonance] ? clamp01((L && this.sFilter2Resonance >= 0 ? L[this.sFilter2Resonance] : p.filter2Resonance) + mo[this.sFilter2Resonance]) : L && this.sFilter2Resonance >= 0 ? L[this.sFilter2Resonance] : p.filter2Resonance;
    const blend = mo?.[this.sFilterBlend] ? clamp01((L && this.sFilterBlend >= 0 ? L[this.sFilterBlend] : p.filterBlend) + mo[this.sFilterBlend]) : L && this.sFilterBlend >= 0 ? L[this.sFilterBlend] : p.filterBlend;
    const cutoff2 = trackedCutoff(this.cut2HzCached, cutoff / Math.max(1e-9, baseCutoffHz), track);
    const filtered = this.stack.update(mix, cutoff, q, cutoff2, q2, blend);
    let ae;
    if (this.ampBuiltinFrozen >= 0.5) {
      ae = this.ampEnv.update(t, gate, this.ampA, this.ampD, this.ampS, this.ampR);
    } else if (this.ampEnvValue != null) {
      ae = this.ampEnvValue < 0 ? 0 : this.ampEnvValue > 1 ? 1 : this.ampEnvValue;
    } else {
      ae = 1;
    }
    let out = filtered * ae * this.velPeak;
    if (mo?.[this.sAmpGain]) out *= Math.max(0, Math.min(2, 1 + mo[this.sAmpGain]));
    const ampOff = this.ampBuiltinFrozen >= 0.5 ? this.ampEnv.isOff : this.ampEnvAdsr ? this.ampEnvAdsr.isOff : true;
    if (gate === 0 && ampOff && t > this.holdEnd) this.done = true;
    return out;
  }
};
Loom.registerRenderer("subtractive", (n, p, sr) => new SubtractiveVoiceRenderer(n, p, sr));
export {
  SubtractiveVoiceRenderer,
  subParamsFromBag,
  subParamsInto
};
