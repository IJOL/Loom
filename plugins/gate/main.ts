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
// `hold` is the fourth time control and the one that stops a gate stuttering. A
// snare does not decay smoothly, it wobbles: it crosses back under the threshold
// for a few milliseconds, comes back over, drops again. Without hold the gate
// slams on each wobble and the tail machine-guns. With it, once open the gate
// stays open for at least that long whatever the level does.
//
// It reads like a timer, which is why this was first delivered WITHOUT it, on
// the grounds that a timer means per-sample code and an insert is native nodes.
// That was wrong twice over. "Stay open for N ms after the signal drops" is not
// a timer at all — it is `max(level now, level N ms ago)`, delaying a signal is
// a DelayNode, and the max is the same primitive the follower already uses to
// tell attack from release. Nothing detects a crossing, because nothing needs to.
import { createEnvelopeFollower, createSignalMax, type FxInstance } from '@loom/plugin-sdk';

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

  // The held envelope: the larger of the follower now and the follower `hold`
  // seconds ago. On the way UP the delayed copy is behind, so the max is the
  // live one and the attack is untouched; on the way DOWN the delayed copy sits
  // at the pre-drop level until the hold has elapsed, and only then does the
  // release start. At hold 0 the delay is a pass-through and max(x, x) is x, so
  // the whole stage costs nothing when it is switched off.
  const HOLD_MAX_SEC = 1;
  const holdDelay = ctx.createDelay(HOLD_MAX_SEC);
  const held = createSignalMax(ctx);
  follower.output.connect(held.a);
  follower.output.connect(holdDelay).connect(held.b);

  // Kept in step with plugin.json's `default` for hold — a fresh instance must
  // sound like the manifest says it does.
  let threshold = -30, range = -60, attack = 2, hold = 20, release = 150;
  holdDelay.delayTime.value = hold / 1000;

  // A WaveShaper's curve cannot always be reassigned (node-web-audio-api throws
  // "cannot assign curve twice"), so a threshold or range change swaps in a
  // fresh one — the pattern the bitcrusher and the distortion already use.
  let shaper = ctx.createWaveShaper();
  const buildShaper = () => {
    const next = ctx.createWaveShaper();
    next.curve = gateCurve(dbToLin(threshold), dbToLin(range)) as Float32Array<ArrayBuffer>;
    next.oversample = 'none';               // shaping a control signal, not audio
    // Fed from the HELD envelope, not the raw follower — hold has to happen
    // before the threshold decision, or it would be holding the gain open after
    // the gate had already decided to close.
    held.output.connect(next); next.connect(vca.gain);
    // Each disconnect gets its own try. Sharing one means that if the first
    // throws, the old shaper is never disconnected and BOTH curves stay wired to
    // the gain — which is the mechanism behind the bitcrusher's intermittent red
    // (see the spec), and this is the same pattern.
    try { held.output.disconnect(shaper); } catch { /* first build */ }
    try { shaper.disconnect(); } catch { /* first build */ }
    shaper = next;
  };
  buildShaper();

  return {
    input, output,
    getAudioParams: () => new Map<string, AudioParam>(),
    getBaseValue: (id) =>
      id === 'threshold' ? threshold : id === 'range' ? range
      : id === 'attack' ? attack : id === 'hold' ? hold
      : id === 'release' ? release : 0,
    setBaseValue: (id, v) => {
      if (id === 'threshold') { if (v !== threshold) { threshold = v; buildShaper(); } }
      if (id === 'range')     { if (v !== range)     { range = v;     buildShaper(); } }
      if (id === 'attack')    { attack = v; follower.setAttack(v); }
      if (id === 'hold')      { hold = v; holdDelay.delayTime.value = Math.min(HOLD_MAX_SEC, v / 1000); }
      if (id === 'release')   { release = v; follower.setRelease(v); }
    },
    applyPreset: () => {},
    dispose: () => {
      follower.dispose();
      held.dispose();
      for (const n of [input, output, vca, holdDelay, shaper]) {
        try { n.disconnect(); } catch { /* ok */ }
      }
    },
  };
});
