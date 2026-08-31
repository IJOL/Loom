// plugins/drift/dsp.ts
var hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};
var cell = (seed, i) => {
  let x = Math.imul(seed ^ Math.imul(i | 0, 2654435761), 2246822507);
  x ^= x >>> 13;
  x = Math.imul(x, 3266489909);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967295 * 2 - 1;
};
var smooth = (u) => u * u * (3 - 2 * u);
var lorenzRuns = /* @__PURE__ */ new Map();
var lorenzAt = (seed, steps) => {
  let r = lorenzRuns.get(seed);
  if (!r || r.n > steps) r = { n: 0, x: 1 + seed % 7 * 0.1, y: 1, z: 20 };
  const h = 4e-3;
  for (; r.n < steps; r.n++) {
    const dx = 10 * (r.y - r.x), dy = r.x * (28 - r.z) - r.y, dz = r.x * r.y - 8 / 3 * r.z;
    r.x += dx * h;
    r.y += dy * h;
    r.z += dz * h;
  }
  lorenzRuns.set(seed, r);
  return Math.max(-1, Math.min(1, r.x / 20));
};
Loom.registerModulatorKernel({
  id: "drift",
  valueAt(m, t, origin) {
    const p = m.params;
    const rate = p?.rate ?? 0.5;
    const amount = p?.amount ?? 1;
    const seed = hash(m.id);
    const dt = Math.max(0, t - origin);
    if ((p?.mode ?? 0) !== 0) {
      return lorenzAt(seed, Math.floor(dt * rate * 250)) * amount;
    }
    const pos = dt * rate;
    const i = Math.floor(pos);
    const a = cell(seed, i), b = cell(seed, i + 1);
    return (a + (b - a) * smooth(pos - i)) * amount;
  }
});
