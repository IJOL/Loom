// What the host hands a panel plugin when it mounts.
//
// A panel's code is compiled separately and cannot import ours, so this object
// is its ONLY way in. Every method here is a promise the host has to keep
// across versions, which is why it stays small: what WEAVE genuinely needs and
// nothing speculative.

import type { PanelContext, PanelLane } from '@loom/plugin-sdk';
import type { SessionHost } from '../session/session-host';
import type { Sequencer } from '../core/sequencer';
import { ticksPerBar } from '../core/meter';
import { TICKS_PER_QUARTER } from '../core/notes';
import { macroNeutral } from '../weave/weave-catalog';
import type { WeaveState } from '../weave/weave-state';

export interface PanelContextDeps {
  sessionHost: SessionHost;
  seq: Sequencer;
  /** The audio clock. Passed in rather than read off the sequencer, whose own
   *  context is private — and it is the right clock anyway: an animation driven
   *  by the audio time cannot drift away from what is sounding. */
  ctx: AudioContext;
  weave: WeaveState;
  /** Called after a macro moves, so the host can re-derive whatever depends on
   *  it (the live layer, the destination values). */
  onMacroChanged?: (id: string, value: number) => void;
  /** Re-render the panel. Supplied by whoever mounted it. */
  refresh: () => void;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function createPanelContext(deps: PanelContextDeps): PanelContext {
  return {
    lanes(): PanelLane[] {
      // A flat, serialisable summary. Handing the real lane objects over would
      // let a plugin mutate the session behind the host's back.
      return deps.sessionHost.state.lanes.map((l) => ({
        id: l.id,
        name: l.name || l.id,
        engineId: l.engineId,
        presetId: l.enginePresetName,
      }));
    },

    macro(id) {
      const v = deps.weave.macros[id];
      return Number.isFinite(v) ? v : macroNeutral(id);
    },

    setMacro(id, value) {
      const v = clamp01(value);
      deps.weave.macros[id] = v;
      deps.onMacroChanged?.(id, v);
    },

    refresh: deps.refresh,

    barPhase() {
      if (!deps.seq.isPlaying()) return -1;
      const bar = ticksPerBar(deps.seq.meter);
      const secPerTick = (60 / deps.seq.bpm) / TICKS_PER_QUARTER;
      const barSec = bar * secPerTick;
      // Derived from the audio clock rather than from a UI timer, so the
      // animation cannot drift away from what is actually sounding.
      const t = deps.ctx.currentTime;
      return barSec > 0 ? (((t % barSec) + barSec) % barSec) / barSec : 0;
    },

    isPlaying() {
      return deps.seq.isPlaying();
    },
  };
}
