import { tickSessionEnvelopes } from '../session/session-runtime';
import type { Sequencer } from '../core/sequencer';
import type { KnobHandle } from '../core/knob';
import type { LanePlayState } from '../session/session-runtime';

export interface AutomationTickDeps {
  seq: Sequencer;
  automationRegistry: Map<string, KnobHandle>;
  getLaneStates: () => Map<string, LanePlayState>;
  ctx: AudioContext;
}

let autoTickRunning = false;

/** Vestigial Classic accessors — the global automation lanes are gone (their
 *  authoring moved to Performance view). Kept as stubs so the surviving
 *  clip-automation painter (which asks for a playhead index) and the transport
 *  Play handler still compile. */
export function getAutoAbsSubIdx(): number { return 0; }
export function resetAutomationPosition(): void { /* no-op */ }

/** The rAF loop that applies per-clip automation envelopes onto the registered
 *  knobs. Session-only. (In-worklet LFO/ADSR modulation no longer drives the
 *  knob-ring overlay from the main thread — it runs per-sample in the worklet.) */
export function startAutomationTick(deps: AutomationTickDeps): void {
  if (autoTickRunning) return;
  autoTickRunning = true;
  const { seq, automationRegistry, getLaneStates, ctx } = deps;

  const tick = () => {
    if (!autoTickRunning) return;
    requestAnimationFrame(tick);
    if (!seq.isPlaying()) return;
    tickSessionEnvelopes(getLaneStates(), ctx.currentTime, seq.bpm, (paramId, normalised) => {
      const k = automationRegistry.get(paramId);
      if (!k) return;
      const range = k.meta.max - k.meta.min;
      k.setValue(k.meta.min + normalised * range);
    });
  };
  requestAnimationFrame(tick);
}
