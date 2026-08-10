// Space and Motion, expressed as writes onto destinations that already exist.
//
// This function touches no audio: it says WHAT to write and the runtime decides
// when. That is what makes the mapping testable with no AudioContext at all,
// and it is also what keeps the macro layer honest -- a macro cannot reach past
// the destination catalogue into something that is not automatable.
//
// Darkness is deliberately absent. It moves the global scale and the preset
// choice, which are session state rather than automation destinations, so it
// lives in style-mix.ts next to the style draw.

import { macroNeutral } from './weave-catalog';

export interface MacroParamContext {
  /** Destination ids for the two global sends, when the session has them. */
  sendA?: string;
  sendB?: string;
  /** Every LFO depth the session currently exposes. */
  lfoDepthIds: string[];
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Reads a macro, falling back to its neutral. A save from an older version
 *  simply has no key for a macro added since, and `undefined` would travel
 *  straight into the arithmetic as NaN. */
const read = (macros: Record<string, number>, id: string) =>
  Number.isFinite(macros[id]) ? macros[id] : macroNeutral(id);

/** Whether a macro has anything to say this time round.
 *
 *  Off its neutral, obviously. But also on the way BACK to it, exactly once —
 *  and that second half is the whole of a reported bug: Space wrote its sends
 *  on the way up and wrote nothing at zero, so returning the knob left the wash
 *  exactly where the last non-zero position had put it. A macro you cannot undo
 *  is worse than a macro that does not exist.
 *
 *  Writing the neutral value unconditionally would fix that and break something
 *  better: with all six at their neutral the layer is the IDENTITY, and a panel
 *  merely opened would zero every send a user had set by hand at the desk.
 *
 *  The trailing edge is both. Silent until the macro is touched, one write when
 *  it comes home, silent again after. `prev` undefined means nothing has been
 *  applied yet — a first call cannot be a return to anywhere. */
const speaks = (
  macros: Record<string, number>, prev: Record<string, number> | undefined, id: string,
): boolean => {
  const neutral = macroNeutral(id);
  return read(macros, id) !== neutral || (!!prev && read(prev, id) !== neutral);
};

export function macroParamWrites(
  macros: Record<string, number>,
  ctx: MacroParamContext,
  /** What was applied last time, so a macro can put its neutral back once. */
  prev?: Record<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();

  if (speaks(macros, prev, 'space')) {
    // SQUARED, not linear. A send is a level, and a level moved linearly puts
    // almost all of its audible range in the first quarter of the knob: the
    // first nudge already flooded the scene and the rest of the travel did
    // very little, which is a control that only has one useful position.
    // Squaring buys back the bottom half — reported as the macro being unusable
    // rather than merely strong.
    const space = clamp01(read(macros, 'space'));
    const send = space * space;
    if (ctx.sendA) out.set(ctx.sendA, send);
    // The second bus gets less, so the two sends do not read as one control
    // with two labels. 0.7 keeps it audible without doubling the wash.
    if (ctx.sendB) out.set(ctx.sendB, send * 0.7);
  }

  if (speaks(macros, prev, 'motion')) {
    const motion = read(macros, 'motion');
    for (const id of ctx.lfoDepthIds) out.set(id, clamp01(motion));
  }

  return out;
}
