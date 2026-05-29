import { createKnob, type KnobHandle } from './knob';
import { attachKnobUndo, type HistoryDeps } from '../save/history-wiring';
import { DEFAULT_SIDECHAIN_STATE } from './comp-state';
import type { ChannelStrip } from './fx';
import type { SidechainBus } from './sidechain-bus';

const COMP_COLOR = '#1abc9c';
const SC_COLOR   = '#e74c3c';
const KNOB_SIZE  = 32;

const fmtPct   = (v: number) => `${Math.round(v * 100)}%`;
const fmtDb    = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
const fmtRatio = (v: number) => `${v.toFixed(1)}:1`;
const fmtMs    = (v: number) => v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`;
const fmtMult  = (v: number) => `${v.toFixed(2)}×`;

export interface LaneFxPanelOpts {
  laneId: string;
  strip: ChannelStrip;
  bus: SidechainBus;
  parent: HTMLElement;
  registerKnob: (k: KnobHandle) => void;
  historyDeps?: HistoryDeps;
  lookupLabel?: (laneId: string) => string | undefined;
}

interface KnobCfg {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  defaultValue?: number;
  color: string;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}

function addKnob(parent: HTMLElement, opts: LaneFxPanelOpts, cfg: KnobCfg): void {
  const undoHooks = opts.historyDeps ? attachKnobUndo(opts.historyDeps) : {};
  const k = createKnob({ ...cfg, size: KNOB_SIZE, ...undoHooks });
  parent.appendChild(k.el);
  opts.registerKnob(k);
}

function buildCompSubsection(opts: LaneFxPanelOpts): HTMLElement {
  const { laneId, strip } = opts;
  const sec = document.createElement('div');
  sec.className = 'row poly-section lane-fx-comp';
  const lab = document.createElement('div');
  lab.className = 'section-label';
  lab.textContent = 'COMP';
  sec.appendChild(lab);

  const row = document.createElement('div');
  row.className = 'knob-row';
  sec.appendChild(row);

  const init = strip.getCompState();

  addKnob(row, opts, {
    id: `${laneId}.fx.comp.thr`, label: 'THR', min: -60, max: 0, step: 0.5,
    value: init.threshold, defaultValue: -24, color: COMP_COLOR, format: fmtDb,
    onChange: (v) => strip.setCompState({ threshold: v }),
  });
  addKnob(row, opts, {
    id: `${laneId}.fx.comp.rat`, label: 'RAT', min: 1, max: 20, step: 0.1,
    value: init.ratio, defaultValue: 4, color: COMP_COLOR, format: fmtRatio,
    onChange: (v) => strip.setCompState({ ratio: v }),
  });
  addKnob(row, opts, {
    id: `${laneId}.fx.comp.atk`, label: 'ATK', min: 0.001, max: 1, step: 0.001,
    value: init.attack, defaultValue: 0.003, color: COMP_COLOR, format: fmtMs,
    onChange: (v) => strip.setCompState({ attack: v }),
  });
  addKnob(row, opts, {
    id: `${laneId}.fx.comp.rel`, label: 'REL', min: 0.001, max: 1, step: 0.001,
    value: init.release, defaultValue: 0.25, color: COMP_COLOR, format: fmtMs,
    onChange: (v) => strip.setCompState({ release: v }),
  });
  addKnob(row, opts, {
    id: `${laneId}.fx.comp.knee`, label: 'KNEE', min: 0, max: 40, step: 0.5,
    value: init.knee, defaultValue: 30, color: COMP_COLOR, format: fmtDb,
    onChange: (v) => strip.setCompState({ knee: v }),
  });
  addKnob(row, opts, {
    id: `${laneId}.fx.comp.mkup`, label: 'MKUP', min: 0, max: 4, step: 0.01,
    value: init.makeup, defaultValue: 1, color: COMP_COLOR, format: fmtMult,
    onChange: (v) => strip.setCompState({ makeup: v }),
  });

  const byp = document.createElement('button');
  byp.className = 'rnd lane-fx-bypass';
  byp.textContent = 'BYP';
  byp.classList.toggle('active', init.bypass);
  byp.addEventListener('click', () => {
    const next = !strip.getCompState().bypass;
    strip.setCompState({ bypass: next });
    byp.classList.toggle('active', next);
  });
  row.appendChild(byp);

  return sec;
}

function buildSidechainSubsection(opts: LaneFxPanelOpts): HTMLElement {
  const { laneId, strip, bus, lookupLabel } = opts;
  const sec = document.createElement('div');
  sec.className = 'row poly-section lane-fx-sc';
  const lab = document.createElement('div');
  lab.className = 'section-label';
  lab.textContent = 'SC';
  sec.appendChild(lab);

  const row = document.createElement('div');
  row.className = 'knob-row';
  sec.appendChild(row);

  const current = (): import('./comp-state').SidechainState | null => strip.getSidechain();

  const sel = document.createElement('select');
  sel.className = 'lane-fx-sc-src';
  const offOpt = document.createElement('option');
  offOpt.value = '';
  offOpt.textContent = 'off';
  sel.appendChild(offOpt);
  for (const src of bus.listSources(laneId)) {
    const o = document.createElement('option');
    o.value = src.id;
    o.textContent = lookupLabel?.(src.id) ?? src.label ?? src.id;
    sel.appendChild(o);
  }
  sel.value = current()?.source ?? '';
  row.appendChild(sel);

  const knobsBox = document.createElement('div');
  knobsBox.className = 'lane-fx-sc-knobs';
  row.appendChild(knobsBox);

  const reflectSource = () => {
    knobsBox.style.display = current()?.source ? '' : 'none';
  };

  sel.addEventListener('change', () => {
    const v = sel.value;
    const cur = current() ?? { ...DEFAULT_SIDECHAIN_STATE };
    if (v === '') strip.setSidechain(bus, null);
    else          strip.setSidechain(bus, { ...cur, source: v });
    reflectSource();
  });

  addKnob(knobsBox, opts, {
    id: `${laneId}.fx.sc.depth`, label: 'DEPTH', min: 0, max: 1, step: 0.01,
    value: current()?.depth ?? 0.6, defaultValue: 0.6, color: SC_COLOR, format: fmtPct,
    onChange: (v) => {
      const cur = current(); if (!cur) return;
      strip.setSidechain(bus, { ...cur, depth: v });
    },
  });
  addKnob(knobsBox, opts, {
    id: `${laneId}.fx.sc.atk`, label: 'ATK', min: 0.001, max: 0.5, step: 0.001,
    value: current()?.attack ?? 0.005, defaultValue: 0.005, color: SC_COLOR, format: fmtMs,
    onChange: (v) => {
      const cur = current(); if (!cur) return;
      strip.setSidechain(bus, { ...cur, attack: v });
    },
  });
  addKnob(knobsBox, opts, {
    id: `${laneId}.fx.sc.rel`, label: 'REL', min: 0.005, max: 1, step: 0.005,
    value: current()?.release ?? 0.25, defaultValue: 0.25, color: SC_COLOR, format: fmtMs,
    onChange: (v) => {
      const cur = current(); if (!cur) return;
      strip.setSidechain(bus, { ...cur, release: v });
    },
  });

  reflectSource();
  return sec;
}

export function mountLaneFxPanel(opts: LaneFxPanelOpts): void {
  opts.parent.innerHTML = '';
  opts.parent.appendChild(buildCompSubsection(opts));
  opts.parent.appendChild(buildSidechainSubsection(opts));
}
