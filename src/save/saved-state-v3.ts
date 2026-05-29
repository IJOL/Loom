import type { Sequencer } from '../core/sequencer';
import type { TB303, Wave } from '../core/synth';
import type { DrumMachine } from '../core/drums';
import type { SessionHost } from '../session/session-host';
import type { SessionState } from '../session/session';

export interface SavedStateV3 {
  schemaVersion: 3;
  bpm: number;
  swing: number;
  masterVol: number;
  kit: string;
  wave: Wave;
  synthParams: TB303['params'];
  sessionState: SessionState;
}

export interface SavedStateV3Deps {
  seq: Sequencer;
  synth: TB303;
  drums: DrumMachine;
  volInput: HTMLInputElement;
  bpmInput: HTMLInputElement;
  swingInput: HTMLInputElement;
  kitSel: HTMLSelectElement;
  waveSel: HTMLSelectElement;
  sessionHost: SessionHost;
  refreshKnobsFromSynth: () => void;
  renderLanes: () => void;
  fx: import('../core/fx').FxBus;
  filterChain: import('../core/fx').FilterChain;
  master: GainNode;
}

export function buildSavedStateV3(deps: SavedStateV3Deps): SavedStateV3 {
  const { seq, synth, drums, volInput, sessionHost } = deps;
  return {
    schemaVersion: 3,
    bpm: seq.bpm,
    swing: seq.swing,
    masterVol: parseFloat(volInput.value),
    kit: drums.kitId,
    wave: synth.params.wave,
    synthParams: { ...synth.params },
    sessionState: sessionHost.getStateForSave(),
  };
}

export function applyLoadedStateV3(s: SavedStateV3, deps: SavedStateV3Deps): void {
  const {
    seq, synth, drums, volInput, bpmInput, swingInput, kitSel, waveSel,
    sessionHost, refreshKnobsFromSynth, renderLanes, fx, filterChain, master,
  } = deps;

  if (typeof s.bpm === 'number') { seq.bpm = s.bpm; bpmInput.value = String(s.bpm); }
  if (typeof s.swing === 'number') { seq.swing = s.swing; swingInput.value = String(s.swing); }
  if (typeof s.masterVol === 'number') { master.gain.value = s.masterVol; volInput.value = String(s.masterVol); }
  if (typeof s.kit === 'string') { drums.setKit(s.kit); kitSel.value = s.kit; }
  if (s.wave) { synth.params.wave = s.wave; waveSel.value = String(s.wave); }
  if (s.synthParams) synth.params = { ...synth.params, ...s.synthParams };
  if (s.sessionState) sessionHost.applyLoadedSessionState(s.sessionState);
  refreshKnobsFromSynth();
  renderLanes();
  fx.setBpmSync(seq.bpm);
  filterChain.updateBpm(seq.bpm);
}

/** Runtime guard: untrusted JSON (file load, localStorage) → typed shape or null. */
export function parseSavedStateV3(raw: unknown): SavedStateV3 | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.schemaVersion !== 3) return null;
  return r as unknown as SavedStateV3;
}
