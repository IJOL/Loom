// plugins/gate/main.ts — a noise gate: below the threshold, the signal is held
// down; above it, it passes. What it IS lives in plugin.json.
//
// It shares the SDK's envelope follower with the auto-wah — two independent
// plugins depending on one published primitive, which is what a shared SDK is
// for.
//
// The gating curve is a WaveShaper on the CONTROL signal, not on the audio.
// The follower produces roughly 0..1; this maps that to the gain the audio
// should get: near `range` below the threshold, near 1 above it, with a short
// ramp between so the gate does not click as it crosses. Doing it as a curve
// rather than per-sample logic is what keeps the whole thing native nodes.
//
// `range` is how far DOWN a closed gate goes, in dB. -60 is effectively shut;
// -12 is a gentle duck that keeps the room tone. It is not a threshold and not
// a ratio.
import { createEnvelopeFollower, type FxInstance } from '@loom/plugin-sdk';

// The table is indexed by a LINEAR amplitude, while the threshold knob is in
// dB — so the bottom of the knob is where the resolution runs out, not the top.
// At the original 1025 points a step was 0.00195, and the knob's own minimum of
// -60 dB is 0.001 linear: every threshold below about -54 dB landed on the same
// grid point, and the knee (a tenth of the threshold) was narrower than one step
// from -40 dB down, degenerating into the hard step it exists to prevent — the
// click. 4097 puts a step at 0.000488, so -60 dB is a couple of steps rather
// than none, at 16 KB per rebuild instead of 4.
const CURVE_POINTS = 4097;
const CURVE_STEP = 2 / (CURVE_POINTS - 1);

/** Map the follower's 0..1 reading to a gain multiplier.
 *  `thrLin` is the threshold as a linear amplitude; `floor` the closed gain. */
function gateCurve(thrLin: number, floor: number): Float32Array {
  const c = new Float32Array(CURVE_POINTS);
  // A soft knee either side of the threshold, one tenth of it wide, so the
  // gate opens over a few samples instead of stepping — a hard step in a gain
  // is a click. Floored in CURVE STEPS rather than in amplitude: a knee the
  // table cannot represent is not a knee.
  const knee = Math.max(2 * CURVE_STEP, thrLin * 0.1);
  for (let i = 0; i < CURVE_POINTS; i++) {
    // The shaper's input domain is -1..1; the follower only produces >= 0, so
    // the lower half is unreachable and mirrors the upper.
    const x = Math.abs((i * 2) / (CURVE_POINTS - 1) - 1);
    const t = Math.min(1, Math.max(0, (x - (thrLin - knee)) / (2 * knee)));
    c[i] = floor + (1 - floor) * t;
  }
  return c;
}

const dbToLin = (db: number) => Math.pow(10, db / 20);

Loom.registerFx('gate', (ctx): FxInstance => {
  const input  = ctx.createGain();
  const output = ctx.createGain();

  // The VCA the gate opens and closes. Its own value is 0 so the control
  // signal IS the gain.
  const vca = ctx.createGain();
  vca.gain.value = 0;
  input.connect(vca).connect(output);

  const follower = createEnvelopeFollower(ctx, { attackMs: 2, releaseMs: 150 });
  input.connect(follower.input);

  let threshold = -30, range = -60, attack = 2, release = 150;

  // A WaveShaper's curve cannot always be reassigned (node-web-audio-api throws
  // "cannot assign curve twice"), so a threshold or range change swaps in a
  // fresh one — the pattern the bitcrusher and the distortion already use.
  let shaper = ctx.createWaveShaper();
  const buildShaper = () => {
    const next = ctx.createWaveShaper();
    next.curve = gateCurve(dbToLin(threshold), dbToLin(range)) as Float32Array<ArrayBuffer>;
    next.oversample = 'none';               // shaping a control signal, not audio
    follower.output.connect(next); next.connect(vca.gain);
    try { follower.output.disconnect(shaper); shaper.disconnect(); } catch { /* first build */ }
    shaper = next;
  };
  buildShaper();

  return {
    input, output,
    getAudioParams: () => new Map<string, AudioParam>(),
    getBaseValue: (id) =>
      id === 'threshold' ? threshold : id === 'range' ? range
      : id === 'attack' ? attack : id === 'release' ? release : 0,
    setBaseValue: (id, v) => {
      if (id === 'threshold') { if (v !== threshold) { threshold = v; buildShaper(); } }
      if (id === 'range')     { if (v !== range)     { range = v;     buildShaper(); } }
      if (id === 'attack')    { attack = v; follower.setAttack(v); }
      if (id === 'release')   { release = v; follower.setRelease(v); }
    },
    applyPreset: () => {},
    dispose: () => {
      follower.dispose();
      for (const n of [input, output, vca, shaper]) {
        try { n.disconnect(); } catch { /* ok */ }
      }
    },
  };
});
