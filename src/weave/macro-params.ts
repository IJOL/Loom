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

export function macroParamWrites(
  macros: Record<string, number>, ctx: MacroParamContext,
): Map<string, number> {
  const out = new Map<string, number>();

  const space = read(macros, 'space');
  if (space !== macroNeutral('space')) {
    if (ctx.sendA) out.set(ctx.sendA, clamp01(space));
    // The second bus gets less, so the two sends do not read as one control
    // with two labels. 0.7 keeps it audible without doubling the wash.
    if (ctx.sendB) out.set(ctx.sendB, clamp01(space * 0.7));
  }

  const motion = read(macros, 'motion');
  if (motion !== macroNeutral('motion')) {
    for (const id of ctx.lfoDepthIds) out.set(id, clamp01(motion));
  }

  return out;
}
