import { type FxBus, type SyncDiv } from './fx';
import type { InsertChain } from '../plugins/fx/insert-chain';
import { createKnob, type KnobHandle } from './knob';
import { attachKnobUndo, type HistoryDeps } from '../save/history-wiring';
import { buildLaneInsertUI } from '../session/lane-insert-ui';
import type { InsertSlot } from '../session/insert-slot';

/** Local replacement for the deleted addPolyKnob helper:
 *  builds a knob, appends to parent, registers in the automation registry. */
function appendKnob(
  parent: HTMLElement,
  opts: Parameters<typeof createKnob>[0],
  registerKnob: (k: KnobHandle) => void,
  undoHooks?: { onGestureStart: () => void; onGestureEnd: () => void },
): KnobHandle {
  const k = createKnob({ ...opts, ...undoHooks });
  parent.appendChild(k.el);
  registerKnob(k);
  return k;
}

/** Local replacement for the deleted addPolySelect helper. */
function appendSelect(
  parent: HTMLElement,
  label: string,
  options: Array<{ value: string; label: string }>,
  getCurrent: () => string,
  onChange: (v: string) => void,
): void {
  const wrap = document.createElement('div');
  wrap.className = 'knob';
  const lab = document.createElement('div');
  lab.className = 'knob-label';
  lab.textContent = label;
  wrap.appendChild(lab);
  const sel = document.createElement('select');
  sel.className = 'poly-wave-sel';
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o.value; opt.textContent = o.label;
    if (o.value === getCurrent()) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => onChange(sel.value));
  wrap.appendChild(sel);
  parent.appendChild(wrap);
}

// ── Formatters ──────────────────────────────────────────────────────────────
const fmtPct = (v: number) => `${Math.round(v * 100)}%`;
const fmtSec = (v: number) => v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`;

export const SYNC_OPTS: Array<{ value: SyncDiv; label: string }> = [
  { value: 'off',   label: 'Free' },
  { value: '4/1',   label: '4 bars' },
  { value: '3/1',   label: '3 bars' },
  { value: '2/1',   label: '2 bars' },
  { value: '1/1',   label: '1 bar' },
  { value: '1/2',   label: '1/2' },
  { value: '1/4',   label: '1/4' },
  { value: '1/8.',  label: '1/8.' },
  { value: '1/8',   label: '1/8' },
  { value: '1/8t',  label: '1/8t' },
  { value: '1/16',  label: '1/16' },
  { value: '1/16t', label: '1/16t' },
  { value: '1/32',  label: '1/32' },
];

export interface FxUIDeps {
  ctx: AudioContext;
  fx: FxBus;
  masterInsertChain: InsertChain;
  masterComp: import('./fx').MasterCompressor;
  getBpm: () => number;
  registerKnob: (k: KnobHandle) => void;
  /** Optional undo history deps. When present, knob drags/wheel/dblclick
   *  are bracketed as single undo entries. */
  historyDeps?: HistoryDeps;
  /** Called whenever the insert chain changes, so the session can be persisted. */
  saveSession?: () => void;
  /** Optional: when provided, master insert slots are read from and written to
   *  sessionState.masterInserts so they survive save/load. If absent, a local
   *  array is used (not persisted). */
  getSessionState?: () => import('../session/session').SessionState;
}

let _deps: FxUIDeps | null = null;
let _delaySyncDiv: SyncDiv = '1/8.';

export function getDelaySyncDiv(): SyncDiv { return _delaySyncDiv; }

export function applyDelaySync(deps: FxUIDeps) {
  const beatFractions: Record<SyncDiv, number> = {
    'off': 0.375,
    '4/1': 4, '3/1': 3, '2/1': 2, '1/1': 1,
    '1/2': 0.5, '1/4': 0.25, '1/8': 0.125, '1/8.': 0.1875, '1/8t': 1/12,
    '1/16': 0.0625, '1/16t': 1/24, '1/32': 0.03125,
  };
  const frac = beatFractions[_delaySyncDiv];
  deps.fx.setBpmSync(deps.getBpm(), frac);
}

// TODO: Task 19 will replace appendFilterRow with InsertChain-based plugin UI.
// The old MasterFilter row builder is stubbed out pending that task.

export function wireFxUI(deps: FxUIDeps): { rebuildMasterInserts: () => void } {
  _deps = deps;

  const revRow = document.getElementById('fx-reverb-knobs') as HTMLDivElement;
  const dlyRow = document.getElementById('fx-delay-knobs') as HTMLDivElement;
  const SIZE = 44;
  const revColor = '#9b59b6';
  const dlyColor = '#3498db';
  const undoHooks = deps.historyDeps ? attachKnobUndo(deps.historyDeps) : undefined;

  // REVERB
  appendKnob(revRow, { id: 'fx.reverb.wet', min: 0, max: 1, step: 0.01, value: deps.fx.getReverbWet(), defaultValue: 0.9,
    label: 'WET', color: revColor, size: SIZE, format: fmtPct,
    onChange: (v) => deps.fx.setReverbWet(v) }, deps.registerKnob, undoHooks);
  appendKnob(revRow, { id: 'fx.reverb.size', min: 0.1, max: 6, step: 0.1, value: deps.fx.getReverbSize(), defaultValue: 2.5,
    label: 'SIZE', color: revColor, size: SIZE, format: (v) => `${v.toFixed(1)}s`,
    onChange: (v) => deps.fx.setReverbSize(v) }, deps.registerKnob, undoHooks);
  appendKnob(revRow, { id: 'fx.reverb.decay', min: 0.5, max: 8, step: 0.1, value: deps.fx.getReverbDecay(), defaultValue: 3,
    label: 'DECAY', color: revColor, size: SIZE, format: (v) => v.toFixed(1),
    onChange: (v) => deps.fx.setReverbDecay(v) }, deps.registerKnob, undoHooks);
  appendKnob(revRow, { id: 'fx.reverb.predly', min: 0, max: 0.5, step: 0.005, value: deps.fx.getReverbPredelay(), defaultValue: 0,
    label: 'PREDLY', color: revColor, size: SIZE, format: fmtSec,
    onChange: (v) => deps.fx.setReverbPredelay(v) }, deps.registerKnob, undoHooks);

  // DELAY
  appendSelect(dlyRow, 'SYNC', SYNC_OPTS, () => _delaySyncDiv, (v) => {
    _delaySyncDiv = v as SyncDiv;
    applyDelaySync(deps);
  });
  appendKnob(dlyRow, { id: 'fx.delay.feedback', min: 0, max: 0.95, step: 0.01, value: deps.fx.getDelayFeedback(), defaultValue: 0.45,
    label: 'FBACK', color: dlyColor, size: SIZE, format: fmtPct,
    onChange: (v) => deps.fx.setDelayFeedback(v) }, deps.registerKnob, undoHooks);
  appendKnob(dlyRow, { id: 'fx.delay.wet', min: 0, max: 1, step: 0.01, value: deps.fx.getDelayWet(), defaultValue: 0.8,
    label: 'WET', color: dlyColor, size: SIZE, format: fmtPct,
    onChange: (v) => deps.fx.setDelayWet(v) }, deps.registerKnob, undoHooks);
  appendKnob(dlyRow, { id: 'fx.delay.damp', min: 200, max: 16000, step: 50, value: deps.fx.getDelayDamping(), defaultValue: 4500,
    label: 'DAMP', color: dlyColor, size: SIZE, format: (v) => `${Math.round(v)}Hz`,
    onChange: (v) => deps.fx.setDelayDamping(v) }, deps.registerKnob, undoHooks);

  // MASTER COMP
  const mcRow = document.getElementById('fx-master-comp-knobs') as HTMLDivElement;
  const mcColor = '#1abc9c';
  const fmtDbSigned = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
  const fmtRatio = (v: number) => `${v.toFixed(1)}:1`;
  const mc = deps.masterComp;
  const init = mc.getState();

  appendKnob(mcRow, { id: 'fx.mcomp.thr',  min: -60, max: 0,  step: 0.5,   value: init.threshold, defaultValue: -24,
    label: 'THR',  color: mcColor, size: SIZE, format: fmtDbSigned,
    onChange: (v) => mc.setState({ threshold: v }) }, deps.registerKnob, undoHooks);
  appendKnob(mcRow, { id: 'fx.mcomp.rat',  min: 1,   max: 20, step: 0.1,   value: init.ratio,     defaultValue: 4,
    label: 'RAT',  color: mcColor, size: SIZE, format: fmtRatio,
    onChange: (v) => mc.setState({ ratio: v }) }, deps.registerKnob, undoHooks);
  appendKnob(mcRow, { id: 'fx.mcomp.atk',  min: 0.001, max: 1, step: 0.001, value: init.attack,   defaultValue: 0.003,
    label: 'ATK',  color: mcColor, size: SIZE, format: (v) => v < 1 ? `${Math.round(v*1000)}ms` : `${v.toFixed(2)}s`,
    onChange: (v) => mc.setState({ attack: v }) }, deps.registerKnob, undoHooks);
  appendKnob(mcRow, { id: 'fx.mcomp.rel',  min: 0.001, max: 1, step: 0.001, value: init.release,  defaultValue: 0.25,
    label: 'REL',  color: mcColor, size: SIZE, format: (v) => v < 1 ? `${Math.round(v*1000)}ms` : `${v.toFixed(2)}s`,
    onChange: (v) => mc.setState({ release: v }) }, deps.registerKnob, undoHooks);
  appendKnob(mcRow, { id: 'fx.mcomp.knee', min: 0,   max: 40, step: 0.5,   value: init.knee,     defaultValue: 30,
    label: 'KNEE', color: mcColor, size: SIZE, format: fmtDbSigned,
    onChange: (v) => mc.setState({ knee: v }) }, deps.registerKnob, undoHooks);
  appendKnob(mcRow, { id: 'fx.mcomp.mkup', min: 0,   max: 4,  step: 0.01,  value: init.makeup,   defaultValue: 1,
    label: 'MKUP', color: mcColor, size: SIZE, format: (v) => `${v.toFixed(2)}×`,
    onChange: (v) => mc.setState({ makeup: v }) }, deps.registerKnob, undoHooks);

  const mcByp = document.createElement('button');
  mcByp.className = 'rnd master-comp-bypass';
  mcByp.textContent = 'BYP';
  mcByp.classList.toggle('active', init.bypass);
  mcByp.addEventListener('click', () => {
    const next = !mc.getState().bypass;
    mc.setState({ bypass: next });
    mcByp.classList.toggle('active', next);
  });
  mcRow.appendChild(mcByp);

  const masterFxContainer = document.getElementById('fx-filters') as HTMLDivElement;
  // Hide the static "Add Filter" button — buildLaneInsertUI provides its own.
  const addFilterBtn = document.getElementById('fx-add-filter');
  if (addFilterBtn) addFilterBtn.style.display = 'none';

  // Master insert chain UI (Task 28).
  // Re-reads sessionState.masterInserts on each rebuild so the slots array
  // stays in sync after applyLoadedSessionState replaces it.
  // Falls back to a module-local array when getSessionState is not provided.
  let _localMasterInsertSlots: InsertSlot[] = [];
  const getMasterSlots = (): InsertSlot[] => {
    const ss = deps.getSessionState?.();
    if (ss) { ss.masterInserts ??= []; return ss.masterInserts; }
    return _localMasterInsertSlots;
  };

  const rebuildMasterInserts = (): void => {
    if (!masterFxContainer) return;
    buildLaneInsertUI({
      ctx: deps.ctx,
      container: masterFxContainer,
      chain: deps.masterInsertChain,
      slots: getMasterSlots(),
      onChange: () => deps.saveSession?.(),
    });
  };

  rebuildMasterInserts();
  return { rebuildMasterInserts };
}
