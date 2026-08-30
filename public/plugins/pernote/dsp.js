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
function patternValue(n, pattern = GOLDEN_PATTERN, skew = 0) {
  if (!Number.isFinite(n) || !Number.isFinite(pattern) || !Number.isFinite(skew)) return 0;
  const x = n * pattern + skew;
  return x - Math.floor(x);
}
function patternValueBipolar(n, pattern = GOLDEN_PATTERN, skew = 0) {
  return patternValue(n, pattern, skew) * 2 - 1;
}

// plugins/pernote/dsp.ts
Loom.registerModulatorKernel({
  id: "pernote",
  valueAt(m, _t, _origin, triggerIndex) {
    const n = triggerIndex ?? 0;
    const pattern = m.params?.pattern ?? GOLDEN_PATTERN;
    const skew = m.params?.skew ?? 0;
    return m.params?.bipolar === 0 ? patternValue(n, pattern, skew) : patternValueBipolar(n, pattern, skew);
  }
});
