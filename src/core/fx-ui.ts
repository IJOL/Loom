import { html, render } from 'lit-html';
import { type FxBus } from './fx';
import type { InsertChain } from '../plugins/fx/insert-chain';
import { createKnob, type KnobHandle } from './knob';
import { attachKnobUndo, type HistoryDeps } from '../save/history-wiring';
import { buildLaneInsertUI } from '../session/lane-insert-ui';
import type { InsertSlot } from '../session/insert-slot';

/** Builds a knob and registers it in the automation registry; the caller's
 *  template interpolates `k.el` (replacement for the old append helper). */
function makeKnob(
  opts: Parameters<typeof createKnob>[0],
  registerKnob: (k: KnobHandle) => void,
  undoHooks?: { onGestureStart: () => void; onGestureEnd: () => void },
): KnobHandle {
  const k = createKnob({ ...opts, ...undoHooks });
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
  /** Air / multiband glue / stereo width. Optional so existing callers and
   *  tests that only exercise the compressor keep working. */
  masterShaper?: import('./master-shaper').MasterShaper;
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
  /** Fired when the SET of automation destinations changes — a master or
   *  send-bus insert is added or removed. Drives DestinationRegistry.invalidate().
   *  Optional so test fixtures without the registry still compile. */
  onDestinationsChanged?: () => void;
}

let _deps: FxUIDeps | null = null;

export function wireFxUI(deps: FxUIDeps): { rebuildMasterInserts: () => void; rebuildSends: () => void; refreshMasterComp: () => void; refreshMasterShaper: () => void } {
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

  const kThr = makeKnob({ id: 'fx.mcomp.thr',  min: -60, max: 0,  step: 0.5,   value: init.threshold, defaultValue: -24,
    label: 'THR',  color: mcColor, size: SIZE, format: fmtDbSigned,
    onChange: (v) => mc.setState({ threshold: v }) }, deps.registerKnob, undoHooks);
  const kRat = makeKnob({ id: 'fx.mcomp.rat',  min: 1,   max: 20, step: 0.1,   value: init.ratio,     defaultValue: 4,
    label: 'RAT',  color: mcColor, size: SIZE, format: fmtRatio,
    onChange: (v) => mc.setState({ ratio: v }) }, deps.registerKnob, undoHooks);
  const kAtk = makeKnob({ id: 'fx.mcomp.atk',  min: 0.001, max: 1, step: 0.001, value: init.attack,   defaultValue: 0.003,
    label: 'ATK',  color: mcColor, size: SIZE, format: fmtSec,
    onChange: (v) => mc.setState({ attack: v }) }, deps.registerKnob, undoHooks);
  const kRel = makeKnob({ id: 'fx.mcomp.rel',  min: 0.001, max: 1, step: 0.001, value: init.release,  defaultValue: 0.25,
    label: 'REL',  color: mcColor, size: SIZE, format: fmtSec,
    onChange: (v) => mc.setState({ release: v }) }, deps.registerKnob, undoHooks);
  const kKnee = makeKnob({ id: 'fx.mcomp.knee', min: 0,   max: 40, step: 0.5,   value: init.knee,     defaultValue: 30,
    label: 'KNEE', color: mcColor, size: SIZE, format: fmtDbSigned,
    onChange: (v) => mc.setState({ knee: v }) }, deps.registerKnob, undoHooks);
  const kMkup = makeKnob({ id: 'fx.mcomp.mkup', min: 0,   max: 4,  step: 0.01,  value: init.makeup,   defaultValue: 1,
    label: 'MKUP', color: mcColor, size: SIZE, format: (v) => `${v.toFixed(2)}×`,
    onChange: (v) => mc.setState({ makeup: v }) }, deps.registerKnob, undoHooks);

  // One-shot render into the static #fx-master-comp-knobs row — wireFxUI runs
  // once per document, so this container is never rendered into twice.
  render(html`
    ${kThr.el}${kRat.el}${kAtk.el}${kRel.el}${kKnee.el}${kMkup.el}
    <button
      class=${init.bypass ? 'rnd master-comp-bypass active' : 'rnd master-comp-bypass'}
      @click=${(e: Event) => {
        const next = !mc.getState().bypass;
        mc.setState({ bypass: next });
        (e.currentTarget as HTMLElement).classList.toggle('active', next);
      }}
    >BYP</button>
  `, mcRow);
  const mcByp = mcRow.querySelector('.master-comp-bypass') as HTMLButtonElement;

  // MASTER SHAPER — air / multiband glue / stereo width.
  // Every one of these is fixed and unreachable in mpump, where the port came
  // from. A sound parameter with no surface is one you cannot undo, so all four
  // are knobs.
  const msRow = document.getElementById('fx-master-shaper-knobs') as HTMLDivElement | null;
  const shaper = deps.masterShaper;
  const msColor = '#9b59b6';
  let kAir: KnobHandle | null = null, kWidth: KnobHandle | null = null, kMbAmt: KnobHandle | null = null;
  let mbBtn: HTMLButtonElement | null = null;
  if (msRow && shaper) {
    const si = shaper.getState();
    kAir = makeKnob({ id: 'fx.shaper.air', min: -12, max: 12, step: 0.5, value: si.airDb, defaultValue: -3,
      label: 'AIR', color: msColor, size: SIZE, format: fmtDbSigned,
      onChange: (v) => shaper.setAirDb(v) }, deps.registerKnob, undoHooks);
    kWidth = makeKnob({ id: 'fx.shaper.width', min: 0, max: 1, step: 0.01, value: si.width, defaultValue: 0,
      label: 'WIDTH', color: msColor, size: SIZE, format: (v) => `${Math.round(v * 100)}%`,
      onChange: (v) => shaper.setWidth(v) }, deps.registerKnob, undoHooks);
    kMbAmt = makeKnob({ id: 'fx.shaper.glue', min: 0, max: 1, step: 0.01, value: si.mbAmount, defaultValue: 0.25,
      label: 'GLUE', color: msColor, size: SIZE, format: (v) => `${Math.round(v * 100)}%`,
      onChange: (v) => shaper.setMultibandAmount(v) }, deps.registerKnob, undoHooks);

    // Labelled MB, not GLUE: the knob beside it is already GLUE (how much), and
    // two controls with one name is a control you have to guess at.
    render(html`
      ${kAir.el}${kWidth.el}${kMbAmt.el}
      <button
        class=${si.mbOn ? 'rnd master-mb-toggle active' : 'rnd master-mb-toggle'}
        title="Multiband glue compression on/off — GLUE sets how hard it works"
        @click=${(e: Event) => {
          const next = !shaper.getState().mbOn;
          shaper.setMultibandOn(next);
          (e.currentTarget as HTMLElement).classList.toggle('active', next);
        }}
      >MB</button>
    `, msRow);
    mbBtn = msRow.querySelector('.master-mb-toggle') as HTMLButtonElement;
  }

  /** Pull the shaper knobs back from live state after a load / undo / redo. */
  const refreshMasterShaper = (): void => {
    if (!shaper) return;
    const st = shaper.getState();
    kAir?.setValue(st.airDb);
    kWidth?.setValue(st.width);
    kMbAmt?.setValue(st.mbAmount);
    mbBtn?.classList.toggle('active', st.mbOn);
  };

  // Pull the master-compressor knobs + bypass back from live state. Called after
  // a session load / undo / redo restores the compressor (saved-state-v3 applies
  // masterComp.setState first) so the panel reflects the recalled values instead
  // of the stale ones the knobs were built with at boot.
  const refreshMasterComp = (): void => {
    const st = mc.getState();
    kThr.setValue(st.threshold);
    kRat.setValue(st.ratio);
    kAtk.setValue(st.attack);
    kRel.setValue(st.release);
    kKnee.setValue(st.knee);
    kMkup.setValue(st.makeup);
    mcByp.classList.toggle('active', st.bypass);
  };

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
    if (ss) return ss.masterInserts;
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
      automationScopeId: 'fx.master',
      onDestinationsChanged: deps.onDestinationsChanged,
    });
  };

  rebuildMasterInserts();

  // ── Send return modules (Task 10) ──────────────────────────────────────────
  const buildSendModule = (bus: import('./send-bus').SendBus, slots: InsertSlot[]) => {
    const host = document.getElementById(`fx-send-${bus.id.toLowerCase()}`) as HTMLDivElement | null;
    if (!host) return;
    const ret = makeKnob({
      id: `fx.send.${bus.id}.level`, min: 0, max: 1.5, step: 0.01,
      value: bus.getReturnLevel(), defaultValue: 1, label: 'RET', size: SIZE, format: fmtPct,
      onChange: (v) => bus.setReturnLevel(v),
    }, deps.registerKnob, undoHooks);
    // rebuildSends re-runs on session load: render into a throwaway fragment
    // each time (never twice into `host` — its wiped lit markers would break a
    // second render) and move the children across. The unclassed trailing div
    // is the insert rack buildLaneInsertUI renders into.
    const frag = document.createDocumentFragment();
    render(html`
      <div class="fx-send-title">${bus.label}</div>
      <div class="fx-send-ctrls">
        ${ret.el}
        <button
          class=${bus.isMuted() ? 'rnd active' : 'rnd'}
          @click=${(e: Event) => {
            const m = !bus.isMuted();
            bus.setMuted(m);
            (e.currentTarget as HTMLElement).classList.toggle('active', m);
            deps.saveSession?.();
          }}
        >MUTE</button>
      </div>
      <div></div>
    `, frag);
    host.replaceChildren(frag);
    const rack = host.lastElementChild as HTMLDivElement;
    buildLaneInsertUI({
      ctx: deps.ctx,
      container: rack,
      chain: bus.inserts,
      slots,
      onChange: () => deps.saveSession?.(),
      registerKnob: deps.registerKnob,
      automationScopeId: `fx.send.${bus.id}`,
      onDestinationsChanged: deps.onDestinationsChanged,
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
  return { rebuildMasterInserts, rebuildSends, refreshMasterComp, refreshMasterShaper };
}
