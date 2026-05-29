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
import { createSelectControl } from './select-control';
import { DEFAULT_SIDECHAIN_STATE } from './comp-state';
import type { CompState, SidechainState } from './comp-state';

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
  sidechainBus:  import('./sidechain-bus').SidechainBus;
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

  col.appendChild(buildCompSection(trackId, strip, deps));
  col.appendChild(buildSidechainSection(trackId, strip, deps));

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
  fader.addEventListener('pointerdown', () => {
    const hd = deps.historyDeps;
    if (hd) hd.history.beginGesture(hd.snapshot());
  });
  fader.addEventListener('pointerup', () => deps.historyDeps?.history.commitGesture());
  fader.addEventListener('focus', () => {
    const hd = deps.historyDeps;
    if (hd) hd.history.beginGesture(hd.snapshot());
  });
  fader.addEventListener('blur', () => deps.historyDeps?.history.commitGesture());
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

const fmtRatio = (v: number) => `${v.toFixed(1)}:1`;

function buildCompSection(
  trackId: string,
  strip: ChannelStrip,
  deps: MixerColumnDeps,
): HTMLElement {
  const sec = document.createElement('div');
  sec.className = 'mix-section mix-comp';
  const lab = document.createElement('div');
  lab.className = 'mix-sec-label';
  lab.textContent = 'COMP';
  sec.appendChild(lab);

  const initial: CompState = strip.getCompState();
  const color = '#1abc9c';

  addKnob(sec, deps, {
    id: `mix.${trackId}.comp.thr`, label: 'THR', min: -60, max: 0, step: 0.5,
    value: initial.threshold, defaultValue: -24, color, format: fmtDb,
    onChange: (v) => strip.setCompState({ threshold: v }),
  });
  addKnob(sec, deps, {
    id: `mix.${trackId}.comp.rat`, label: 'RAT', min: 1, max: 20, step: 0.1,
    value: initial.ratio, defaultValue: 4, color, format: fmtRatio,
    onChange: (v) => strip.setCompState({ ratio: v }),
  });
  addKnob(sec, deps, {
    id: `mix.${trackId}.comp.atk`, label: 'ATK', min: 0.001, max: 1, step: 0.001,
    value: initial.attack, defaultValue: 0.003, color,
    format: (v) => v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`,
    onChange: (v) => strip.setCompState({ attack: v }),
  });
  addKnob(sec, deps, {
    id: `mix.${trackId}.comp.rel`, label: 'REL', min: 0.001, max: 1, step: 0.001,
    value: initial.release, defaultValue: 0.25, color,
    format: (v) => v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`,
    onChange: (v) => strip.setCompState({ release: v }),
  });
  addKnob(sec, deps, {
    id: `mix.${trackId}.comp.knee`, label: 'KNEE', min: 0, max: 40, step: 0.5,
    value: initial.knee, defaultValue: 30, color, format: fmtDb,
    onChange: (v) => strip.setCompState({ knee: v }),
  });
  addKnob(sec, deps, {
    id: `mix.${trackId}.comp.mkup`, label: 'MKUP', min: 0, max: 4, step: 0.01,
    value: initial.makeup, defaultValue: 1, color, format: (v) => `${v.toFixed(2)}×`,
    onChange: (v) => strip.setCompState({ makeup: v }),
  });

  const byp = document.createElement('button');
  byp.className = 'mix-btn comp-bypass';
  byp.textContent = 'BYP';
  byp.classList.toggle('active', initial.bypass);
  byp.addEventListener('click', () => {
    const next = !strip.getCompState().bypass;
    strip.setCompState({ bypass: next });
    byp.classList.toggle('active', next);
  });
  sec.appendChild(byp);

  return sec;
}

function buildSidechainSection(
  trackId: string,
  strip: ChannelStrip,
  deps: MixerColumnDeps,
): HTMLElement {
  const sec = document.createElement('div');
  sec.className = 'mix-section mix-sidechain';
  const lab = document.createElement('div');
  lab.className = 'mix-sec-label';
  lab.textContent = 'SC';
  sec.appendChild(lab);

  const color = '#e74c3c';
  const current = (): SidechainState | null => strip.getSidechain();

  const buildOptions = () => [
    { value: '', label: 'off' },
    ...deps.sidechainBus.listSources(trackId).map((s) => ({ value: s.id, label: s.label })),
  ];

  // SRC options are baked at construction. The session host rebuilds the
  // mixer row on lane add/remove, so a live `bus.subscribe()` here would
  // leak across rebuilds without changing user-visible behavior.

  const knobs = document.createElement('div');
  knobs.className = 'mix-sc-knobs';

  const reflectSource = () => {
    knobs.style.display = current()?.source ? '' : 'none';
  };

  const initialSrc = current()?.source ?? '';
  const sel = createSelectControl({
    id: `mix.${trackId}.sc.src`,
    label: 'SRC',
    options: buildOptions(),
    initialValue: initialSrc,
    onChange: (v) => {
      const cur = current() ?? { ...DEFAULT_SIDECHAIN_STATE };
      if (v === '') strip.setSidechain(deps.sidechainBus, null);
      else          strip.setSidechain(deps.sidechainBus, { ...cur, source: v });
      reflectSource();
    },
  });
  sec.appendChild(sel.el);
  deps.registerKnob(sel.handle);

  addKnob(knobs, deps, {
    id: `mix.${trackId}.sc.depth`, label: 'DEPTH', min: 0, max: 1, step: 0.01,
    value: current()?.depth ?? 0.6, defaultValue: 0.6, color, format: fmtPct,
    onChange: (v) => {
      const cur = current(); if (!cur) return;
      strip.setSidechain(deps.sidechainBus, { ...cur, depth: v });
    },
  });
  addKnob(knobs, deps, {
    id: `mix.${trackId}.sc.atk`, label: 'ATK', min: 0.001, max: 0.5, step: 0.001,
    value: current()?.attack ?? 0.005, defaultValue: 0.005, color,
    format: (v) => `${Math.round(v * 1000)}ms`,
    onChange: (v) => {
      const cur = current(); if (!cur) return;
      strip.setSidechain(deps.sidechainBus, { ...cur, attack: v });
    },
  });
  addKnob(knobs, deps, {
    id: `mix.${trackId}.sc.rel`, label: 'REL', min: 0.005, max: 1, step: 0.005,
    value: current()?.release ?? 0.25, defaultValue: 0.25, color,
    format: (v) => v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`,
    onChange: (v) => {
      const cur = current(); if (!cur) return;
      strip.setSidechain(deps.sidechainBus, { ...cur, release: v });
    },
  });
  sec.appendChild(knobs);
  reflectSource();

  return sec;
}
