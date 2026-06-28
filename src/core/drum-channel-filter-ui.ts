// src/core/drum-channel-filter-ui.ts
// Mounts the "CHANNEL FILTER" knob section (CUTOFF + RES) in the drums editor.
// Mirrors the manual knob-build pattern used in drum-master-ui.ts.

import { createKnob, type KnobHandle } from './knob';
import { attachKnobUndo, type HistoryDeps } from '../save/history-wiring';
import {
  FILTER_CUTOFF_MIN, FILTER_CUTOFF_MAX, FILTER_CUTOFF_DEFAULT,
  FILTER_Q_MIN, FILTER_Q_MAX, FILTER_Q_DEFAULT,
} from './channel-filter';

const FILTER_COLOR = '#16a085';

export interface DrumChannelFilterDeps {
  laneId: string;
  engine: { getBaseValue(id: string): number; setBaseValue(id: string, v: number): void };
  parent: HTMLElement;
  registerKnob: (k: KnobHandle) => void;
  historyDeps?: HistoryDeps;
  onEdit?: (id: string, v: number) => void;   // for session mirroring
}

const fmtHz = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`;
const fmtQ  = (v: number) => v.toFixed(1);

export function mountDrumChannelFilter(deps: DrumChannelFilterDeps): void {
  const { laneId, engine, parent } = deps;
  const sec = document.createElement('div');
  sec.className = 'row poly-section drum-channel-filter';
  const lab = document.createElement('div');
  lab.className = 'section-label';
  lab.textContent = 'CHANNEL FILTER';
  sec.appendChild(lab);

  const row = document.createElement('div');
  row.className = 'knob-row';
  sec.appendChild(row);

  const undoHooks = deps.historyDeps ? attachKnobUndo(deps.historyDeps) : {};
  const mk = (id: string, label: string, min: number, max: number, dflt: number,
              fmt: (v: number) => string) => {
    const k = createKnob({
      id: `${laneId}.${id}`, label, min, max, step: 0,
      value: engine.getBaseValue(id), defaultValue: dflt,
      size: 42, color: FILTER_COLOR, format: fmt,
      onChange: (v) => { engine.setBaseValue(id, v); deps.onEdit?.(id, v); },
      ...undoHooks,
    });
    row.appendChild(k.el);
    deps.registerKnob(k);
  };
  mk('filter.cutoff',    'CUTOFF', FILTER_CUTOFF_MIN, FILTER_CUTOFF_MAX, FILTER_CUTOFF_DEFAULT, fmtHz);
  mk('filter.resonance', 'RES',    FILTER_Q_MIN,      FILTER_Q_MAX,      FILTER_Q_DEFAULT,       fmtQ);

  parent.appendChild(sec);
}
