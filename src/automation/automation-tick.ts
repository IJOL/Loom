import { AUTOMATION_SUB_RES } from '../core/pattern';
import { clamp01 } from './automation-painter';
import { tickSessionEnvelopes } from '../session/session-runtime';
import type { Sequencer } from '../core/sequencer';
import type { KnobHandle } from '../core/knob';
import type { LanePlayState } from '../session/session-runtime';
import type { AppMode } from '../main';

export interface AutomationTickDeps {
  seq: Sequencer;
  automationRegistry: Map<string, KnobHandle>;
  getAppMode: () => AppMode;
  getLaneStates: () => Map<string, LanePlayState>;
  ctx: AudioContext;
  redrawAllLanes: () => void;
  trackActiveUntil: Map<string, number>;
}

// Module-level state — exported via getters so recordAutomationValue in main.ts
// can read autoAbsSubIdx without coupling the tick internals.
let autoCurrentSubIdx = 0;
let autoTickRunning = false;
let autoAbsSubIdx = 0;
let autoLoopCount = 0;
let autoPrevPlayPos = 0;

export function getAutoAbsSubIdx(): number { return autoAbsSubIdx; }
export function getAutoCurrentSubIdx(): number { return autoCurrentSubIdx; }

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
    seq, automationRegistry, getAppMode, getLaneStates, ctx,
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
    if (getAppMode() === 'session') {
      tickSessionEnvelopes(getLaneStates(), ctx.currentTime, seq.bpm, (paramId, normalised) => {
        const k = automationRegistry.get(paramId);
        if (!k) return;
        const range = k.meta.max - k.meta.min;
        k.setValue(k.meta.min + normalised * range);
      });
    }
  };
  requestAnimationFrame(tick);
}
