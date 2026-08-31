// plugins/curve/dsp.ts
var MAX_PTS = 16;
var SEED = { pts: 2, p0x: 0, p0y: 1, p0c: 0, p1x: 1, p1y: 0, p1c: 0 };
var shape = (u, c) => c === 0 ? u : Math.pow(u, Math.pow(4, c));
function evalCurve(p, x) {
  const bag = p !== void 0 && (p.pts ?? 0) >= 2 ? p : SEED;
  const n = Math.max(2, Math.min(MAX_PTS, Math.round(bag.pts ?? 2)));
  const cx = Math.max(0, Math.min(1, x));
  for (let i = 0; i < n - 1; i++) {
    const x0 = bag[`p${i}x`] ?? 0, x1 = bag[`p${i + 1}x`] ?? 1;
    if (cx <= x1 || i === n - 2) {
      const y0 = bag[`p${i}y`] ?? 0, y1 = bag[`p${i + 1}y`] ?? 0;
      const c = Math.max(-1, Math.min(1, bag[`p${i}c`] ?? 0));
      const w = x1 - x0;
      const u = w <= 0 ? 1 : Math.max(0, Math.min(1, (cx - x0) / w));
      return y0 + (y1 - y0) * shape(u, c);
    }
  }
  return bag[`p${n - 1}y`] ?? 0;
}
Loom.registerModulatorKernel({
  id: "curve-lfo",
  valueAt(m, t, origin) {
    const p = m.params;
    const rate = p?.rate ?? 1;
    const dt = t - origin;
    const phase = dt <= 0 ? 0 : dt * rate - Math.floor(dt * rate);
    const v = evalCurve(p, phase);
    return (p?.bipolar ?? 0) !== 0 ? v * 2 - 1 : v;
  }
});
Loom.registerModulatorKernel({
  id: "curve-env",
  valueAt(m, t, origin) {
    const p = m.params;
    const dur = Math.max(0.02, p?.duration ?? 1);
    const raw = (t - origin) / dur;
    const pos = (p?.mode ?? 0) !== 0 ? raw - Math.floor(raw) : Math.max(0, Math.min(1, raw));
    return evalCurve(p, pos);
  }
});
export {
  evalCurve
};
