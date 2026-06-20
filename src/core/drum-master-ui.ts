import type { ChannelStrip } from './fx';
import { createKnob, type KnobHandle } from './knob';
import { attachKnobUndo, type HistoryDeps } from '../save/history-wiring';

export interface DrumMasterUIDeps {
  /** Lane id whose ChannelStrip this UI binds to. Each knob is registered
   *  under `${laneId}.bus.*` so the lane's LFO/ADSR destination dropdown
   *  (filtered by `${laneId}.` prefix) lists them. */
  laneId: string;
  drumBusStrip: ChannelStrip;
  registerKnob: (k: KnobHandle) => void;
  fmtPct: (v: number) => string;
  fmtDb: (v: number) => string;
  /** Optional undo history deps. When present, knob drags/wheel/dblclick
   *  are bracketed as single undo entries. */
  historyDeps?: HistoryDeps;
}

const fmtPan = (v: number) => v === 0 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`;

/**
 * Mount the drum-master strip controls (DRUM VOL / PAN / A / B / LO / MID / HI)
 * for a given drum lane. Idempotent — clears `#drum-master-knobs` before
 * re-populating so switching from drums-1 to drums-2 retargets both the audio
 * destinations and the registry ids.
 *
 * The matching AudioParams are exposed by `DrumsVoice.getAudioParams` (the
 * voice receives the same strip) so the modulation binder can write to the
 * strip's nodes directly.
 */
export function wireDrumMasterUI(deps: DrumMasterUIDeps): void {
  const { laneId, drumBusStrip, registerKnob, fmtPct, fmtDb } = deps;
  const row = document.getElementById('drum-master-knobs') as HTMLDivElement;
  row.innerHTML = '';
  const SIZE = 42;
  const state = drumBusStrip.serialize();
  const undoHooks = deps.historyDeps ? attachKnobUndo(deps.historyDeps) : {};
  const mk = (opts: Parameters<typeof createKnob>[0]) => {
    const k = createKnob({ ...opts, size: SIZE, ...undoHooks });
    row.appendChild(k.el);
    registerKnob(k);
  };
  mk({ id: `${laneId}.bus.level`, min: 0, max: 1.5, step: 0.01, value: state.level, defaultValue: 1,
    label: 'DRUM VOL', color: '#f7d000', format: fmtPct, onChange: (v) => drumBusStrip.setLevel(v) });
  mk({ id: `${laneId}.bus.pan`, min: -1, max: 1, step: 0.01, value: state.pan ?? 0, defaultValue: 0,
    label: 'PAN', color: '#e67e22', format: fmtPan, onChange: (v) => drumBusStrip.setPan(v) });
  mk({ id: `${laneId}.bus.delaySend`, min: 0, max: 1, step: 0.01, value: state.sendA, defaultValue: 0,
    label: 'A', color: '#3498db', format: fmtPct, onChange: (v) => drumBusStrip.setSendA(v) });
  mk({ id: `${laneId}.bus.reverbSend`, min: 0, max: 1, step: 0.01, value: state.sendB, defaultValue: 0,
    label: 'B', color: '#9b59b6', format: fmtPct, onChange: (v) => drumBusStrip.setSendB(v) });
  mk({ id: `${laneId}.bus.eq.low`, min: -18, max: 18, step: 0.5, value: state.eqLow, defaultValue: 0,
    label: 'LO',  color: '#c0392b', format: fmtDb, onChange: (v) => drumBusStrip.setEqLow(v) });
  mk({ id: `${laneId}.bus.eq.mid`, min: -18, max: 18, step: 0.5, value: state.eqMid, defaultValue: 0,
    label: 'MID', color: '#f7d000', format: fmtDb, onChange: (v) => drumBusStrip.setEqMid(v) });
  mk({ id: `${laneId}.bus.eq.high`, min: -18, max: 18, step: 0.5, value: state.eqHigh, defaultValue: 0,
    label: 'HI',  color: '#2ee0c0', format: fmtDb, onChange: (v) => drumBusStrip.setEqHigh(v) });
}
