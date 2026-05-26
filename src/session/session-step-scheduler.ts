// Per-step audio dispatch for Session mode.
// Called once per 16th-note step from the look-ahead scheduler in session-runtime.
// Routes each clip step to the appropriate trigger function.

import type { DrumMachine, DrumVoice } from '../core/drums';
import type { PolySynth } from '../polysynth/polysynth';
import type { SynthEngine } from '../engines/engine-types';
import type { ChannelStrip } from '../core/fx';
import type { SessionClip, SessionState } from './session';
import { TICKS_PER_STEP } from '../core/notes';
import type { NoteEvent } from '../core/notes';
import { arp } from '../arp/arp-ui';
import { scheduleArpForNote } from '../arp/arp';
import { GM_DRUM_MAP } from '../engines/drum-gm-map';

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
  ensureLaneVoice: (laneId: string, engineId: string) => import('../engines/engine-types').Voice | null;
}

export function scheduleClipStep(
  deps: StepSchedulerDeps,
  laneId: string,
  clip: SessionClip,
  stepInClip: number,
  stepTime: number,
  stepDur: number,
): void {
  const { state, markTrackActive } = deps;
  const lane = state.lanes.find((l) => l.id === laneId);
  if (!lane || !clip.notes) return;

  const stepStartTick = stepInClip * TICKS_PER_STEP;
  const stepEndTick   = stepStartTick + TICKS_PER_STEP;
  const tickToSec     = stepDur / TICKS_PER_STEP;

  for (const n of clip.notes) {
    if (n.start < stepStartTick || n.start >= stepEndTick) continue;
    const offsetSec = (n.start - stepStartTick) * tickToSec;
    const durSec    = Math.max(0.01, n.duration * tickToSec);
    const accent    = n.velocity >= 100;
    routeNoteToEngine(deps, lane.engineId, laneId, n.midi, stepTime + offsetSec, durSec, accent, clip.notes, n);
  }
  markTrackActive(lane.id, stepTime);
}

function routeNoteToEngine(
  deps: StepSchedulerDeps,
  engineId: string,
  laneId: string,
  midi: number,
  time: number,
  gate: number,
  accent: boolean,
  allNotes: NoteEvent[],
  thisNote: NoteEvent,
): void {
  const { ctx, bassTriggerDirect, bassTriggerForArp, polyTriggerDirect, drums,
          ensureExtraPoly, extraStrips, getLaneEngineId, ensureLaneEngine } = deps;
  const arpEnabled = arp.enabled && arp.scope.includes(laneId);

  // Extra lanes (bass2, drums2, etc.) route through the engine's own voice.
  // Built-in singletons (laneId === 'bass' / 'drums' / 'main') keep their
  // existing direct triggers because Classic still uses them.
  const isBuiltinLane = laneId === 'bass' || laneId === 'drums' || laneId === 'main';
  if (!isBuiltinLane) {
    const voice = deps.ensureLaneVoice(laneId, engineId);
    if (!voice) return;
    const slidingIn = engineId === 'tb303' &&
      allNotes.some((m) => m !== thisNote && m.start < thisNote.start &&
                            (m.start + m.duration) > thisNote.start + 1);
    voice.trigger(midi, time, { gateDuration: gate, accent, slide: slidingIn });
    return;
  }

  if (engineId === 'tb303') {
    const slidingIn = allNotes.some((m) => m !== thisNote && m.start < thisNote.start &&
                                            (m.start + m.duration) > thisNote.start + 1);
    if (arpEnabled) scheduleArpForNote(bassTriggerForArp, arp, deps.bpm(), midi, time, gate, accent);
    else            bassTriggerDirect(midi, time, gate, accent, slidingIn);
    return;
  }
  if (engineId === 'drums-machine') {
    const voice = GM_DRUM_MAP[midi];
    if (voice) drums.trigger(voice, time, accent);
    return;
  }
  // Poly engines (subtractive/wavetable/fm/karplus)
  const isMain = laneId === 'main';
  const fire = (n: number, t: number, g: number, a: boolean) => {
    if (isMain) {
      polyTriggerDirect(n, t, g, a);
    } else {
      const engId = getLaneEngineId(laneId);
      if (engId === 'subtractive') ensureExtraPoly(laneId).trigger(n, t, g, a);
      else {
        const inst = ensureLaneEngine(laneId, engId);
        if (inst) {
          const voice = inst.createVoice(ctx, extraStrips[laneId]!.input);
          voice.trigger(n, t, { gateDuration: g, accent: a });
        } else ensureExtraPoly(laneId).trigger(n, t, g, a);
      }
    }
  };
  if (arpEnabled) scheduleArpForNote(fire, arp, deps.bpm(), midi, time, gate, accent);
  else            fire(midi, time, gate, accent);
}
