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

// packages/loom-plugin-sdk/src/dsp/pattern.ts
var GOLDEN_PATTERN = (Math.sqrt(5) - 1) / 2;

// packages/loom-plugin-sdk/src/dsp/signal-max.ts
function absCurve() {
  const n = 1025;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = Math.abs(i * 2 / (n - 1) - 1);
  return c;
}
function createSignalMax(ctx, headroom = 4) {
  const a = ctx.createGain();
  const b = ctx.createGain();
  const sum = ctx.createGain();
  a.connect(sum);
  b.connect(sum);
  const diff = ctx.createGain();
  const negate = ctx.createGain();
  negate.gain.value = -1;
  a.connect(diff);
  b.connect(negate).connect(diff);
  const preAbs = ctx.createGain();
  preAbs.gain.value = 1 / headroom;
  const absShape = ctx.createWaveShaper();
  absShape.curve = absCurve();
  absShape.oversample = "none";
  const postAbs = ctx.createGain();
  postAbs.gain.value = headroom;
  diff.connect(preAbs).connect(absShape).connect(postAbs);
  const output = ctx.createGain();
  output.gain.value = 0.5;
  sum.connect(output);
  postAbs.connect(output);
  return {
    a,
    b,
    output,
    dispose: () => {
      for (const n of [a, b, sum, diff, negate, preAbs, absShape, postAbs, output]) {
        try {
          n.disconnect();
        } catch {
        }
      }
    }
  };
}

// packages/loom-plugin-sdk/src/dsp/envelope-follower.ts
var FOLLOWER_MIN_HZ = 2;
function cutoffFor(ms) {
  const tau = Math.max(0.01, ms) / 1e3;
  return Math.max(FOLLOWER_MIN_HZ, 1 / (2 * Math.PI * tau));
}
function absCurve2() {
  const n = 1025;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = Math.abs(i * 2 / (n - 1) - 1);
  return c;
}
function createEnvelopeFollower(ctx, opts) {
  const input = ctx.createGain();
  const rectify = ctx.createWaveShaper();
  rectify.curve = absCurve2();
  rectify.oversample = "none";
  const mkChain = () => {
    const a = ctx.createBiquadFilter();
    const b = ctx.createBiquadFilter();
    for (const f of [a, b]) {
      f.type = "lowpass";
      f.Q.value = 0.5;
    }
    a.connect(b);
    return { head: a, tail: b };
  };
  const fast = mkChain();
  const slow = mkChain();
  rectify.connect(fast.head);
  rectify.connect(slow.head);
  const max = createSignalMax(ctx);
  fast.tail.connect(max.a);
  slow.tail.connect(max.b);
  const scale = ctx.createGain();
  scale.gain.value = Math.PI / 2;
  input.connect(rectify);
  max.output.connect(scale);
  let attackMs = opts.attackMs;
  let releaseMs = opts.releaseMs;
  const apply = () => {
    const aHz = cutoffFor(attackMs);
    const rHz = cutoffFor(releaseMs);
    fast.head.frequency.value = aHz;
    fast.tail.frequency.value = aHz;
    slow.head.frequency.value = rHz;
    slow.tail.frequency.value = rHz;
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
    smoothingHz: () => ({ attack: fast.head.frequency.value, release: slow.head.frequency.value }),
    dispose: () => {
      max.dispose();
      for (const n of [input, rectify, fast.head, fast.tail, slow.head, slow.tail, scale]) {
        try {
          n.disconnect();
        } catch {
        }
      }
    }
  };
}

// plugins/gate/main.ts
var CURVE_POINTS = 4097;
var CURVE_STEP = 2 / (CURVE_POINTS - 1);
function gateCurve(thrLin, floor) {
  const c = new Float32Array(CURVE_POINTS);
  const knee = Math.max(2 * CURVE_STEP, thrLin * 0.1);
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
  const HOLD_MAX_SEC = 1;
  const holdDelay = ctx.createDelay(HOLD_MAX_SEC);
  const held = createSignalMax(ctx);
  follower.output.connect(held.a);
  follower.output.connect(holdDelay).connect(held.b);
  let threshold = -30, range = -60, attack = 2, hold = 20, release = 150;
  holdDelay.delayTime.value = hold / 1e3;
  let shaper = ctx.createWaveShaper();
  const buildShaper = () => {
    const next = ctx.createWaveShaper();
    next.curve = gateCurve(dbToLin(threshold), dbToLin(range));
    next.oversample = "none";
    held.output.connect(next);
    next.connect(vca.gain);
    try {
      held.output.disconnect(shaper);
    } catch {
    }
    try {
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
    getBaseValue: (id) => id === "threshold" ? threshold : id === "range" ? range : id === "attack" ? attack : id === "hold" ? hold : id === "release" ? release : 0,
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
      if (id === "hold") {
        hold = v;
        holdDelay.delayTime.value = Math.min(HOLD_MAX_SEC, v / 1e3);
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
      held.dispose();
      for (const n of [input, output, vca, holdDelay, shaper]) {
        try {
          n.disconnect();
        } catch {
        }
      }
    }
  };
});
