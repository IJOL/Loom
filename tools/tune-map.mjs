// tools/tune-map.mjs
// One mapper for the MELODIC tunes: a committed extraction plus a descriptor of
// which lane each event belongs to. The tunes in this family differ only in how
// their voices are told apart and what plays them, so they get a table rather
// than a module each.
//
// Pure: no I/O, no Strudel, no app imports.

import { TPQ, note, lane, demoSession, envLen, curveEnv, velocityForGain, FULL_VELOCITY } from './strudel-map-common.mjs';

/** Ticks per Strudel cycle. A cycle lasts 1/cps seconds, and a second is
 *  bpm/60 quarters, so this is exact rather than chosen — and it is what makes
 *  the bar count come out an integer when (and only when) the meter is right. */
export const cycleTicksFor = (cps, bpm) => (TPQ * bpm) / (60 * cps);

export const ticksPerBar = (meter) => (meter.num * TPQ * 4) / meter.den;

/**
 * @param haps the extraction: { cycles, cps, events }
 * @param spec {
 *   name, slug, bpm, meter, key?,
 *   voices: [{ id, name, engineId, preset?, color?, params?, match(value), transposeCents? }],
 *   envelopes?: (ctx) => ClipEnvelope[] keyed by voice id
 * }
 */
export function buildTune(haps, spec) {
  const meter = spec.meter ?? { num: 4, den: 4 };
  const cycleTicks = cycleTicksFor(haps.cps, spec.bpm);
  const barTicks = ticksPerBar(meter);
  // A cycle need not be a whole number of ticks — Giant Steps runs 307.2 — so
  // this asks whether the BARS come out whole, and does it against a tolerance.
  // `Number.isInteger` on the float rejected Giant Steps' exact 16 bars over a
  // last-digit error.
  const barsExact = (haps.cycles * TPQ * spec.bpm) / (60 * haps.cps * barTicks);
  const lengthBars = Math.round(barsExact);
  if (Math.abs(barsExact - lengthBars) > 1e-6) {
    throw new Error(`${spec.name}: ${haps.cycles} cycles do not fill whole bars of ${meter.num}/${meter.den} — the meter or the bpm is wrong`);
  }

  const byVoice = new Map(spec.voices.map((v) => [v.id, []]));
  for (const e of haps.events) {
    const v = spec.voices.find((cand) => cand.match(e.value));
    if (!v) continue;
    const start = Math.round(e.begin * cycleTicks);
    // `clip` scales a note's gate against its slot; absent means the whole slot.
    const span = Math.max(1, Math.round((e.end - e.begin) * cycleTicks * (e.value.clip ?? 1)));
    // A drum voice names a PAD; a melodic one carries a pitch. A fractional MIDI
    // note is Strudel detuning a superimposed voice: the pitch rounds here and
    // the cents go on the LANE, so the beating survives.
    // A drum voice names a PAD, a melodic one carries a pitch — and a SAMPLE
    // loop carries neither: Dinofunk's bass is `s('bass').loopAt(8)`, a trigger
    // with no note at all, whose pitch is entirely in `speed`. `midi` is how
    // such a voice says what to play it at.
    const midi = v.pad ? v.pad(e.value) : v.midi ? v.midi(e.value) : Math.round(e.value.note);
    if (midi == null || !Number.isFinite(midi)) continue;
    // Strudel's `gain` is linear amplitude; Loom's velocity curve is affine, so
    // the inverse is the only honest conversion.
    const vel = v.velocity ?? (e.value.gain !== undefined ? velocityForGain(e.value.gain) : FULL_VELOCITY);
    byVoice.get(v.id).push(note(start, v.pad ? Math.min(span, 24) : span, midi, vel));
  }
  for (const list of byVoice.values()) list.sort((a, b) => a.start - b.start || a.midi - b.midi);

  const lanes = spec.voices.map((v) => lane(v.id, v.pad ? 'drums-machine' : v.engineId, v.name, byVoice.get(v.id), lengthBars, {
    preset: v.preset,
    color: v.color,
    // A voice can carry its own insert chain. Orbit needs it: `.orbit(2)` gives
    // the hats a SEPARATE delay from the kick's, which is two chains and not
    // two send levels.
    ...(v.inserts ? { inserts: v.inserts } : {}),
    ...(v.envelopes ? { envelopes: v.envelopes({ cycles: haps.cycles, lengthBars, events: haps.events }) } : {}),
    engineState: v.pad
      ? { kitMode: 'sample', sampler: { keymap: [], drumkitId: v.drumkitId ?? 'dirt' }, params: { ...(v.params ?? {}) } }
      : v.instrumentId
        ? { sampler: { keymap: [], instrumentId: v.instrumentId }, params: { ...(v.params ?? {}) } }
        : { params: { ...(v.params ?? {}) } },
  }));

  return {
    ...demoSession({ name: spec.name, slug: spec.slug, bpm: spec.bpm, key: spec.key ?? 9, lanes }),
    timeSignature: meter,
  };
}

/** Build a clip envelope from a per-event param, sampled at the events that
 *  carry it. Several voices can sound at once, so simultaneous values are
 *  averaged rather than arbitrarily picked.
 *
 *  Between points it INTERPOLATES, because most of these come from a `sine` or
 *  `perlin` that really is continuous. Pass `hold` for the ones that are not:
 *  `delay("<0 .5>")` switches once a cycle, and interpolating that turns a
 *  switch into a slow glide. */
export function paramEnv(paramId, events, pick, toUnit, cycles, lengthBars, { hold = false } = {}) {
  const acc = new Map();
  for (const e of events) {
    const y = pick(e.value);
    if (y === undefined) continue;
    const k = +e.begin.toFixed(5);
    const slot = acc.get(k) ?? { sum: 0, n: 0 };
    slot.sum += y; slot.n++;
    acc.set(k, slot);
  }
  const pts = [...acc].map(([c, s]) => [c, s.sum / s.n]).sort((a, b) => a[0] - b[0]);
  const n = envLen(lengthBars);
  if (!pts.length) return curveEnv(paramId, cycles, lengthBars, () => 0);
  return curveEnv(paramId, cycles, lengthBars, (c) => {
    if (c <= pts[0][0]) return toUnit(pts[0][1]);
    if (c >= pts[pts.length - 1][0]) return toUnit(pts[pts.length - 1][1]);
    let i = 1;
    while (i < pts.length && pts[i][0] < c) i++;
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    if (hold) return toUnit(y0);
    return toUnit(x1 === x0 ? y0 : y0 + (y1 - y0) * ((c - x0) / (x1 - x0)));
  });
  void n;
}

/** Both engines map a normalised cutoff through 60*220^x. */
export const cutoffNorm = (hz) => Math.log(hz / 60) / Math.log(220);
