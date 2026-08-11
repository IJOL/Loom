// tools/strudel-map-common.mjs
// What every Strudel-port mapper needs. Each port turns a committed extraction
// (tools/data/<name>-haps.json) into a DemoSession; only the lane layout and the
// param mapping differ, so the grid, the envelope builders, the velocity maths
// and the session shell live here.
//
// Pure: no I/O, no Strudel, no app imports.

export const TPQ = 96;
export const BAR = TPQ * 4;   // 384
export const SUB_RES = 16;    // AUTOMATION_SUB_RES

/** Envelope length for a clip, in values. */
export const envLen = (lengthBars) => lengthBars * 16 * SUB_RES;

export const note = (start, duration, midi, velocity) => ({ start, duration, midi, velocity });
export const env = (paramId, values) => ({ paramId, values, enabled: true, stepped: false });

// ── Velocity ────────────────────────────────────────────────────────────────
// Loom's curve is AFFINE — velGain01(v) = 0.3 + 1.1*(v/127) — so an amplitude
// RATIO is never a velocity ratio, and a velocity of 0 is not silence. Every
// port needs the inverse, not a guess.
//
// Full gain maps to 99 rather than 100 on purpose: at 100 a note becomes an
// ACCENT, which multiplies amplitude again by ACCENT_PUNCH and would put a step
// in the middle of a curve the original varies smoothly.
export const FULL_VELOCITY = 99;
const gainOf = (v) => 0.3 + 1.1 * (v / 127);
export const FULL_GAIN = gainOf(FULL_VELOCITY);

/** The velocity whose amplitude is `ratio` times a full-gain note's. Clamped to
 *  stay below the accent threshold — a gain above ~1.2x cannot be expressed as
 *  velocity and belongs on the lane or pad level instead. */
export function velocityForGain(ratio) {
  const v = Math.round(127 * ((ratio * FULL_GAIN) - 0.3) / 1.1);
  return Math.max(1, Math.min(FULL_VELOCITY, v));
}

// ── Envelopes ───────────────────────────────────────────────────────────────

/** Sample `f(cycle)` onto the envelope grid. `cycles` is the clip's span in
 *  Strudel cycles, so the caller thinks in the patch's own units. */
export function curveEnv(paramId, paramIdCycles, lengthBars, f) {
  const n = envLen(lengthBars);
  const values = new Array(n);
  for (let i = 0; i < n; i++) values[i] = +clamp01(f((i / n) * paramIdCycles)).toFixed(6);
  return env(paramId, values);
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** Strudel's `sine` runs 0..1 and starts at its MIDPOINT; `slow(n)` makes one
 *  period every n cycles. */
export function sineEnv(paramId, cycles, lengthBars, cyclesPerPeriod, lo, hi) {
  return curveEnv(paramId, cycles, lengthBars, (c) => {
    const unit = (Math.sin(2 * Math.PI * (c / cyclesPerPeriod)) + 1) / 2;
    return lo + unit * (hi - lo);
  });
}

/** A per-cycle alternation, e.g. Strudel's "<0 .2>". */
export function alternateEnv(paramId, cycles, lengthBars, perCycle) {
  return curveEnv(paramId, cycles, lengthBars, (c) => perCycle[Math.floor(c) % perCycle.length]);
}

/** Piecewise-linear through (cycle, value) samples, held flat past the ends.
 *  This is how a per-EVENT param that varies smoothly (a perlin cutoff, say)
 *  becomes a clip envelope: interpolating the values the engine actually
 *  produced beats re-deriving the signal and getting its phase wrong. */
export function pointsEnv(paramId, cycles, lengthBars, points, toUnit) {
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  return curveEnv(paramId, cycles, lengthBars, (c) => {
    if (!pts.length) return 0;
    if (c <= pts[0][0]) return toUnit(pts[0][1]);
    if (c >= pts[pts.length - 1][0]) return toUnit(pts[pts.length - 1][1]);
    let i = 1;
    while (i < pts.length && pts[i][0] < c) i++;
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const t = x1 === x0 ? 0 : (c - x0) / (x1 - x0);
    return toUnit(y0 + (y1 - y0) * t);
  });
}

// ── Session shell ───────────────────────────────────────────────────────────

export const COLORS = ['#a8c8e8', '#a8e0d8', '#d8e8a8', '#f4c8a8', '#c8a8e0', '#f4b8b8'];

export const lane = (id, engineId, name, notes, lengthBars, opts = {}) => ({
  id, engineId, name,
  inserts: opts.inserts ?? [],
  clips: [{
    id, name, color: opts.color ?? COLORS[0], gridResolution: '1/16',
    lengthBars, notes,
    ...(opts.envelopes ? { envelopes: opts.envelopes } : {}),
  }],
  ...(opts.preset ? { enginePresetName: opts.preset } : {}),
  ...(opts.engineState ? { engineState: opts.engineState } : {}),
});

const defaultSends = (slug) => [
  { id: 'A', label: 'Send A (Delay)',  returnLevel: 1, muted: false, inserts: [{ id: `${slug}-send-a`, pluginId: 'delay',  params: {}, bypass: false }] },
  { id: 'B', label: 'Send B (Reverb)', returnLevel: 1, muted: false, inserts: [{ id: `${slug}-send-b`, pluginId: 'reverb', params: {}, bypass: false }] },
];

/** One scene launching slot 0 of every lane — one Play = the whole piece, which
 *  is the standing demo convention. */
export function demoSession({ name, slug, bpm, key = 9, scale = 'minor', lanes }) {
  return {
    bpm, name, lanes,
    scenes: [{
      id: 'scene-1', name,
      clipPerLane: Object.fromEntries(lanes.map((l) => [l.id, 0])),
    }],
    globalQuantize: '1/1',
    musicality: { key, scale, style: 'acid-techno', lock: false },
    sends: defaultSends(slug),
    masterInserts: [],
  };
}
