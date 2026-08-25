// packages/loom-plugin-sdk/src/dsp/mod-env-host.ts
var EMPTY = new Float64Array(0);

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

// packages/loom-plugin-sdk/src/dsp/reverb-ir.ts
var REVERB_TYPES = ["room", "hall", "plate", "spring"];
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 1831565813 >>> 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
var PROFILES = {
  // Small, bright, tight cluster of reflections.
  room: {
    erTimes: [7e-3, 0.013, 0.019, 0.027, 0.037, 0.048, 0.061, 0.079],
    erGains: [0.85, 0.72, 0.6, 0.5, 0.4, 0.32, 0.25, 0.18],
    erStereo: 2e-3,
    predelay: 0.06,
    tailBright: 0.6,
    apDelays: [37e-4, 0.0113],
    apGain: 0.6,
    density: 2
  },
  // Large and DARK — reflections spread far out, highs roll away.
  hall: {
    erTimes: [0.012, 0.024, 0.038, 0.055, 0.074, 0.096, 0.121, 0.15, 0.183, 0.22],
    erGains: [0.9, 0.78, 0.67, 0.57, 0.48, 0.4, 0.33, 0.27, 0.22, 0.17],
    erStereo: 4e-3,
    predelay: 0.1,
    tailBright: 0.4,
    apDelays: [47e-4, 0.0137, 0.0211],
    apGain: 0.65,
    density: 2.5
  },
  // No room at all: a steel sheet. Near-instant, very bright, very dense.
  plate: {
    erTimes: [2e-3, 5e-3, 8e-3, 0.012, 0.017, 0.023],
    erGains: [0.95, 0.85, 0.75, 0.65, 0.55, 0.45],
    erStereo: 1e-3,
    predelay: 0.01,
    tailBright: 0.85,
    apDelays: [13e-4, 37e-4, 67e-4, 97e-4],
    apGain: 0.7,
    density: 3
  },
  // A spring's boing: reflections arrive in PAIRS (the wave reflecting off both
  // ends), which is what makes it sound like a guitar amp and not a room.
  spring: {
    erTimes: [3e-3, 0.03, 0.033, 0.06, 0.063, 0.09],
    erGains: [0.9, 0.7, 0.65, 0.5, 0.45, 0.35],
    erStereo: 5e-4,
    predelay: 0.03,
    tailBright: 0.5,
    apDelays: [29e-4, 89e-4],
    apGain: 0.55,
    density: 1.8
  }
};
function renderChannel(data, ch, opts, p) {
  const { sampleRate: rate, seconds, decay } = opts;
  const len = data.length;
  const rand = seededRandom(ch === 0 ? 7919 : 104729);
  for (let r = 0; r < p.erTimes.length; r++) {
    const skew = ch === 0 ? 0 : p.erStereo * (r % 3 === 0 ? 1 : -1);
    const idx = Math.round((p.erTimes[r] + skew) * rate);
    if (idx >= 0 && idx < len) {
      data[idx] += p.erGains[r] * (ch === 0 ? 1 : -1 + 2 * (r % 2));
    }
  }
  const predelay = Math.min(len, Math.round(p.predelay * rate));
  const decayRate = decay / (rate * Math.max(0.05, seconds) * 1.35);
  for (let i = predelay; i < len; i++) {
    data[i] += (rand() * 2 - 1) * p.density * Math.exp(-(i - predelay) * decayRate);
  }
  if (p.tailBright < 1) {
    let lp = 0;
    for (let i = predelay; i < len; i++) {
      lp += p.tailBright * (data[i] - lp);
      data[i] = lp;
    }
  }
  for (const apSec of p.apDelays) {
    const apLen = Math.max(1, Math.round(apSec * rate));
    const apBuf = new Float32Array(apLen);
    let apIdx = 0;
    for (let i = 0; i < len; i++) {
      const delayed = apBuf[apIdx];
      const input = data[i];
      data[i] = -input * p.apGain + delayed;
      apBuf[apIdx] = input + delayed * p.apGain;
      apIdx = apIdx + 1 === apLen ? 0 : apIdx + 1;
    }
  }
  let x1 = 0, y1 = 0;
  for (let i = 0; i < len; i++) {
    const x = data[i];
    y1 = x - x1 + 0.995 * y1;
    x1 = x;
    data[i] = y1;
  }
}
function generateReverbIR(opts) {
  const len = Math.max(1, Math.ceil(opts.sampleRate * Math.max(0.05, opts.seconds)));
  const p = PROFILES[opts.type] ?? PROFILES.room;
  const left = new Float32Array(len);
  const right = new Float32Array(len);
  renderChannel(left, 0, opts, p);
  renderChannel(right, 1, opts, p);
  return { left, right };
}

// packages/loom-plugin-sdk/src/dsp/pattern.ts
var GOLDEN_PATTERN = (Math.sqrt(5) - 1) / 2;

// plugins/reverb/main.ts
function makeImpulse(ctx, sec, decay, type) {
  const { left, right } = generateReverbIR({
    sampleRate: ctx.sampleRate,
    seconds: sec,
    decay,
    type
  });
  const ir = ctx.createBuffer(2, left.length, ctx.sampleRate);
  ir.getChannelData(0).set(left);
  ir.getChannelData(1).set(right);
  return ir;
}
Loom.registerFx("reverb", (ctx) => {
  let size = 2.5, decay = 3, typeIdx = 0;
  const input = ctx.createGain();
  const predelay = ctx.createDelay(0.5);
  const conv = ctx.createConvolver();
  const rebuild = () => {
    conv.buffer = makeImpulse(ctx, size, decay, REVERB_TYPES[typeIdx] ?? "room");
  };
  rebuild();
  const wet = ctx.createGain();
  wet.gain.value = 0.9;
  const output = ctx.createGain();
  input.connect(predelay).connect(conv).connect(wet).connect(output);
  const params = /* @__PURE__ */ new Map([
    ["wet", wet.gain],
    ["predelay", predelay.delayTime]
  ]);
  return {
    input,
    output,
    getAudioParams: () => params,
    getBaseValue: (id) => {
      if (id === "wet") return wet.gain.value;
      if (id === "predelay") return predelay.delayTime.value;
      if (id === "size") return size;
      if (id === "decay") return decay;
      if (id === "type") return typeIdx;
      return 0;
    },
    setBaseValue: (id, v) => {
      if (id === "wet") wet.gain.value = v;
      if (id === "predelay") predelay.delayTime.setTargetAtTime(v, ctx.currentTime, 0.01);
      if (id === "size") {
        if (v !== size) {
          size = v;
          rebuild();
        }
      }
      if (id === "decay") {
        if (v !== decay) {
          decay = v;
          rebuild();
        }
      }
      if (id === "type") {
        const i = v | 0;
        if (i !== typeIdx) {
          typeIdx = i;
          rebuild();
        }
      }
    },
    applyPreset: () => {
    },
    dispose: () => {
      try {
        input.disconnect();
        predelay.disconnect();
        conv.disconnect();
        wet.disconnect();
        output.disconnect();
      } catch {
      }
    }
  };
});
