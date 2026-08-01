// plugins/sh/dsp.ts
var SEED = 2654435769;
function valueForStep(n) {
  let h = (n ^ SEED) >>> 0;
  h = Math.imul(h ^ h >>> 16, 73244475) >>> 0;
  h = Math.imul(h ^ h >>> 16, 73244475) >>> 0;
  h = (h ^ h >>> 16) >>> 0;
  return h / 4294967295 * 2 - 1;
}
Loom.registerModulatorKernel({
  id: "sh",
  valueAt(m, t, origin) {
    const rate = m.params?.rate ?? 4;
    const dt = t - origin;
    const step = dt <= 0 ? 0 : Math.floor(dt * rate);
    const v = valueForStep(step);
    return m.params?.bipolar === 0 ? (v + 1) / 2 : v;
  }
});
