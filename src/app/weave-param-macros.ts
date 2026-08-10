// Space and Motion, landed on real destinations.
//
// `macroParamWrites` says WHAT to write; this decides WHERE, by asking the one
// destination catalogue rather than reaching into the mixer and the modulation
// host directly. That is the whole reason those two macros return writes instead
// of applying themselves: a macro that reached past the catalogue could move
// something nothing else can automate, and then nothing could undo it.
//
// The writes go through `applyAutomationToSession` — the PLAYBACK door, not the
// live-gesture one. The difference is the `engineState` mirror, and a macro must
// not have it: the macro owns the value, so stamping the momentary position of a
// knob into the lane's saved sound is the bug a97d67b closed for envelopes,
// wearing a different hat. The weave's own state is what should persist, and
// that is a separate slice.

import type { AutomationTarget } from '../automation/automation-targets';
import { macroParamWrites, type MacroParamContext } from '../weave/macro-params';

export interface WeaveParamMacroDeps {
  /** The ONE catalogue. Read at apply time, never cached: a lane added or an
   *  insert dropped changes what exists, and a stale list writes to a
   *  destination that is gone. */
  destinations: () => readonly AutomationTarget[];
  /** `AutomationWrites.applyPlaybackUnmountedWrite`: the id parsing, the target
   *  lookup and the denormalisation that already exist, rather than a second
   *  copy of them here.
   *
   *  PLAYBACK semantics on purpose — the value reaches the audio object and
   *  nothing else. The live-gesture door additionally mirrors into
   *  `engineState`, and a macro must not: the macro owns the value, so stamping
   *  its momentary position into the lane's saved sound is the bug a97d67b
   *  closed for envelopes wearing a different hat. */
  write: (
    paramId: string,
    normalised: number,
    ranges: ReadonlyMap<string, { min: number; max: number }>,
  ) => void;
}

/** Which destinations Space and Motion are allowed to move.
 *
 *  Matched on the param id's TAIL rather than on a lane id, because these are
 *  scene-wide: Space wants every lane's reverb send, Motion every LFO depth
 *  there is. Anything the catalogue does not offer simply does not appear, so a
 *  session with no sends is a Space knob that moves nothing rather than an
 *  error.
 */
export function macroTargets(destinations: readonly AutomationTarget[]): MacroParamContext {
  const sends: string[] = [];
  const lfoDepthIds: string[] = [];
  for (const d of destinations) {
    if (d.id.endsWith('.bus.sendA')) sends.push(d.id);
    else if (d.id.endsWith('.bus.sendB')) sends.push(d.id);
    // A modulator depth, whatever its lane and whichever modulator: the id ends
    // in `.depth` for every one of them.
    else if (d.id.endsWith('.depth')) lfoDepthIds.push(d.id);
  }
  return {
    // macroParamWrites takes ONE send per bus; a scene has one per lane. Handing
    // it the first is wrong, so the fan-out happens here instead — see below.
    lfoDepthIds,
  };
}

/** Apply Space and Motion to everything they address, right now.
 *
 *  Called when a macro moves, not per tick: these are param writes, and a param
 *  written sixty times a second with the same value is sixty ramps the smoother
 *  has to chase for nothing. */
export function applyWeaveParamMacros(
  macros: Record<string, number>,
  deps: WeaveParamMacroDeps,
  /** What was applied last time, so a macro returning to its neutral can put
   *  that neutral back once instead of leaving its last effect behind. */
  prev?: Record<string, number>,
): number {
  const all = deps.destinations();
  const ranges = new Map(all.map((d) => [d.id, { min: d.min, max: d.max }] as const));

  let landed = 0;
  const land = (writes: Map<string, number>) => {
    for (const [id, v] of writes) { deps.write(id, v, ranges); landed++; }
  };

  // Space fans out over EVERY lane's sends rather than a single pair: it is a
  // scene macro, and a wash on one lane is not what "space" means.
  for (const d of all) {
    const isSendA = d.id.endsWith('.bus.sendA');
    const isSendB = d.id.endsWith('.bus.sendB');
    if (!isSendA && !isSendB) continue;
    land(macroParamWrites(macros, {
      sendA: isSendA ? d.id : undefined,
      sendB: isSendB ? d.id : undefined,
      lfoDepthIds: [],
    }, prev));
  }

  // Motion takes the depths in one go — macroParamWrites already fans over the
  // list it is given.
  land(macroParamWrites(macros, macroTargets(all), prev));

  return landed;
}

export interface WeaveParamMacros {
  /** Land Space and Motion on everything they address. Returns how many writes
   *  went out, which is what a caller checks when nothing seems to happen. */
  apply(macros: Record<string, number>): number;
}

/** The applier, holding the one thing it has to remember.
 *
 *  A macro that has come home has to say so ONCE, and knowing that means
 *  knowing where it was last time. That could not live in `applyWeaveParamMacros`
 *  without becoming module state — the kind that survives a New Session and
 *  leaks one session's values into the next — so it lives in a closure the
 *  caller owns, next to the weave it belongs to.
 *
 *  The snapshot is a COPY. The macros object is the panel's live one and it
 *  keeps moving; holding it by reference would compare a value against itself
 *  and the trailing edge would never fire. */
export function createWeaveParamMacros(deps: WeaveParamMacroDeps): WeaveParamMacros {
  let last: Record<string, number> | undefined;
  return {
    apply(macros) {
      const landed = applyWeaveParamMacros(macros, deps, last);
      last = { ...macros };
      return landed;
    },
  };
}
