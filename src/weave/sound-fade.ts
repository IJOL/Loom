// MORPH: one loop, four instruments, one pad.
//
// The other topologies cross between LOOPS — different material, and the control
// decides which of it you hear. This one crosses between SOUNDS: the lane plays
// what it plays, and the pad moves the balance between the instruments in its
// rack.
//
// It needs no routing machinery, because the machinery is already there and
// pointing the other way. `pickLayers` sends a note to EVERY layer whose zone
// covers it, so four full-range layers means every note sounds on all of them —
// and the four layer gains are ordinary params. What was missing was one control
// that moves them against each other, and that is all this file is.
//
// The one thing it must NOT do is tag its notes with a layer index. That tag is
// how the loop-crossing topologies say "this note came from loop B, play it on
// instrument B", and it makes `pickLayers` return a single layer — which is the
// exact opposite of what morphing wants. The two mechanisms share a door and use
// it for opposite ends, so a morphing lane goes through neither: it hands the
// scheduler nothing and lets the lane play its clip.
//
// Pure: two numbers in, four numbers out.

export interface SoundState {
  /** 0 is entirely the left-hand pair, 1 the right-hand pair. */
  x: number;
  /** 0 is entirely the top pair, 1 the bottom pair. */
  y: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** The four layer gains for a morph position, at CONSTANT POWER.
 *
 *  The corner order is the CLOUD's — top-left, top-right, bottom-left,
 *  bottom-right — because the two controls are the same square and a user
 *  dragging one after the other must not find the corners in a different place.
 *
 *  Square roots of the bilinear weights, and the square root is the whole point.
 *  Uncorrelated sounds add by POWER, so gains that sum to one do not sum to the
 *  same loudness: a linear pad dips about 3 dB in the middle and the morph reads
 *  as a hole rather than as a handover. The bilinear weights already sum to one,
 *  so taking their roots makes the SQUARES sum to one — level all the way across,
 *  which is why this is the standard shape for a crossfade.
 *
 *  The corners are exact without a snap: at a corner every weight is an exact 0
 *  or 1, so a pad parked at one sounds like that instrument alone rather than
 *  like it with a float crumb underneath.
 *
 *  `y` defaults to 0, which is the top edge — a two-slot rack is the same square
 *  with nothing on its bottom half, so the fader it used to be is still in here
 *  unchanged. */
export function soundGains(x: number, y = 0): number[] {
  const u = clamp01(x);
  const v = clamp01(y);
  return [
    (1 - u) * (1 - v),
    u * (1 - v),
    (1 - u) * v,
    u * v,
  ].map(Math.sqrt);
}
