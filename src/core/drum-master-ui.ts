import type { ChannelStrip } from './fx';
import { createKnob, type KnobHandle } from './knob';

export interface DrumMasterUIDeps {
  drumBusStrip: ChannelStrip;
  registerKnob: (k: KnobHandle) => void;
  fmtPct: (v: number) => string;
  fmtDb: (v: number) => string;
}

const fmtPan = (v: number) => v === 0 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`;

export function wireDrumMasterUI(deps: DrumMasterUIDeps): void {
  const { drumBusStrip, registerKnob, fmtPct, fmtDb } = deps;
  const row = document.getElementById('drum-master-knobs') as HTMLDivElement;
  const SIZE = 42;
  const state = drumBusStrip.serialize();
  const mk = (opts: Parameters<typeof createKnob>[0]) => {
    const k = createKnob({ ...opts, size: SIZE });
    row.appendChild(k.el);
    registerKnob(k);
  };
  mk({ id: 'mix.drumBus.level', min: 0, max: 1.5, step: 0.01, value: state.level, defaultValue: 1,
    label: 'DRUM VOL', color: '#f7d000', format: fmtPct, onChange: (v) => drumBusStrip.setLevel(v) });
  mk({ id: 'mix.drumBus.pan', min: -1, max: 1, step: 0.01, value: state.pan ?? 0, defaultValue: 0,
    label: 'PAN', color: '#e67e22', format: fmtPan, onChange: (v) => drumBusStrip.setPan(v) });
  mk({ id: 'mix.drumBus.rev', min: 0, max: 1, step: 0.01, value: state.reverbSend, defaultValue: 0,
    label: 'REV', color: '#9b59b6', format: fmtPct, onChange: (v) => drumBusStrip.setReverbSend(v) });
  mk({ id: 'mix.drumBus.dly', min: 0, max: 1, step: 0.01, value: state.delaySend, defaultValue: 0,
    label: 'DLY', color: '#3498db', format: fmtPct, onChange: (v) => drumBusStrip.setDelaySend(v) });
  mk({ id: 'mix.drumBus.eqlow', min: -18, max: 18, step: 0.5, value: state.eqLow, defaultValue: 0,
    label: 'LO',  color: '#c0392b', format: fmtDb, onChange: (v) => drumBusStrip.setEqLow(v) });
  mk({ id: 'mix.drumBus.eqmid', min: -18, max: 18, step: 0.5, value: state.eqMid, defaultValue: 0,
    label: 'MID', color: '#f7d000', format: fmtDb, onChange: (v) => drumBusStrip.setEqMid(v) });
  mk({ id: 'mix.drumBus.eqhi', min: -18, max: 18, step: 0.5, value: state.eqHigh, defaultValue: 0,
    label: 'HI',  color: '#2ee0c0', format: fmtDb, onChange: (v) => drumBusStrip.setEqHigh(v) });
}
