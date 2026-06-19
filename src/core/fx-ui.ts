import { type FxBus } from './fx';
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

// ── Formatters ──────────────────────────────────────────────────────────────
const fmtPct = (v: number) => `${Math.round(v * 100)}%`;
const fmtSec = (v: number) => v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`;


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

export function wireFxUI(deps: FxUIDeps): { rebuildMasterInserts: () => void; rebuildSends: () => void } {
  _deps = deps;

  const SIZE = 44;
  const undoHooks = deps.historyDeps ? attachKnobUndo(deps.historyDeps) : undefined;

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
      registerKnob: deps.registerKnob,
      automationIdPrefix: 'fx.master',
    });
  };

  rebuildMasterInserts();

  // ── Send return modules (Task 10) ──────────────────────────────────────────
  const buildSendModule = (bus: import('./send-bus').SendBus, slots: InsertSlot[]) => {
    const host = document.getElementById(`fx-send-${bus.id.toLowerCase()}`) as HTMLDivElement | null;
    if (!host) return;
    host.replaceChildren();
    const title = document.createElement('div');
    title.className = 'fx-send-title';
    title.textContent = bus.label;
    host.appendChild(title);
    const ctrls = document.createElement('div');
    ctrls.className = 'fx-send-ctrls';
    appendKnob(ctrls, {
      id: `fx.send.${bus.id}.level`, min: 0, max: 1.5, step: 0.01,
      value: bus.getReturnLevel(), defaultValue: 1, label: 'RET', size: SIZE, format: fmtPct,
      onChange: (v) => bus.setReturnLevel(v),
    }, deps.registerKnob, undoHooks);
    const mute = document.createElement('button');
    mute.className = 'rnd';
    mute.textContent = 'MUTE';
    mute.classList.toggle('active', bus.isMuted());
    mute.onclick = () => {
      const m = !bus.isMuted();
      bus.setMuted(m);
      mute.classList.toggle('active', m);
      deps.saveSession?.();
    };
    ctrls.appendChild(mute);
    host.appendChild(ctrls);
    const rack = document.createElement('div');
    host.appendChild(rack);
    buildLaneInsertUI({
      ctx: deps.ctx,
      container: rack,
      chain: bus.inserts,
      slots,
      onChange: () => deps.saveSession?.(),
      registerKnob: deps.registerKnob,
      automationIdPrefix: `fx.send.${bus.id}`,
    });
  };

  const rebuildSends = (): void => {
    const ss = deps.getSessionState?.();
    deps.fx.sends.forEach((bus, i) => {
      const slots = ss?.sends?.[i]?.inserts ?? [];
      buildSendModule(bus, slots);
    });
  };

  rebuildSends();
  return { rebuildMasterInserts, rebuildSends };
}
