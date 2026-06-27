import { tickSessionEnvelopes } from '../session/session-runtime';
import type { Sequencer } from '../core/sequencer';
import type { KnobHandle } from '../core/knob';
import type { LanePlayState } from '../session/session-runtime';
import type { SynthEngine } from '../engines/engine-types';

export interface AutomationTickDeps {
  seq: Sequencer;
  automationRegistry: Map<string, KnobHandle>;
  getLaneStates: () => Map<string, LanePlayState>;
  ctx: AudioContext;
  /** Resolve a lane's live engine so the modulation overlay can read the REAL
   *  modulation the worklet reports (engine.getLiveModOffset). Optional — when
   *  absent the rings just stay cleared. */
  getEngineForLane?: (laneId: string) => SynthEngine | undefined;
}

let autoTickRunning = false;

/** Vestigial Classic accessors — the global automation lanes are gone (their
 *  authoring moved to Performance view). Kept as stubs so the surviving
 *  clip-automation painter (which asks for a playhead index) and the transport
 *  Play handler still compile. */
export function getAutoAbsSubIdx(): number { return 0; }
export function resetAutomationPosition(): void { /* no-op */ }

/** Paint the amber modulation ring on every target knob from the REAL modulation
 *  the worklet reports (engine.getLiveModOffset, normalised -1..1). This is the
 *  modulation OVERLAY — it does NOT change the base value; automation (setValue
 *  below) is what moves the knob itself. Runs every frame, playing or not, since
 *  a free-running LFO modulates even when the transport is stopped. A knob with
 *  no active modulation gets offset 0 (ring hidden). */
function applyModulationRings(deps: AutomationTickDeps): void {
  const getEngine = deps.getEngineForLane;
  if (!getEngine) return;
  for (const [paramId, handle] of deps.automationRegistry) {
    if (paramId.includes('.mod.')) continue;   // a modulator's own config knobs aren't targets
    const dot = paramId.indexOf('.');
    if (dot < 0) continue;
    const laneId = paramId.slice(0, dot);
    const localId = paramId.slice(dot + 1);
    const engine = getEngine(laneId) as { getLiveModOffset?: (id: string) => number } | undefined;
    handle.setModulationOffset?.(engine?.getLiveModOffset?.(localId) ?? 0);
  }
}

/** The rAF loop. Two distinct overlays on the registered knobs:
 *  - modulation rings (amber arc) follow the worklet's live offsets EVERY frame;
 *  - per-clip automation envelopes move the knob VALUE while playing. */
export function startAutomationTick(deps: AutomationTickDeps): void {
  if (autoTickRunning) return;
  autoTickRunning = true;
  const { seq, automationRegistry, getLaneStates, ctx } = deps;

  const tick = () => {
    if (!autoTickRunning) return;
    requestAnimationFrame(tick);
    applyModulationRings(deps);          // modulation overlay — always (free LFO runs when stopped)
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
