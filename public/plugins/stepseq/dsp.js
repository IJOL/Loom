// plugins/stepseq/dsp.ts
var STEP_IDS = [
  "step0",
  "step1",
  "step2",
  "step3",
  "step4",
  "step5",
  "step6",
  "step7",
  "step8",
  "step9",
  "step10",
  "step11",
  "step12",
  "step13",
  "step14",
  "step15"
];
var clamp01 = (v) => Math.max(0, Math.min(1, v));
Loom.registerModulatorKernel({
  id: "stepseq",
  valueAt(m, t, origin) {
    const p = m.params;
    const rate = p?.rate ?? 8;
    const n = Math.max(2, Math.min(16, Math.round(p?.steps ?? 8)));
    const glide = clamp01(p?.glide ?? 0);
    const dt = t - origin;
    const pos = dt <= 0 ? 0 : dt * rate;
    const base = Math.floor(pos);
    const i = base % n;
    const a = clamp01(p?.[STEP_IDS[i]] ?? 0);
    let v = a;
    if (glide > 0) {
      const frac = pos - base;
      const start = 1 - glide;
      if (frac > start) {
        const b = clamp01(p?.[STEP_IDS[(i + 1) % n]] ?? 0);
        v = a + (b - a) * ((frac - start) / glide);
      }
    }
    return (p?.bipolar ?? 0) !== 0 ? v * 2 - 1 : v;
  }
});
