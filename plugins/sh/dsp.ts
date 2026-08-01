// plugins/sh/dsp.ts
// Sample & Hold: latch a new pseudo-random value every 1/rate seconds and hold
// it. PURE by construction — the held value of step n is hash(seed, n), never a
// remembered variable, so the offline render and the live one agree exactly.
const SEED = 0x9e3779b9;

/** Integer hash → -1..+1. A step's value depends only on its index. */
function valueForStep(n: number): number {
  let h = (n ^ SEED) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h / 0xffffffff) * 2 - 1;
}

Loom.registerModulatorKernel({
  id: 'sh',
  valueAt(m, t, origin) {
    const rate = m.params?.rate ?? 4;
    const dt = t - origin;
    const step = dt <= 0 ? 0 : Math.floor(dt * rate);
    const v = valueForStep(step);
    return m.params?.bipolar === 0 ? (v + 1) / 2 : v;
  },
});
