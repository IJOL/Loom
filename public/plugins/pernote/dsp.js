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
