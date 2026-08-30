// packages/loom-plugin-sdk/src/dsp/mod-env-host.ts
var EMPTY = new Float64Array(0);

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
