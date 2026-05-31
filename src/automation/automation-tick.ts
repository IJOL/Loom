import { tickSessionEnvelopes } from '../session/session-runtime';
import type { Sequencer } from '../core/sequencer';
import type { KnobHandle } from '../core/knob';
import type { LanePlayState } from '../session/session-runtime';
import type { SynthEngine } from '../engines/engine-types';
import type { ModulationHost, ModulatorVoice } from '../modulation/types';

export interface AutomationTickDeps {
  seq: Sequencer;
  automationRegistry: Map<string, KnobHandle>;
  getLaneStates: () => Map<string, LanePlayState>;
  ctx: AudioContext;
  getEngineForLane?: (laneId: string) => SynthEngine | undefined;
  getActiveModVoice?: (laneId: string, modId: string) => ModulatorVoice | undefined;
}

function applyModulationToKnobs(deps: AutomationTickDeps): void {
  const reg = deps.automationRegistry;
  for (const [paramId, handle] of reg) {
    if (paramId.includes('.mod.')) continue; // skip modulator's own knobs
    const dotIdx = paramId.indexOf('.');
    if (dotIdx < 0) continue;
    const laneId = paramId.slice(0, dotIdx);
    const localId = paramId.slice(dotIdx + 1);
    const engine = deps.getEngineForLane?.(laneId);
    const host = (engine as { modulators?: ModulationHost } | undefined)?.modulators;
    if (!host) {
      (handle as KnobHandle).setModulationOffset?.(0);
      continue;
    }
    let offset = 0;
    for (const mod of host.modulators) {
      if (!mod.enabled) continue;
      for (const conn of mod.connections) {
        if (conn.paramId !== localId && conn.paramId !== paramId) continue;
        const voice = deps.getActiveModVoice?.(laneId, mod.id);
        if (!voice) continue;
        offset += voice.currentValue() * conn.depth;
      }
    }
    (handle as KnobHandle).setModulationOffset?.(Math.max(-1, Math.min(1, offset)));
  }
}

let autoTickRunning = false;

/** Vestigial Classic accessors — the global automation lanes are gone (their
 *  authoring moved to Performance view). Kept as stubs so the surviving
 *  clip-automation painter (which asks for a playhead index) and the transport
 *  Play handler still compile. */
export function getAutoAbsSubIdx(): number { return 0; }
export function resetAutomationPosition(): void { /* no-op */ }

/** The rAF loop that applies per-clip automation envelopes and per-voice
 *  modulation onto the registered knobs. Session-only. */
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
    applyModulationToKnobs(deps);
  };
  requestAnimationFrame(tick);
}
