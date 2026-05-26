// Per-step audio dispatch for Session mode.
// Called once per 16th-note step from the look-ahead scheduler in session-runtime.
// Routes each clip step to the appropriate trigger function.

import type { DrumMachine, DrumVoice } from '../core/drums';
import type { PolySynth } from '../polysynth/polysynth';
import type { SynthEngine } from '../engines/engine-types';
import type { ChannelStrip } from '../core/fx';
import type { SessionClip, SessionState } from './session';
import { TICKS_PER_STEP } from '../core/notes';
import { arp } from '../arp/arp-ui';
import { scheduleArpForNote } from '../arp/arp';

export interface StepSchedulerDeps {
  ctx: AudioContext;
  state: SessionState;
  drums: DrumMachine;
  drumLanes: readonly DrumVoice[];
  bpm: () => number;
  bassTriggerDirect: (note: number, time: number, dur: number, accent: boolean, slidingIn: boolean) => void;
  bassTriggerForArp: (note: number, time: number, gate: number, accent: boolean) => void;
  polyTriggerDirect: (note: number, time: number, gate: number, accent: boolean) => void;
  markTrackActive: (trackId: string, time: number) => void;
  ensureExtraPoly: (id: string) => PolySynth;
  extraStrips: Partial<Record<string, ChannelStrip>>;
  getLaneEngineId: (laneId: string) => string;
  ensureLaneEngine: (laneId: string, engineId: string) => SynthEngine | null;
}

export function scheduleClipStep(
  deps: StepSchedulerDeps,
  laneId: string,
  clip: SessionClip,
  stepInClip: number,
  stepTime: number,
  stepDur: number,
): void {
  const { state, drums, drumLanes, bassTriggerDirect, bassTriggerForArp,
          polyTriggerDirect, markTrackActive, ensureExtraPoly, extraStrips,
          getLaneEngineId, ensureLaneEngine, ctx, bpm } = deps;

  const lane = state.lanes.find((l) => l.id === laneId);
  if (!lane) return;

  const arpEnabled = arp.enabled && arp.scope.includes(laneId);

  // BASS (303)
  if (lane.kind === 'bass') {
    if (clip.bassMode === 'piano' && clip.bassNotes) {
      const stepStartTick = stepInClip * TICKS_PER_STEP;
      const stepEndTick   = stepStartTick + TICKS_PER_STEP;
      const tickToSec     = stepDur / TICKS_PER_STEP;
      for (const n of clip.bassNotes) {
        if (n.start < stepStartTick || n.start >= stepEndTick) continue;
        const offsetSec = (n.start - stepStartTick) * tickToSec;
        const durSec = Math.max(0.01, n.duration * tickToSec);
        const accent = n.velocity >= 100;
        if (arpEnabled) {
          scheduleArpForNote(bassTriggerForArp, arp, bpm(), n.midi, stepTime + offsetSec, durSec, accent);
        } else {
          const slidingIn = clip.bassNotes.some((m) =>
            m !== n && m.start < n.start && (m.start + m.duration) > n.start + 1);
          bassTriggerDirect(n.midi, stepTime + offsetSec, durSec, accent, slidingIn);
        }
      }
    } else if (clip.bassSteps) {
      const s = clip.bassSteps[stepInClip];
      if (!s || !s.on) return;
      const prev = clip.bassSteps[(stepInClip - 1 + clip.bassSteps.length) % clip.bassSteps.length];
      const slidingIn = !!(prev && prev.on && prev.slide);
      const dur = (s.slide ? stepDur * 1.5 : stepDur * 0.92);
      if (arpEnabled) {
        scheduleArpForNote(bassTriggerForArp, arp, bpm(), s.note, stepTime, dur, s.accent);
      } else {
        bassTriggerDirect(s.note, stepTime, dur, s.accent, slidingIn);
      }
    }
    markTrackActive('bass', stepTime);
    return;
  }

  // DRUMS (collapsed bus)
  if (lane.kind === 'drum-bus' && clip.drumSteps) {
    for (const drumLane of drumLanes) {
      const arr = clip.drumSteps[drumLane];
      if (!arr) continue;
      const s = arr[stepInClip];
      if (!s || !s.on) continue;
      const div = s.roll && s.roll > 1 ? s.roll : 1;
      if (div === 1) {
        drums.trigger(drumLane, stepTime, s.accent);
      } else {
        const subDur = stepDur / div;
        for (let r = 0; r < div; r++) drums.trigger(drumLane, stepTime + r * subDur, s.accent);
      }
    }
    markTrackActive('drumBus', stepTime);
    return;
  }

  // DRUMS (expanded single lane)
  if (lane.kind === 'drum-lane' && clip.drumLane && clip.drumLaneSteps) {
    const s = clip.drumLaneSteps[stepInClip];
    if (!s || !s.on) return;
    const div = s.roll && s.roll > 1 ? s.roll : 1;
    if (div === 1) drums.trigger(clip.drumLane, stepTime, s.accent);
    else {
      const subDur = stepDur / div;
      for (let r = 0; r < div; r++) drums.trigger(clip.drumLane, stepTime + r * subDur, s.accent);
    }
    markTrackActive(clip.drumLane, stepTime);
    return;
  }

  // POLY (main + extras)
  if (lane.kind === 'poly') {
    const isMain = laneId === 'main';
    const triggerFor = (n: number, t: number, g: number, a: boolean) => {
      if (isMain) {
        polyTriggerDirect(n, t, g, a);
      } else {
        const engineId = getLaneEngineId(laneId);
        if (engineId === 'subtractive') ensureExtraPoly(laneId).trigger(n, t, g, a);
        else {
          const inst = ensureLaneEngine(laneId, engineId);
          if (inst) {
            const voice = inst.createVoice(ctx, extraStrips[laneId]!.input);
            voice.trigger(n, t, { gateDuration: g, accent: a });
          } else ensureExtraPoly(laneId).trigger(n, t, g, a);
        }
      }
    };
    const triggerOrArp = (n: number, t: number, g: number, a: boolean) => {
      if (arpEnabled) scheduleArpForNote(triggerFor, arp, bpm(), n, t, g, a);
      else triggerFor(n, t, g, a);
    };

    if (clip.polyMode === 'piano' && clip.polyNotes) {
      const stepStartTick = stepInClip * TICKS_PER_STEP;
      const stepEndTick   = stepStartTick + TICKS_PER_STEP;
      const tickToSec     = stepDur / TICKS_PER_STEP;
      for (const n of clip.polyNotes) {
        if (n.start < stepStartTick || n.start >= stepEndTick) continue;
        const offsetSec = (n.start - stepStartTick) * tickToSec;
        const durSec = Math.max(0.01, n.duration * tickToSec);
        const accent = n.velocity >= 100;
        triggerOrArp(n.midi, stepTime + offsetSec, durSec, accent);
      }
    } else if (clip.polySteps) {
      const s = clip.polySteps[stepInClip];
      if (!s || !s.on || s.notes.length === 0) return;
      const gate = s.tie ? stepDur * 1.6 : stepDur * 0.9;
      for (const midi of s.notes) triggerOrArp(midi, stepTime, gate, s.accent);
    }
    markTrackActive(laneId, stepTime);
  }
}
