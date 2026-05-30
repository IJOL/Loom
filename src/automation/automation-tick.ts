import { AUTOMATION_SUB_RES } from '../core/pattern';
import { clamp01 } from './automation-painter';
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
  redrawAllLanes: () => void;
  trackActiveUntil: Map<string, number>;
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

// Module-level state — exported via getters so callers in main.ts
// can read autoAbsSubIdx without coupling the tick internals.
let autoCurrentSubIdx = 0;
let autoTickRunning = false;
let autoAbsSubIdx = 0;
let autoLoopCount = 0;
let autoPrevPlayPos = 0;

export function getAutoAbsSubIdx(): number { return autoAbsSubIdx; }

export function resetAutomationPosition(): void {
  autoAbsSubIdx = 0;
  autoLoopCount = 0;
  autoPrevPlayPos = 0;
  autoCurrentSubIdx = 0;
}

export function startAutomationTick(deps: AutomationTickDeps): void {
  if (autoTickRunning) return;
  autoTickRunning = true;
  const {
    seq, automationRegistry, getLaneStates, ctx,
    redrawAllLanes, trackActiveUntil,
  } = deps;

  const tick = () => {
    if (!autoTickRunning) return;
    requestAnimationFrame(tick);
    if (!seq.isPlaying()) return;
    const playPos = seq.currentPlayPosition();          // 0 .. pattern.length
    // Detect pattern wrap (playPos jumps backwards) and bump the loop count.
    if (playPos < autoPrevPlayPos - 1) autoLoopCount++;
    autoPrevPlayPos = playPos;
    const patternSubs = seq.length * AUTOMATION_SUB_RES;
    autoAbsSubIdx = autoLoopCount * patternSubs + Math.floor(playPos * AUTOMATION_SUB_RES);
    // For the playhead overlay (within-pattern), just use mod patternSubs.
    const playheadIdx = autoAbsSubIdx % patternSubs;
    if (playheadIdx !== autoCurrentSubIdx) {
      autoCurrentSubIdx = playheadIdx;
      redrawAllLanes();
      // Update activity indicators (track labels pulse when recently triggered)
      const now = performance.now();
      document.querySelectorAll<HTMLElement>('.track-label[data-track-id]').forEach((el) => {
        const id = el.dataset.trackId ?? '';
        const until = trackActiveUntil.get(id) ?? 0;
        el.classList.toggle('triggered', now < until);
      });
    }
    for (const lane of seq.pattern.automation) {
      if (!lane.enabled) continue;
      const entry = automationRegistry.get(lane.paramId);
      if (!entry) continue;
      const laneLen = lane.values.length;
      if (laneLen === 0) continue;
      const idx = autoAbsSubIdx % laneLen;
      const v = lane.values[idx];
      if (v == null) continue;
      const denorm = entry.meta.min + clamp01(v) * (entry.meta.max - entry.meta.min);
      entry.setValue(denorm);
    }
    // App is always session-only.
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
