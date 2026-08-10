// The SOUND fader, landed on the two layer gains.
//
// A lane's weave decides which NOTES play; this decides what they are played
// ON, and the two are independent on purpose. That independence is the point:
// it is what lets loop A be heard on instrument B, and what lets the sound
// evolve while the notes stand still.
//
// The mechanism was already here and pointing the other way. `pickLayers` sends
// a note to EVERY layer whose zone covers it, so a rack with two full-range
// slots already plays every note on both instruments — and the two layer gains
// are ordinary params. What was missing is one control moving them against each
// other, which is this file.
//
// It only works because the lane STOPS tagging its notes with the loop they
// came from. That tag pins a note to one layer, which is the opposite of this;
// the wiring drops it whenever a lane has a sound fader. Either the loop
// chooses the instrument or the fader does, never both.
//
// The writes go through the destination catalogue and the PLAYBACK door, for
// the same reasons Space and Motion do: a write that reached past the catalogue
// could move something nothing else can automate, and the live-gesture door
// would additionally stamp the position into the lane's saved sound. What
// should persist is the weave's own state; the gains are derived from it.

import type { AutomationTarget } from '../automation/automation-targets';
import { soundGains } from '../weave/sound-fade';
import type { WeaveState } from '../weave/weave-state';

export interface WeaveSoundDeps {
  /** The ONE catalogue, read at apply time: a lane added or an engine swapped
   *  changes which gains exist, and a stale list writes to a destination that
   *  is gone. */
  destinations: () => readonly AutomationTarget[];
  write: (
    paramId: string,
    normalised: number,
    ranges: ReadonlyMap<string, { min: number; max: number }>,
  ) => void;
}

/** The two slots the fader balances. Slot 0 and slot 1 rather than "every layer
 *  in the rack": a fader has two ends, and a rack with four filled slots is a
 *  different instrument, not a longer fader. */
const SLOTS = ['l0.gain', 'l1.gain'] as const;

export interface WeaveSound {
  /** Write the gains of every lane that has a sound fader. Returns how many
   *  writes landed, which is what a caller checks when nothing seems to
   *  happen. */
  apply(state: WeaveState): number;
}

/** The applier, holding the one thing it must remember: which lanes had a sound
 *  fader last time.
 *
 *  A lane whose fader is cleared would otherwise keep whatever balance it left,
 *  with no control on screen governing it and no way to tell why one instrument
 *  had gone quiet. Putting both gains back to unity once is the same trailing
 *  edge Space needed, and for the same reason: an effect you cannot leave is
 *  worse than one you never had.
 */
export function createWeaveSound(deps: WeaveSoundDeps): WeaveSound {
  let fading = new Set<string>();

  return {
    apply(state) {
      const all = deps.destinations();
      const ranges = new Map(all.map((d) => [d.id, { min: d.min, max: d.max }] as const));
      const known = new Set(all.map((d) => d.id));
      let landed = 0;

      const put = (laneId: string, values: readonly number[]) => {
        SLOTS.forEach((slot, i) => {
          const id = `${laneId}.${slot}`;
          // A lane that is not a LAYERS lane has no such destination. Skipping
          // is the honest answer: a sound fader on an ordinary lane simply does
          // nothing, rather than erroring or inventing a param.
          if (!known.has(id)) return;
          deps.write(id, values[i], ranges);
          landed++;
        });
      };

      const now = new Set<string>();
      for (const [laneId, sel] of Object.entries(state.lanes)) {
        // Absent is not zero: absent means this lane has no fader and routes by
        // loop instead, so writing gains for it would fight that routing.
        if (sel?.sound === undefined) continue;
        now.add(laneId);
        const { a, b } = soundGains(sel.sound);
        put(laneId, [a, b]);
      }

      // The trailing edge: lanes that had a fader and no longer do get both
      // layers back at unity, once.
      for (const laneId of fading) if (!now.has(laneId)) put(laneId, [1, 1]);
      fading = now;

      return landed;
    },
  };
}
