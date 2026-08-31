// plugins/drift/dsp.ts
// Analog-style life: value noise ("drift") or a normalised Lorenz walk
// ("chaos"). PURE — no Math.random at render time (the Karplus lesson):
// drift hashes integer cell indices, chaos integrates deterministically from
// a seeded start, both keyed off the instance id so two Drifts differ.

const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

/** Deterministic -1..+1 for an integer cell of one instance. */
const cell = (seed: number, i: number): number => {
  let x = Math.imul(seed ^ Math.imul(i | 0, 0x9e3779b1), 0x85ebca6b);
  x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16;
  return ((x >>> 0) / 0xffffffff) * 2 - 1;
};

const smooth = (u: number): number => u * u * (3 - 2 * u);

/** Lorenz x-coordinate after walking from a seeded start for `steps` steps.
 *  The walk is RESUMED per seed, never recomputed — cost stays O(steps since
 *  last call) and asking for an earlier time restarts from the seed (offline
 *  render + live render then agree exactly). */
const lorenzRuns = new Map<number, { n: number; x: number; y: number; z: number }>();
const lorenzAt = (seed: number, steps: number): number => {
  let r = lorenzRuns.get(seed);
  if (!r || r.n > steps) r = { n: 0, x: 1 + (seed % 7) * 0.1, y: 1, z: 20 };
  const h = 0.004; // integration step; small enough to stay stable
  for (; r.n < steps; r.n++) {
    const dx = 10 * (r.y - r.x), dy = r.x * (28 - r.z) - r.y, dz = r.x * r.y - (8 / 3) * r.z;
    r.x += dx * h; r.y += dy * h; r.z += dz * h;
  }
  lorenzRuns.set(seed, r);
  return Math.max(-1, Math.min(1, r.x / 20));
};

Loom.registerModulatorKernel({
  id: 'drift',
  valueAt(m, t, origin) {
    const p = m.params;
    const rate = p?.rate ?? 0.5;
    const amount = p?.amount ?? 1;
    const seed = hash(m.id);
    const dt = Math.max(0, t - origin);
    if ((p?.mode ?? 0) !== 0) {
      // ~250 integration steps per second of musical time, scaled by rate.
      return lorenzAt(seed, Math.floor(dt * rate * 250)) * amount;
    }
    const pos = dt * rate;
    const i = Math.floor(pos);
    const a = cell(seed, i), b = cell(seed, i + 1);
    return (a + (b - a) * smooth(pos - i)) * amount;
  },
});

// A module, not a global script.
export {};
