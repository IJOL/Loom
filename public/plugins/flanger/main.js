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

// packages/loom-plugin-sdk/src/dsp/modulated-delay.ts
var MODULATED_DELAY_DEFAULTS = { rate: 0.8, depth: 0.6, feedback: 0.4, mix: 0.5 };
function createModulatedDelay(ctx, spec) {
  const d = MODULATED_DELAY_DEFAULTS;
  const input = ctx.createGain();
  const output = ctx.createGain();
  const delay = ctx.createDelay(1);
  delay.delayTime.value = spec.baseDelaySec;
  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = d.rate;
  const sweep = ctx.createGain();
  sweep.gain.value = spec.sweepSec * 0.6;
  lfo.connect(sweep).connect(delay.delayTime);
  lfo.start();
  const fb = ctx.createGain();
  fb.gain.value = spec.maxFeedback > 0 ? d.feedback * spec.maxFeedback : 0;
  const dry = ctx.createGain();
  dry.gain.value = 1 - d.mix;
  const wet = ctx.createGain();
  wet.gain.value = d.mix;
  input.connect(dry).connect(output);
  input.connect(delay);
  delay.connect(wet).connect(output);
  if (spec.maxFeedback > 0) delay.connect(fb).connect(delay);
  let rate = d.rate, depth = d.depth, feedback = d.feedback, mix = d.mix;
  const applyDepth = () => {
    sweep.gain.value = spec.sweepSec * depth * 0.6;
  };
  const applyMix = () => {
    wet.gain.value = mix;
    dry.gain.value = 1 - mix;
  };
  return {
    input,
    output,
    getAudioParams: () => /* @__PURE__ */ new Map([
      ["rate", lfo.frequency],
      ["mix", wet.gain]
    ]),
    getBaseValue: (id) => id === "rate" ? rate : id === "depth" ? depth : id === "feedback" ? feedback : id === "mix" ? mix : 0,
    setBaseValue: (id, v) => {
      if (id === "rate") {
        rate = v;
        lfo.frequency.value = v;
      }
      if (id === "depth") {
        depth = v;
        applyDepth();
      }
      if (id === "feedback" && spec.maxFeedback > 0) {
        feedback = v;
        fb.gain.value = v * spec.maxFeedback;
      }
      if (id === "mix") {
        mix = v;
        applyMix();
      }
    },
    applyPreset: () => {
    },
    dispose: () => {
      try {
        lfo.stop();
      } catch {
      }
      for (const n of [input, output, delay, lfo, sweep, fb, dry, wet]) {
        try {
          n.disconnect();
        } catch {
        }
      }
    }
  };
}

// plugins/flanger/main.ts
Loom.registerFx("flanger", (ctx) => createModulatedDelay(ctx, {
  baseDelaySec: 2e-3,
  // ~2 ms — the jet region
  sweepSec: 18e-4,
  // sweep close to the base, staying short
  maxFeedback: 0.75
  // resonance 1/(1 − g) = 4 — see the note above
}));
