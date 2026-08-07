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

// plugins/gate/main.ts
var CURVE_POINTS = 1025;
function gateCurve(thrLin, floor) {
  const c = new Float32Array(CURVE_POINTS);
  const knee = Math.max(1e-4, thrLin * 0.1);
  for (let i = 0; i < CURVE_POINTS; i++) {
    const x = Math.abs(i * 2 / (CURVE_POINTS - 1) - 1);
    const t = Math.min(1, Math.max(0, (x - (thrLin - knee)) / (2 * knee)));
    c[i] = floor + (1 - floor) * t;
  }
  return c;
}
var dbToLin = (db) => Math.pow(10, db / 20);
Loom.registerFx("gate", (ctx) => {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const vca = ctx.createGain();
  vca.gain.value = 0;
  input.connect(vca).connect(output);
  const follower = createEnvelopeFollower(ctx, { attackMs: 2, releaseMs: 150 });
  input.connect(follower.input);
  let threshold = -30, range = -60, attack = 2, release = 150;
  let shaper = ctx.createWaveShaper();
  const buildShaper = () => {
    const next = ctx.createWaveShaper();
    next.curve = gateCurve(dbToLin(threshold), dbToLin(range));
    next.oversample = "none";
    follower.output.connect(next);
    next.connect(vca.gain);
    try {
      follower.output.disconnect(shaper);
      shaper.disconnect();
    } catch {
    }
    shaper = next;
  };
  buildShaper();
  return {
    input,
    output,
    getAudioParams: () => /* @__PURE__ */ new Map(),
    getBaseValue: (id) => id === "threshold" ? threshold : id === "range" ? range : id === "attack" ? attack : id === "release" ? release : 0,
    setBaseValue: (id, v) => {
      if (id === "threshold") {
        if (v !== threshold) {
          threshold = v;
          buildShaper();
        }
      }
      if (id === "range") {
        if (v !== range) {
          range = v;
          buildShaper();
        }
      }
      if (id === "attack") {
        attack = v;
        follower.setAttack(v);
      }
      if (id === "release") {
        release = v;
        follower.setRelease(v);
      }
    },
    applyPreset: () => {
    },
    dispose: () => {
      follower.dispose();
      for (const n of [input, output, vca, shaper]) {
        try {
          n.disconnect();
        } catch {
        }
      }
    }
  };
});
