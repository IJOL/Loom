// packages/loom-plugin-sdk/src/types.ts
var param = (b, id, d) => b[id] ?? d;
var slotOf = (ix, id) => ix.slot[id] ?? -1;

// packages/loom-plugin-sdk/src/dsp/util.ts
var midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

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

// plugins/karplus/dsp.ts
var DC_R = 0.997;
var KsLoop = class {
  constructor(Li, frac, dlSize) {
    this.Li = Li;
    this.frac = frac;
    this.dl = new Float32Array(dlSize);
  }
  dl;
  widx = 0;
  lp = 0;
  dcX = 0;
  dcY = 0;
  step(exc, a, g) {
    const dl = this.dl, dlSize = dl.length;
    const i0 = (this.widx - this.Li + dlSize) % dlSize;
    const i1 = (i0 - 1 + dlSize) % dlSize;
    const read = dl[i0] * (1 - this.frac) + dl[i1] * this.frac;
    this.lp += a * (read - this.lp);
    const s = exc + g * this.lp;
    dl[this.widx] = s;
    this.widx = this.widx + 1 === dlSize ? 0 : this.widx + 1;
    const y = s - this.dcX + DC_R * this.dcY;
    this.dcX = s;
    this.dcY = y;
    return y;
  }
};
function aFromBrightness(brightness) {
  return 0.15 + brightness * 0.8;
}
function gFromDamping(damping, freq) {
  const t60 = 4 * Math.pow(0.03, damping);
  return Math.min(0.9995, Math.exp(Math.log(1e-3) / (Math.max(20, freq) * t60)));
}
var KarplusRenderer = class {
  sr;
  begin;
  holdEnd;
  atk;
  rel;
  levelBase;
  ampEnvOn;
  vel;
  /** Per-preset output trim (gain-staging "preset.trim" — params['output.trim'],
   *  default 1). */
  trimBase;
  dampingBase;
  brightnessBase;
  freq;
  // Excitation burst — frozen: the pluck is over by the time a knob can move.
  excBurst;
  exciteLen;
  totalSamples;
  // Fixed headroom scalar, derived once from a dry run at the trigger-time
  // snapshot (see the constructor) so a single note can never clip regardless
  // of the resonance the live knobs later dial in.
  normGain;
  // The REAL playback loop — persistent per-sample state, live coefficients.
  loop;
  // Cached expensive conversion: gFromDamping (pow+exp+log) is not a
  // per-sample cost while the damping knob is settled.
  dampRaw = NaN;
  gCache = 0;
  modEnv = new ModEnvHost();
  /** The lane's live (smoothed) values, or null when this voice runs standalone
   *  (the offline kernel builds renderers directly). Addressed by the four slots
   *  below, resolved ONCE in setLiveValues — renderSample never sees a string.
   *  A slot of -1 means the lane does not declare that id, so the frozen
   *  trigger-time value stands. */
  live = null;
  sLevel = -1;
  sTrim = -1;
  sDamping = -1;
  sBrightness = -1;
  /** The synthetic tremolo target. Not a declared param — the index appends it,
   *  which is what those three synthetic slots are for. */
  sAmpGain = -1;
  done = false;
  /** `rng` is a test seam: production never passes it, so the excitation stays
   *  Math.random and every pluck differs, as a plucked string should. */
  constructor(note, p, sampleRate, rng) {
    const fs = this.sr = sampleRate;
    this.begin = note.beginSec;
    this.holdEnd = note.beginSec + note.durationSec;
    this.atk = Math.max(1e-3, param(p, "amp.attack", 5e-3));
    this.rel = Math.max(0.05, param(p, "amp.release", 0.5));
    this.levelBase = param(p, "amp.level", 0.8);
    this.ampEnvOn = param(p, "amp.builtinEnv", 1) >= 0.5;
    this.trimBase = param(p, "output.trim", 1);
    this.dampingBase = param(p, "string.damping", 0.5);
    this.brightnessBase = param(p, "string.brightness", 0.65);
    this.vel = velGain01(note.velocity, note.accent);
    this.freq = midiToFreq(note.midi);
    const a0 = aFromBrightness(this.brightnessBase);
    const period = fs / Math.max(20, this.freq);
    const Ldelay = Math.max(1, period - (1 - a0) / a0);
    const Li = Math.floor(Ldelay);
    const frac = Ldelay - Li;
    const dlSize = Li + 2;
    this.totalSamples = Math.max(1, Math.round(
      Math.min(8, Math.max(0.4, note.durationSec + this.rel + 0.3)) * fs
    ));
    const exciteDur = Math.max(1e-3, param(p, "excite.time", 0.01));
    const noiseTone = param(p, "excite.tone", 0.5);
    this.exciteLen = Math.min(this.totalSamples, Math.max(4, Math.round(exciteDur * fs)));
    const noiseHz = Math.min(fs * 0.45, 200 * Math.pow(60, noiseTone));
    const na = 1 - Math.exp(-2 * Math.PI * noiseHz / fs);
    const gen = rng ?? Math.random;
    const excBurst = new Float32Array(this.exciteLen);
    const FADE = 32;
    let nlp = 0;
    for (let n = 0; n < this.exciteLen; n++) {
      const w = gen() * 2 - 1;
      nlp += na * (w - nlp);
      let e = nlp;
      if (n > this.exciteLen - FADE) {
        e *= 0.5 - 0.5 * Math.cos(Math.PI * (this.exciteLen - n) / FADE);
      }
      excBurst[n] = e;
    }
    this.excBurst = excBurst;
    const g0 = gFromDamping(this.dampingBase, this.freq);
    const dry = new KsLoop(Li, frac, dlSize);
    const normSamples = Math.min(this.totalSamples, this.exciteLen + Math.ceil(8 * period) + 64);
    let pk = 0;
    for (let n = 0; n < normSamples; n++) {
      const exc = n < this.exciteLen ? excBurst[n] : 0;
      const s = Math.abs(dry.step(exc, a0, g0));
      if (s > pk) pk = s;
    }
    this.normGain = pk > 1e-9 ? 1 / pk : 1;
    this.loop = new KsLoop(Li, frac, dlSize);
  }
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
    this.sLevel = slotOf(index, "amp.level");
    this.sTrim = slotOf(index, "output.trim");
    this.sDamping = slotOf(index, "string.damping");
    this.sBrightness = slotOf(index, "string.brightness");
    this.sAmpGain = slotOf(index, "amp.gain");
  }
  renderSample(t, moIn) {
    if (t < this.begin) return 0;
    const idx = Math.floor((t - this.begin) * this.sr);
    if (idx >= this.totalSamples) {
      this.done = true;
      return 0;
    }
    const gate = t <= this.holdEnd ? 1 : 0;
    const mo = this.modEnv.active ? this.modEnv.combine(t, gate, moIn) : moIn;
    const L = this.live;
    const levelKnob = L && this.sLevel >= 0 ? L[this.sLevel] : this.levelBase;
    const trim = L && this.sTrim >= 0 ? L[this.sTrim] : this.trimBase;
    const damping = L && this.sDamping >= 0 ? L[this.sDamping] : this.dampingBase;
    const brightness = L && this.sBrightness >= 0 ? L[this.sBrightness] : this.brightnessBase;
    if (damping !== this.dampRaw) {
      this.dampRaw = damping;
      this.gCache = gFromDamping(damping, this.freq);
    }
    const a = aFromBrightness(brightness);
    const exc = idx < this.exciteLen ? this.excBurst[idx] : 0;
    const raw = this.loop.step(exc, a, this.gCache) * this.normGain;
    let env = 1;
    if (this.ampEnvOn) {
      const dt = t - this.begin;
      const relStart = this.holdEnd - this.begin;
      if (dt < this.atk) {
        env = dt / this.atk;
      } else if (dt < relStart) {
        env = 1;
      } else {
        env = Math.exp(-(dt - relStart) / this.rel);
        if (t > this.holdEnd && env < 1e-3) this.done = true;
      }
    }
    const level = mo?.[this.sLevel] ? Math.max(0, levelKnob + mo[this.sLevel]) : levelKnob;
    let out = raw * env * level * this.vel * trim;
    if (mo?.[this.sAmpGain]) out *= Math.max(0, Math.min(2, 1 + mo[this.sAmpGain]));
    return out;
  }
};
Loom.registerRenderer("karplus", (n, p, sr) => new KarplusRenderer(n, p, sr));
export {
  KarplusRenderer
};
