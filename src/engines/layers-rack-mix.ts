// The rack's MIX control: one gesture that balances the instruments a LAYERS
// lane is holding, instead of four faders you move against each other by hand.
//
// It owns no state. The gains — `l0.gain`..`l3.gain` — are ordinary params and
// stay the single truth: they save, they automate, they undo, and the WEAVE
// sound pad writes the same ones. This file is the arithmetic in both
// directions, so the control can WRITE them from a position and READ its own
// position back off them. A second stored copy of the balance would be a second
// owner, and the two would drift the moment a knob was touched by hand.
//
// The shape of the control follows what is loaded, and only what is loaded. An
// empty slot makes no sound, so it gets no share of the gesture and is never
// written to.
//
// Pure: no DOM, no engine, no session.

import type { LayerSpec } from '../audio-dsp/layers/layer-spec';
import { soundGains } from '../weave/sound-fade';

export type MixShape = 'none' | 'chain' | 'square';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Which slots hold an instrument, in slot order.
 *
 *  Indices rather than the slots themselves, because every caller needs to name
 *  the param (`l2.gain`) rather than to read the spec — and because the gap
 *  matters: a rack holding slots 1 and 3 crosses between those two, and the
 *  empty slot 2 in the middle is not a stop along the way. */
export function loadedSlots(rack: readonly LayerSpec[]): number[] {
  const out: number[] = [];
  rack.forEach((l, i) => { if (l.engineId !== '') out.push(i); });
  return out;
}

/** What the control looks like for this many loaded slots.
 *
 *  A fader up to three, a square at four. The square is not a bigger fader: a
 *  chain of four puts the first and last instrument at opposite ends of one
 *  journey, so the pair you most want to hear together is the pair you can
 *  never reach. Two axes give every combination, which is why the cloud
 *  topology and the WEAVE sound pad are squares too — and this reuses their
 *  arithmetic so a hand that has learnt one corner finds it in the same place.
 *
 *  Fewer than two is 'none': there is nothing to balance a single instrument
 *  against, and a fader with one end is a knob that does nothing. */
export function mixShape(loaded: readonly number[]): MixShape {
  if (loaded.length < 2) return 'none';
  return loaded.length === 4 ? 'square' : 'chain';
}

/** The gains along a chain of `n` slots, at CONSTANT POWER.
 *
 *  The position walks neighbour to neighbour: at 0 the first slot has it all, at
 *  1 the last, and the stops in between are the slots themselves — with three
 *  loaded, 0.5 is the middle instrument alone. Only ever two slots sound at
 *  once, which is what makes a three-slot fader a journey rather than a mush.
 *
 *  Square roots for the same reason `soundGains` takes them: uncorrelated
 *  sounds add by POWER, so gains that sum to one do not sum to the same
 *  loudness and a linear crossfade dips about 3 dB in the middle. Squaring to
 *  one keeps the level flat all the way across.
 *
 *  The ends are exact. At a stop every other gain is a true 0, so a fader parked
 *  on an instrument plays that instrument and not that instrument with a float
 *  crumb underneath it. */
export function chainGains(pos: number, n: number): number[] {
  const out = new Array<number>(n).fill(0);
  if (n <= 0) return out;
  if (n === 1) { out[0] = 1; return out; }
  const t = clamp01(pos) * (n - 1);
  // The last stop lands exactly on the final slot rather than one past the end.
  const k = Math.min(n - 2, Math.floor(t));
  const f = t - k;
  out[k] = Math.sqrt(1 - f);
  out[k + 1] = Math.sqrt(f);
  return out;
}

/** Where on the chain a set of gains sits — the exact inverse of `chainGains`.
 *
 *  The centre of mass in POWER, which is the same number for anything the fader
 *  itself wrote (a two-slot crossfade at `f` has mass `f` of the way along by
 *  construction) and a fair reading of anything it did not. That second half is
 *  why it is a centre of mass rather than a search for the sounding pair: the
 *  slot gains are ordinary knobs, so a user can leave three of them up, and the
 *  fader has to come back showing something honest instead of jumping.
 *
 *  A silent rack has no position at all; it reports the near end rather than
 *  NaN, because a fader drawn from NaN is a fader with no handle. */
export function chainPosition(gains: readonly number[]): number {
  const n = gains.length;
  if (n < 2) return 0;
  let mass = 0;
  let weighted = 0;
  gains.forEach((g, i) => {
    const w = g * g;
    mass += w;
    weighted += w * i;
  });
  return mass > 0 ? clamp01(weighted / mass / (n - 1)) : 0;
}

/** Where in the square a set of four gains sits — the inverse of `soundGains`.
 *
 *  Its corner order, and therefore the cloud's: top-left, top-right,
 *  bottom-left, bottom-right. The bilinear weights sum to one, so each axis is
 *  just the mass on its far side — `x` is what the right-hand column holds, `y`
 *  what the bottom row does — and normalising by the total makes that reading
 *  survive gains the pad did not write.
 *
 *  Silent parks in the near corner, for the same reason the chain parks at its
 *  near end. */
export function squarePosition(gains: readonly number[]): { x: number; y: number } {
  const w = [0, 1, 2, 3].map((i) => (gains[i] ?? 0) ** 2);
  const mass = w[0] + w[1] + w[2] + w[3];
  if (mass <= 0) return { x: 0, y: 0 };
  return {
    x: clamp01((w[1] + w[3]) / mass),
    y: clamp01((w[2] + w[3]) / mass),
  };
}

/** The gains this control writes, aligned with `loaded`.
 *
 *  One door for both shapes so a caller never has to ask which arithmetic it is
 *  holding — it hands over the position it has and gets back one number per
 *  loaded slot, in the same order. The square ignores `pos` and the chain
 *  ignores `y`, which is exactly the difference between the two controls. */
export function mixGains(loaded: readonly number[], pos: number, y: number): number[] {
  return mixShape(loaded) === 'square' ? soundGains(pos, y) : chainGains(pos, loaded.length);
}
