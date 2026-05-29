// Reusable mixer column builder.
//
// Used by:
//   - The horizontal Classic mixer panel (one column per active track)
//   - The Session view column strips (one column per session lane)
//
// Both call buildMixerColumn(trackId, deps) to construct identical DOM with
// the real knob instances (no cloning). The knobs are registered into the
// caller-provided automation registry via deps.registerKnob.

import type { ChannelStrip } from './fx';
import { createKnob, type KnobHandle } from './knob';
import { attachKnobUndo, type HistoryDeps } from '../save/history-wiring';

const fmtPct = (v: number) => `${Math.round(v * 100)}%`;
const fmtDb  = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
const fmtPan = (v: number) =>
  v === 0 ? 'C' : (v > 0 ? `R${Math.round(v * 100)}` : `L${Math.round(-v * 100)}`);

export interface MixerColumnDeps {
  stripFor:      (trackId: string) => ChannelStrip;
  label:         (trackId: string) => string;
  muteState:     Record<string, boolean>;
  soloState:     Record<string, boolean>;
  applyMuteSolo: () => void;
  registerKnob:  (k: KnobHandle) => void;
  /** Optional undo history deps. When present, knob drags/wheel/dblclick
   *  are bracketed as single undo entries. */
  historyDeps?:  HistoryDeps;
}

interface KnobOpts {
  id?: string;
  label?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  defaultValue?: number;
  color?: string;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}

function addKnob(parent: HTMLElement, deps: MixerColumnDeps, opts: KnobOpts): void {
  const undoHooks = deps.historyDeps ? attachKnobUndo(deps.historyDeps) : {};
  const k = createKnob({ ...opts, size: 28, ...undoHooks });
  parent.appendChild(k.el);
  deps.registerKnob(k);
}

export function buildMixerColumn(trackId: string, deps: MixerColumnDeps): HTMLElement {
  const strip = deps.stripFor(trackId);
  const state = strip.serialize();
  const col = document.createElement('div');
  col.className = `mix-col ${trackId}`;

  // Name header
  const name = document.createElement('div');
  name.className = 'mix-name';
  name.textContent = deps.label(trackId);
  col.appendChild(name);

  // EQ (HI / MID / LO)
  const eqSec = document.createElement('div');
  eqSec.className = 'mix-section';
  const eqLab = document.createElement('div');
  eqLab.className = 'mix-sec-label';
  eqLab.textContent = 'EQ';
  eqSec.appendChild(eqLab);
  addKnob(eqSec, deps, {
    id: `mix.${trackId}.eqhi`,  label: 'HI',  min: -18, max: 18, step: 0.5,
    value: state.eqHigh, defaultValue: 0, color: '#2ee0c0', format: fmtDb,
    onChange: (v) => strip.setEqHigh(v),
  });
  addKnob(eqSec, deps, {
    id: `mix.${trackId}.eqmid`, label: 'MID', min: -18, max: 18, step: 0.5,
    value: state.eqMid,  defaultValue: 0, color: '#f7d000', format: fmtDb,
    onChange: (v) => strip.setEqMid(v),
  });
  addKnob(eqSec, deps, {
    id: `mix.${trackId}.eqlow`, label: 'LO',  min: -18, max: 18, step: 0.5,
    value: state.eqLow,  defaultValue: 0, color: '#c0392b', format: fmtDb,
    onChange: (v) => strip.setEqLow(v),
  });
  col.appendChild(eqSec);

  // Sends
  const sendSec = document.createElement('div');
  sendSec.className = 'mix-section';
  const sendLab = document.createElement('div');
  sendLab.className = 'mix-sec-label';
  sendLab.textContent = 'SEND';
  sendSec.appendChild(sendLab);
  addKnob(sendSec, deps, {
    id: `mix.${trackId}.rev`, label: 'REV', min: 0, max: 1, step: 0.01,
    value: state.reverbSend, defaultValue: 0, color: '#9b59b6', format: fmtPct,
    onChange: (v) => strip.setReverbSend(v),
  });
  addKnob(sendSec, deps, {
    id: `mix.${trackId}.dly`, label: 'DLY', min: 0, max: 1, step: 0.01,
    value: state.delaySend, defaultValue: 0, color: '#3498db', format: fmtPct,
    onChange: (v) => strip.setDelaySend(v),
  });
  col.appendChild(sendSec);

  // Pan
  const panSec = document.createElement('div');
  panSec.className = 'mix-section';
  addKnob(panSec, deps, {
    id: `mix.${trackId}.pan`, label: 'PAN', min: -1, max: 1, step: 0.01,
    value: state.pan ?? 0, defaultValue: 0, color: '#e67e22', format: fmtPan,
    onChange: (v) => strip.setPan(v),
  });
  col.appendChild(panSec);

  // Mute / Solo
  const ms = document.createElement('div');
  ms.className = 'mix-ms';
  const m = document.createElement('button');
  m.className = 'mix-btn mute';
  m.textContent = 'M';
  if (deps.muteState[trackId]) m.classList.add('active');
  m.addEventListener('click', () => {
    deps.muteState[trackId] = !deps.muteState[trackId];
    m.classList.toggle('active', deps.muteState[trackId]);
    deps.applyMuteSolo();
  });
  const s = document.createElement('button');
  s.className = 'mix-btn solo';
  s.textContent = 'S';
  if (deps.soloState[trackId]) s.classList.add('active');
  s.addEventListener('click', () => {
    deps.soloState[trackId] = !deps.soloState[trackId];
    s.classList.toggle('active', deps.soloState[trackId]);
    deps.applyMuteSolo();
  });
  ms.append(m, s);
  col.appendChild(ms);

  // Vertical fader (level)
  const faderWrap = document.createElement('div');
  faderWrap.className = 'mix-fader-wrap';
  const fader = document.createElement('input');
  fader.type = 'range';
  fader.className = 'mix-fader';
  fader.min = '0'; fader.max = '1.5'; fader.step = '0.01';
  fader.value = String(state.level);
  fader.addEventListener('input', () => strip.setLevel(parseFloat(fader.value)));
  faderWrap.appendChild(fader);
  const faderVal = document.createElement('div');
  faderVal.className = 'mix-fader-val';
  const updateFaderText = () => { faderVal.textContent = fmtPct(parseFloat(fader.value)); };
  updateFaderText();
  fader.addEventListener('input', updateFaderText);
  faderWrap.appendChild(faderVal);
  col.appendChild(faderWrap);

  return col;
}
