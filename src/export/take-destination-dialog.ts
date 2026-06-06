// src/export/take-destination-dialog.ts
// After a live take finalizes it is NOT auto-inserted anywhere — this modal asks
// the user where it should go: download a WAV file, or create a new dedicated
// audio channel holding the take as a clip. Returns the chosen destination, or
// null if dismissed (Esc / Cancel / backdrop). The <dialog> is built lazily and
// reused; stable ids (#take-dialog, #take-dest-audio, #take-dest-file) make it
// drivable from e2e.

export type TakeDestination = 'file' | 'audio';

let dialogEl: HTMLDialogElement | null = null;
let resolveCurrent: ((d: TakeDestination | null) => void) | null = null;

function settle(choice: TakeDestination | null): void {
  const resolve = resolveCurrent;
  resolveCurrent = null;
  if (dialogEl?.open) dialogEl.close();
  resolve?.(choice);
}

function build(): HTMLDialogElement {
  const dlg = document.createElement('dialog');
  dlg.id = 'take-dialog';
  dlg.className = 'take-dialog';
  dlg.innerHTML = `
    <div class="take-dialog-body">
      <h3 class="take-dialog-title">Take recorded</h3>
      <p class="take-dialog-text">Where do you want to save it?</p>
      <div class="take-dialog-actions">
        <button type="button" id="take-dest-audio" class="take-dialog-btn take-dialog-primary">New audio channel</button>
        <button type="button" id="take-dest-file" class="take-dialog-btn">Download WAV</button>
      </div>
      <button type="button" id="take-dest-cancel" class="take-dialog-cancel">Discard take</button>
    </div>`;
  dlg.querySelector('#take-dest-audio')!.addEventListener('click', () => settle('audio'));
  dlg.querySelector('#take-dest-file')!.addEventListener('click', () => settle('file'));
  dlg.querySelector('#take-dest-cancel')!.addEventListener('click', () => settle(null));
  // Esc dismiss → cancel (the native 'cancel' event precedes the close).
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); settle(null); });
  document.body.appendChild(dlg);
  return dlg;
}

/** Show the destination chooser and resolve with the user's pick (or null). */
export function showTakeDestinationDialog(): Promise<TakeDestination | null> {
  if (!dialogEl) dialogEl = build();
  // A take already pending a choice is superseded — resolve it as dismissed.
  if (resolveCurrent) settle(null);
  return new Promise<TakeDestination | null>((resolve) => {
    resolveCurrent = resolve;
    if (!dialogEl!.open) dialogEl!.showModal();
  });
}
