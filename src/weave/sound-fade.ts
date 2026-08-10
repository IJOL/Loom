// MORPH: one loop, two instruments, one fader.
//
// The other three topologies cross between LOOPS — different material, and the
// dial decides which of it you hear. This one crosses between SOUNDS: the lane
// plays its own clip, unchanged, and the dial moves the balance between the two
// instruments in its rack.
//
// It needs no routing machinery, because the machinery is already there and
// pointing the other way. `pickLayers` sends a note to EVERY layer whose zone
// covers it, so two full-range layers means every note sounds on both — and the
// two layer gains are ordinary params. What was missing was one control that
// moves them against each other, and that is all this file is.
//
// The one thing it must NOT do is tag its notes with a layer index. That tag is
// how the loop-crossing topologies say "this note came from loop B, play it on
// instrument B", and it makes `pickLayers` return a single layer — which is the
// exact opposite of what morphing wants. The two mechanisms share a door and
// use it for opposite ends, so a morphing lane goes through neither: it hands
// the scheduler nothing and lets the lane play its clip.
//
// Pure: a number in, two numbers out.

export interface SoundState {
  /** 0 is entirely the first instrument, 1 entirely the second. */
  x: number;
}

export interface SoundGains {
  /** Layer 0's gain, 0..1. */
  a: number;
  /** Layer 1's gain, 0..1. */
  b: number;
}

/** The two layer gains for a morph position, at CONSTANT POWER.
 *
 *  Sine and cosine rather than `x` and `1 - x`, because two gains that sum to 1
 *  do not sum to the same LOUDNESS: uncorrelated sounds add by power, so a
 *  linear pair dips about 3 dB in the middle and the morph reads as a hole
 *  half way across rather than as a handover. Squares that sum to 1 keep the
 *  level flat all the way over, which is the whole reason this is the standard
 *  shape for a crossfade.
 *
 *  The ends are exact: at 0 the second instrument is silent and at 1 the first
 *  is, so a morph parked at either end sounds exactly like that instrument on
 *  its own rather than like it with something inaudible underneath. */
export function soundGains(x: number): SoundGains {
  const t = Math.min(1, Math.max(0, x));
  // cos/sin of a quarter turn. Snapped at the ends because cos(π/2) leaves a
  // float crumb — around 6e-17, silent but not silence, and "why is layer 0
  // still in the mix" is not a question worth anyone's afternoon.
  if (t === 0) return { a: 1, b: 0 };
  if (t === 1) return { a: 0, b: 1 };
  const angle = t * (Math.PI / 2);
  return { a: Math.cos(angle), b: Math.sin(angle) };
}
