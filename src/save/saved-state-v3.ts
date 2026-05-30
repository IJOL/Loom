import type { Sequencer } from '../core/sequencer';
import type { Wave } from '../core/synth';
import type { SessionHost } from '../session/session-host';
import type { SessionState } from '../session/session';
import type { LaneAllocator } from '../app/lane-allocator';
import { LANE_ID_BASS, LANE_ID_DRUMS } from '../core/lane-ids';
import type { TB303Engine } from '../engines/tb303';
import type { DrumsEngine } from '../engines/drums-engine';

export interface SavedStateV3 {
  schemaVersion: 3;
  bpm: number;
  swing: number;
  masterVol: number;
  kit: string;
  wave: Wave;
  synthParams: import('../core/synth').TB303['params'];
  sessionState: SessionState;
}

// Phase G: SavedStateV3Deps no longer holds direct synth/drums/polysynth
// references. Lane resources are resolved from lanes.resources at save/load
// time, after applyLoadedSessionState has allocated the boot lanes.
export interface SavedStateV3Deps {
  seq: Sequencer;
  lanes: LaneAllocator;
  volInput: HTMLInputElement;
  bpmInput: HTMLInputElement;
  swingInput: HTMLInputElement;
  kitSel: HTMLSelectElement;
  waveSel: HTMLSelectElement;
  sessionHost: SessionHost;
  refreshKnobsFromSynth: () => void;
  renderLanes: () => void;
  fx: import('../core/fx').FxBus;
  masterInsertChain: import('../plugins/fx/insert-chain').InsertChain;
  master: GainNode;
}

/** Resolve the TB303 instance from the bass lane (null before first allocation). */
function getSynth(deps: SavedStateV3Deps) {
  const engine = deps.lanes.resources.get(LANE_ID_BASS)?.engine;
  return (engine as TB303Engine | undefined)?.getInstance?.() ?? null;
}

/** Resolve the DrumMachine instance from the drums lane (null before first allocation). */
function getDrums(deps: SavedStateV3Deps) {
  const engine = deps.lanes.resources.get(LANE_ID_DRUMS)?.engine;
  return (engine as DrumsEngine | undefined)?.getInstance?.() ?? null;
}

export function buildSavedStateV3(deps: SavedStateV3Deps): SavedStateV3 {
  const { seq, volInput, sessionHost } = deps;
  const synth = getSynth(deps);
  const drums = getDrums(deps);
  return {
    schemaVersion: 3,
    bpm: seq.bpm,
    swing: seq.swing,
    masterVol: parseFloat(volInput.value),
    kit: drums?.kitId ?? 'default',
    wave: synth?.params.wave ?? 'sawtooth',
    synthParams: synth?.params ? { ...synth.params } : {} as import('../core/synth').TB303['params'],
    sessionState: sessionHost.getStateForSave(),
  };
}

export function applyLoadedStateV3(s: SavedStateV3, deps: SavedStateV3Deps): void {
  const {
    seq, volInput, bpmInput, swingInput, kitSel, waveSel,
    sessionHost, refreshKnobsFromSynth, renderLanes, fx, master,
  } = deps;

  if (typeof s.bpm === 'number') { seq.bpm = s.bpm; bpmInput.value = String(s.bpm); }
  if (typeof s.swing === 'number') { seq.swing = s.swing; swingInput.value = String(s.swing); }
  if (typeof s.masterVol === 'number') { master.gain.value = s.masterVol; volInput.value = String(s.masterVol); }

  // Session state is applied first so lane resources are allocated before
  // we try to get synth/drums instances from them.
  if (s.sessionState) sessionHost.applyLoadedSessionState(s.sessionState);

  const synth = getSynth(deps);
  const drums = getDrums(deps);

  if (typeof s.kit === 'string') {
    if (drums) { drums.setKit(s.kit); }
    kitSel.value = s.kit;
  }
  if (s.wave) {
    if (synth) { synth.params.wave = s.wave; }
    waveSel.value = String(s.wave);
  }
  if (s.synthParams && synth) synth.params = { ...synth.params, ...s.synthParams };

  refreshKnobsFromSynth();
  renderLanes();
  fx.setBpmSync(seq.bpm);
  // TODO: serialize masterInsertChain (Task 28)
}

/** Runtime guard: untrusted JSON (file load, localStorage) → typed shape or null. */
export function parseSavedStateV3(raw: unknown): SavedStateV3 | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.schemaVersion !== 3) return null;
  return r as unknown as SavedStateV3;
}
