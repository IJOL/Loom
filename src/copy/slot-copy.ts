import { clonePattern } from '../core/pattern';
import { DRUM_LANES } from '../core/drums';
import type { PatternBank } from '../core/pattern';
import type { Sequencer } from '../core/sequencer';

// ── Slot copy panel (copy bass/drums/melody/auto between bank slots) ───────

export interface SlotCopyDeps {
  bank: PatternBank;
  seq: Sequencer;
  barsSel: HTMLSelectElement;
  renderLanes: () => void;
  flashButton: (btn: HTMLButtonElement, msg: string) => void;
}

/** Wire the #copy-from / #copy-to / #copy-go slot-copy panel. Call once at boot. */
export function wireSlotCopyPanel(deps: SlotCopyDeps): void {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

  const fromSel = $<HTMLSelectElement>('copy-from');
  const toSel   = $<HTMLSelectElement>('copy-to');

  for (const sel of [fromSel, toSel]) {
    for (let i = 0; i < deps.bank.slots.length; i++) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = String.fromCharCode(65 + i); // A B C D
      sel.appendChild(opt);
    }
  }
  fromSel.value = '0';
  toSel.value = '1';

  $<HTMLButtonElement>('copy-go').addEventListener('click', () => {
    const from = parseInt(fromSel.value, 10);
    const to   = parseInt(toSel.value, 10);
    if (from === to) return;

    const copyBass   = $<HTMLInputElement>('copy-bass').checked;
    const copyDrums  = $<HTMLInputElement>('copy-drums').checked;
    const copyMelody = $<HTMLInputElement>('copy-melody').checked;
    const copyAuto   = $<HTMLInputElement>('copy-auto').checked;

    // If we're currently editing the source, snapshot live state into it first.
    if (from === deps.bank.current) deps.bank.slots[from] = clonePattern(deps.seq.pattern);

    const src = deps.bank.slots[from];
    const dst = deps.bank.slots[to];

    // Resize destination if needed so the copy fits.
    if (src.length !== dst.length) {
      const diff = src.length - dst.length;
      if (diff > 0) {
        for (let i = 0; i < diff; i++) {
          dst.bass.push({ on: false, note: 36, accent: false, slide: false });
          dst.melody.push({ on: false, notes: [60], accent: false, tie: false });
          for (const lane of DRUM_LANES) dst.drums[lane].push({ on: false, accent: false });
        }
      } else if (diff < 0) {
        dst.bass.length = src.length;
        dst.melody.length = src.length;
        for (const lane of DRUM_LANES) dst.drums[lane].length = src.length;
      }
      dst.length = src.length;
    }

    if (copyBass)   dst.bass   = src.bass.map((s) => ({ ...s }));
    if (copyMelody) dst.melody = src.melody.map((s) => ({ ...s }));
    if (copyDrums) {
      dst.drums = Object.fromEntries(
        DRUM_LANES.map((lane) => [lane, src.drums[lane].map((s) => ({ ...s }))]),
      ) as typeof dst.drums;
    }
    if (copyAuto) {
      dst.automation = src.automation.map((l) => ({ ...l, values: [...l.values] }));
    }

    // If we just overwrote the currently-playing/edited slot, re-render.
    if (to === deps.bank.current) {
      deps.seq.setPattern(deps.bank.slots[to]);
      deps.barsSel.value = String(deps.seq.length);
      deps.renderLanes();
    }
    deps.flashButton(
      $<HTMLButtonElement>('copy-go'),
      `${String.fromCharCode(65 + from)}→${String.fromCharCode(65 + to)} ✓`,
    );
  });
}
