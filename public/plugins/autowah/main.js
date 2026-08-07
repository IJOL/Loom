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

// packages/loom-plugin-sdk/src/dsp/envelope-follower.ts
var FOLLOWER_MIN_HZ = 2;
function cutoffFor(ms) {
  const tau = Math.max(0.01, ms) / 1e3;
  return Math.max(FOLLOWER_MIN_HZ, 1 / (2 * Math.PI * tau));
}
function absCurve() {
  const n = 1025;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = Math.abs(i * 2 / (n - 1) - 1);
  return c;
}
function createEnvelopeFollower(ctx, opts) {
  const input = ctx.createGain();
  const rectify = ctx.createWaveShaper();
  rectify.curve = absCurve();
  rectify.oversample = "none";
  const smooth1 = ctx.createBiquadFilter();
  const smooth2 = ctx.createBiquadFilter();
  for (const f of [smooth1, smooth2]) {
    f.type = "lowpass";
    f.Q.value = 0.5;
  }
  const scale = ctx.createGain();
  scale.gain.value = Math.PI / 2;
  input.connect(rectify).connect(smooth1).connect(smooth2).connect(scale);
  let attackMs = opts.attackMs;
  let releaseMs = opts.releaseMs;
  const apply = () => {
    const hz = Math.max(cutoffFor(attackMs), cutoffFor(releaseMs));
    smooth1.frequency.value = hz;
    smooth2.frequency.value = hz;
  };
  apply();
  return {
    input,
    output: scale,
    setAttack: (ms) => {
      attackMs = ms;
      apply();
    },
    setRelease: (ms) => {
      releaseMs = ms;
      apply();
    },
    smoothingHz: () => smooth1.frequency.value,
    dispose: () => {
      for (const n of [input, rectify, smooth1, smooth2, scale]) {
        try {
          n.disconnect();
        } catch {
        }
      }
    }
  };
}

// plugins/autowah/main.ts
Loom.registerFx("autowah", (ctx) => {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 300;
  filter.Q.value = 4;
  const follower = createEnvelopeFollower(ctx, { attackMs: 10, releaseMs: 120 });
  input.connect(follower.input);
  const depth = ctx.createGain();
  depth.gain.value = 2400 * 0.6;
  follower.output.connect(depth).connect(filter.detune);
  const dry = ctx.createGain();
  dry.gain.value = 0;
  const wet = ctx.createGain();
  wet.gain.value = 1;
  input.connect(dry).connect(output);
  input.connect(filter).connect(wet).connect(output);
  let sens = 0.6, range = 2400, base = 300, attack = 10, release = 120, q = 4, mix = 1;
  const applyDepth = () => {
    depth.gain.value = range * sens;
  };
  return {
    input,
    output,
    getAudioParams: () => /* @__PURE__ */ new Map([
      ["base", filter.detune],
      ["q", filter.Q],
      ["mix", wet.gain]
    ]),
    getAudioParamRange: (id) => {
      if (id === "base") return { min: 0, max: 4800 };
      if (id === "q") return { min: 0, max: 12 };
      return void 0;
    },
    getBaseValue: (id) => id === "sens" ? sens : id === "range" ? range : id === "base" ? base : id === "attack" ? attack : id === "release" ? release : id === "q" ? q : id === "mix" ? mix : 0,
    setBaseValue: (id, v) => {
      if (id === "sens") {
        sens = v;
        applyDepth();
      }
      if (id === "range") {
        range = v;
        applyDepth();
      }
      if (id === "base") {
        base = v;
        filter.frequency.value = v;
      }
      if (id === "attack") {
        attack = v;
        follower.setAttack(v);
      }
      if (id === "release") {
        release = v;
        follower.setRelease(v);
      }
      if (id === "q") {
        q = v;
        filter.Q.value = v;
      }
      if (id === "mix") {
        mix = v;
        wet.gain.value = v;
        dry.gain.value = 1 - v;
      }
    },
    applyPreset: () => {
    },
    dispose: () => {
      follower.dispose();
      for (const n of [input, output, filter, depth, dry, wet]) {
        try {
          n.disconnect();
        } catch {
        }
      }
    }
  };
});
