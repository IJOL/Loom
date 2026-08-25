// packages/loom-plugin-sdk/src/types.ts
var param = (b, id, d) => b[id] ?? d;
var slotOf = (ix, id) => ix.slot[id] ?? -1;

// packages/loom-plugin-sdk/src/dsp/util.ts
var midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
var clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;

// packages/loom-plugin-sdk/src/dsp/velocity.ts
var ACCENT_PUNCH = 1.1;
var ACCENT_VCA_LADDER = 1.3;
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

// plugins/tb303/dsp.ts
var AMP_FLOOR = 1e-3 / 0.54;
var Q_MIN = 1;
var Q_MAX = 31;
function qToLadderRes(q) {
  const norm = (Math.max(Q_MIN, q) - Q_MIN) / (Q_MAX - Q_MIN);
  return Math.min(1, Math.pow(norm, 0.7));
}
var TB303Renderer = class {
  constructor(note, p, sr) {
    this.sr = sr;
    const wave = param(p, "osc.wave", 0);
    this.osc = wave >= 0.5 ? new SquareOsc(sr) : new SawOsc(sr);
    this.filter = new LadderFilter("diode", sr);
    this.begin = note.beginSec;
    this.holdEnd = note.beginSec + note.durationSec;
    this.freq = midiToFreq(note.midi);
    this.slide = note.slide;
    const cutoff = param(p, "filter.cutoff", 0.42);
    const resonance = param(p, "filter.resonance", 0.55);
    const envMod = param(p, "env.amount", 0.5);
    const decay = param(p, "env.decay", 0.4);
    const accentAmt = param(p, "env.accent", 0.6);
    const accentBoost = note.accent ? accentAmt : 0;
    this.cutoffBase = cutoff;
    this.resBase = resonance;
    this.envModBase = envMod;
    this.decayBase = decay;
    this.accent = note.accent;
    this.accentBoost = accentBoost;
    this.peakAmp = velGain01(note.velocity, note.accent, ACCENT_VCA_LADDER);
  }
  osc;
  // The 303 filters through a diode ladder — its asymmetric clipping is the
  // instrument's voice, not a detail. See the SDK's ladder.ts.
  filter;
  begin;
  holdEnd;
  freq;
  peakAmp;
  slide;
  // Trigger-time knob snapshot. Used as the fallback when no live bag is attached
  // (the offline kernel builds renderers directly) and as the base the modulation
  // offsets are added to.
  cutoffBase;
  resBase;
  envModBase;
  decayBase;
  accentBoost;
  accent;
  /** The lane's live (smoothed) values, or null when this voice runs standalone.
   *  Addressed by the slots below, resolved ONCE in setLiveValues; -1 means the
   *  lane does not declare that id, so the trigger snapshot stands. */
  live = null;
  sCutoff = -1;
  sRes = -1;
  sEnvAmount = -1;
  sEnvDecay = -1;
  /** The synthetic tremolo target. Not a declared param — the index appends it,
   *  which is what those three synthetic slots are for. */
  sAmpGain = -1;
  // Cached expensive conversions, refreshed only when their raw input moves.
  // 80·100^x and the Q→ladder curve are per-sample costs we refuse to pay while
  // nothing is turning.
  cutRaw = NaN;
  cutHz = 0;
  resRaw = NaN;
  resLadder = 0;
  modEnv = new ModEnvHost();
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
    this.sCutoff = slotOf(index, "filter.cutoff");
    this.sRes = slotOf(index, "filter.resonance");
    this.sEnvAmount = slotOf(index, "env.amount");
    this.sEnvDecay = slotOf(index, "env.decay");
    this.sAmpGain = slotOf(index, "amp.gain");
  }
  renderSample(t, moIn) {
    if (this.done) return 0;
    if (t < this.begin) return 0;
    const dt = t - this.begin;
    const gate = t <= this.holdEnd ? 1 : 0;
    const mo = this.modEnv.active ? this.modEnv.combine(t, gate, moIn) : moIn;
    const gateLen = this.holdEnd - this.begin;
    const attackDur = this.slide ? 0 : 3e-3;
    const attackEnd = attackDur;
    const releaseStart = Math.max(attackEnd, gateLen - 0.02);
    let amp;
    if (!this.slide && dt < attackEnd) {
      amp = attackDur > 0 ? this.peakAmp * (dt / attackDur) : this.peakAmp;
    } else if (dt < releaseStart) {
      amp = this.peakAmp;
    } else {
      const relDt = dt - releaseStart;
      const relDur = Math.max(gateLen - releaseStart, 1e-3);
      const ratio = Math.min(relDt / relDur, 1);
      amp = this.peakAmp * Math.pow(AMP_FLOOR / Math.max(this.peakAmp, AMP_FLOOR), ratio);
      if (t > this.holdEnd && amp <= AMP_FLOOR) {
        this.done = true;
        return 0;
      }
    }
    const L = this.live;
    const cutKnob = L && this.sCutoff >= 0 ? L[this.sCutoff] : this.cutoffBase;
    const resKnob = L && this.sRes >= 0 ? L[this.sRes] : this.resBase;
    const envKnob = L && this.sEnvAmount >= 0 ? L[this.sEnvAmount] : this.envModBase;
    const decKnob = L && this.sEnvDecay >= 0 ? L[this.sEnvDecay] : this.decayBase;
    const cutoff01 = mo?.[this.sCutoff] ? clamp01(cutKnob + mo[this.sCutoff]) : cutKnob;
    if (cutoff01 !== this.cutRaw) {
      this.cutRaw = cutoff01;
      this.cutHz = 80 * Math.pow(100, cutoff01);
    }
    const baseCutHz = this.cutHz;
    const envMod01 = mo?.[this.sEnvAmount] ? clamp01(envKnob + mo[this.sEnvAmount]) : envKnob;
    const peakCutHz = Math.min(baseCutHz + envMod01 * 6e3 * (1 + this.accentBoost), 18e3);
    const decay01 = mo?.[this.sEnvDecay] ? clamp01(decKnob + mo[this.sEnvDecay]) : decKnob;
    const decaySec = (0.05 + decay01 * 1.2) * (this.accent ? 0.6 : 1);
    const cutoffHz = baseCutHz + (peakCutHz - baseCutHz) * Math.exp(-dt / decaySec);
    if (resKnob !== this.resRaw) {
      this.resRaw = resKnob;
      this.resLadder = qToLadderRes(1 + resKnob * 25 + this.accentBoost * 6);
    }
    const res = mo?.[this.sRes] ? clamp01(this.resLadder + mo[this.sRes]) : this.resLadder;
    const oscOut = this.osc.update(this.freq);
    let out = this.filter.update(oscOut, cutoffHz, res) * amp;
    if (mo?.[this.sAmpGain]) out *= Math.max(0, Math.min(2, 1 + mo[this.sAmpGain]));
    return out;
  }
};
Loom.registerRenderer("tb303", (n, p, sr) => new TB303Renderer(n, p, sr));
export {
  TB303Renderer
};
