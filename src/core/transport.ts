import type { Sequencer } from './sequencer';
import type { PatternBank } from './pattern';
import { clonePattern } from './pattern';
import { DRUM_LANES } from './drums';
import type { classicState as ClassicStateType } from '../classic/classic-state';

const $$ = <T extends HTMLElement>(sel: string) => Array.from(document.querySelectorAll<T>(sel));

export interface TransportDeps {
  seq: Sequencer;
  bank: PatternBank;
  ctx: AudioContext;
  playBtn: HTMLButtonElement;
  barsSel: HTMLSelectElement;
  resetAutomationPosition: () => void;
  classicState: typeof ClassicStateType;
  getViewStart: () => number;
  setViewStart: (v: number) => void;
  VIEW_SIZE: number;
  rebuildTracks: () => void;
  renderLanes: () => void;
  updateBassModeButtons: () => void;
  syncEngineToPattern: () => void;
  rebuildSynthTabs: () => void;
  getClassicVisibleRange: () => { start: number; end: number };
}

// Mutable state owned by transport
let _chainEnabled = false;
let _chainSavedLoopState = true;
let _pendingSlotIdx: number | null = null;
let _deps: TransportDeps | null = null;
let _loopBtn: HTMLButtonElement | null = null;

export function isChainEnabled(): boolean { return _chainEnabled; }
export function getPendingSlotIdx(): number | null { return _pendingSlotIdx; }

/** Re-refresh the loop button (e.g. after MIDI import changes seq.loopEnabled). */
export function refreshLoopBtn(): void {
  if (_loopBtn && _deps) refreshLoopBtnEl(_loopBtn);
}

export function switchSlot(newIdx: number): void {
  const d = _deps!;
  if (newIdx === d.bank.current && _pendingSlotIdx === null) return;
  // Save edits to current slot immediately (even if swap is queued)
  d.bank.slots[d.bank.current] = clonePattern(d.seq.pattern);
  if (!d.seq.isPlaying()) {
    // Not playing — swap right now
    d.bank.current = newIdx;
    d.seq.setPattern(d.bank.slots[newIdx]);
    d.barsSel.value = String(d.seq.length);
    d.setViewStart(0);
    d.rebuildTracks();
    updateSlotButtons();
    d.renderLanes();
    d.syncEngineToPattern();
  } else {
    // Playing — queue the swap, it'll happen at the next loop start
    _pendingSlotIdx = newIdx;
    d.seq.queuePattern(d.bank.slots[newIdx]);
    updateSlotButtons();
  }
}

export function updateSlotButtons(): void {
  $$('button.slot').forEach((b) => {
    const idx = parseInt(b.dataset.slot ?? '0', 10);
    b.classList.toggle('active', idx === _deps!.bank.current);
    b.classList.toggle('pending', idx === _pendingSlotIdx);
  });
}

function refreshLoopBtnEl(loopBtn: HTMLButtonElement): void {
  loopBtn.classList.toggle('primary', _deps!.seq.loopEnabled);
  loopBtn.textContent = _deps!.seq.loopEnabled ? '↻ LOOP' : '⤳ ONESHOT';
  loopBtn.disabled = _chainEnabled;
  loopBtn.style.opacity = _chainEnabled ? '0.4' : '';
}

function refreshChainBtn(chainBtn: HTMLButtonElement): void {
  chainBtn.classList.toggle('primary', _chainEnabled);
  chainBtn.textContent = _chainEnabled ? '→ CHAIN' : '→ chain';
}

export function wireTransport(deps: TransportDeps): void {
  _deps = deps;
  const { seq, bank, ctx, playBtn, barsSel, classicState } = deps;

  // ── Play/Stop ──────────────────────────────────────────────────────────────
  playBtn.addEventListener('click', () => {
    void ctx.resume();
    if (seq.isPlaying()) {
      seq.stop();
      playBtn.textContent = '▶';
      for (const i of Object.keys(classicState.bassCells)) classicState.bassCells[+i].el.classList.remove('current');
      for (const i of Object.keys(classicState.melodyCells)) classicState.melodyCells[+i].el.classList.remove('current');
      for (const lane of DRUM_LANES) for (const i of Object.keys(classicState.drumCells[lane])) classicState.drumCells[lane][+i].classList.remove('current');
    } else {
      deps.resetAutomationPosition();
      seq.start();
      playBtn.textContent = '■';
    }
  });

  seq.onStep = (i) => {
    const { start, end } = deps.getClassicVisibleRange();
    for (let j = start; j < end; j++) {
      const c = classicState.bassCells[j];
      if (c) c.el.classList.toggle('current', i === j);
      const mc = classicState.melodyCells[j];
      if (mc) mc.el.classList.toggle('current', i === j);
      for (const lane of DRUM_LANES) {
        const b = classicState.drumCells[lane][j];
        if (b) b.classList.toggle('current', i === j);
      }
    }
  };

  // ── Loop toggle ────────────────────────────────────────────────────────────
  const loopBtn = document.getElementById('loop-toggle') as HTMLButtonElement;
  _loopBtn = loopBtn;
  loopBtn.addEventListener('click', () => {
    seq.loopEnabled = !seq.loopEnabled;
    refreshLoopBtnEl(loopBtn);
  });
  refreshLoopBtnEl(loopBtn);

  // ── Chain toggle ───────────────────────────────────────────────────────────
  const chainBtn = document.getElementById('chain-toggle') as HTMLButtonElement;
  chainBtn.addEventListener('click', () => {
    _chainEnabled = !_chainEnabled;
    if (_chainEnabled) {
      _chainSavedLoopState = seq.loopEnabled;
      seq.loopEnabled = false;
    } else {
      seq.loopEnabled = _chainSavedLoopState;
    }
    refreshChainBtn(chainBtn);
    refreshLoopBtnEl(loopBtn);
  });
  refreshChainBtn(chainBtn);

  seq.onEnded = () => {
    if (_chainEnabled) {
      const next = (bank.current + 1) % bank.slots.length;
      switchSlot(next);
      // switchSlot queues when playing — but we just stopped, so trigger it inline.
      if (!seq.isPlaying()) seq.start();
      return;
    }
    playBtn.textContent = '▶';
  };

  // ── Pattern slot buttons ───────────────────────────────────────────────────
  $$('button.slot').forEach((b) => {
    b.addEventListener('click', () => switchSlot(parseInt(b.dataset.slot ?? '0', 10)));
  });

  seq.onPatternChange = () => {
    if (_pendingSlotIdx !== null) {
      bank.current = _pendingSlotIdx;
      _pendingSlotIdx = null;
      barsSel.value = String(seq.length);
      deps.setViewStart(0);
      deps.rebuildTracks();
      updateSlotButtons();
      deps.renderLanes();
      deps.updateBassModeButtons();
      deps.syncEngineToPattern();
      deps.rebuildSynthTabs();
    }
  };

  // ── Pager ──────────────────────────────────────────────────────────────────
  document.getElementById('page-prev')!.addEventListener('click', () => {
    if (deps.getViewStart() >= deps.VIEW_SIZE) { deps.setViewStart(deps.getViewStart() - deps.VIEW_SIZE); deps.rebuildTracks(); }
  });
  document.getElementById('page-next')!.addEventListener('click', () => {
    if (deps.getViewStart() + deps.VIEW_SIZE < seq.length) { deps.setViewStart(deps.getViewStart() + deps.VIEW_SIZE); deps.rebuildTracks(); }
  });
}
