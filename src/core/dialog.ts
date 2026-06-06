// src/core/dialog.ts
// One reusable modal facility replacing the native window.alert/confirm/prompt
// (which are ugly, blocking, and out of Loom's visual language). Built on a single
// reused <dialog> element (showModal), styled via .app-dialog (see _dialog.scss).
// All three are async (a custom modal can't block the thread like the natives):
//   await alertDialog('msg')           → void
//   if (await confirmDialog('msg')) …  → boolean
//   const v = await promptDialog('q')  → string | null  (null = cancelled)
// Stable ids (#app-dialog, #app-dialog-ok/-cancel/-input) make it e2e-drivable.

export interface DialogOpts {
  title?: string;
  okLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive (red). */
  danger?: boolean;
}

type Variant =
  | { kind: 'alert' }
  | { kind: 'confirm' }
  | { kind: 'prompt'; defaultValue: string };

let dialogEl: HTMLDialogElement | null = null;
let settleCurrent: ((v: unknown) => void) | null = null;
let cancelValue: unknown = undefined;

function settle(value: unknown): void {
  const resolve = settleCurrent;
  settleCurrent = null;
  if (dialogEl?.open) dialogEl.close();
  resolve?.(value);
}

function ensureDialog(): HTMLDialogElement {
  if (dialogEl) return dialogEl;
  const dlg = document.createElement('dialog');
  dlg.id = 'app-dialog';
  dlg.className = 'app-dialog';
  // Esc (the native 'cancel' event precedes close) resolves with the variant's
  // cancel value (false for confirm, null for prompt, undefined for alert).
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); settle(cancelValue); });
  document.body.appendChild(dlg);
  dialogEl = dlg;
  return dlg;
}

function run(message: string, variant: Variant, opts: DialogOpts = {}): Promise<unknown> {
  const dlg = ensureDialog();
  if (settleCurrent) settle(cancelValue); // supersede any pending dialog as cancelled
  cancelValue = variant.kind === 'confirm' ? false : variant.kind === 'prompt' ? null : undefined;

  const okLabel = opts.okLabel ?? 'OK';
  const cancelLabel = opts.cancelLabel ?? 'Cancel';
  const showInput = variant.kind === 'prompt';
  const showCancel = variant.kind !== 'alert';

  dlg.innerHTML = `
    <div class="app-dialog-body">
      <h3 class="app-dialog-title"></h3>
      <p class="app-dialog-text"></p>
      ${showInput ? '<input type="text" id="app-dialog-input" class="app-dialog-input" />' : ''}
      <div class="app-dialog-actions">
        ${showCancel ? `<button type="button" id="app-dialog-cancel" class="app-dialog-btn"></button>` : ''}
        <button type="button" id="app-dialog-ok" class="app-dialog-btn app-dialog-primary${opts.danger ? ' app-dialog-danger' : ''}"></button>
      </div>
    </div>`;

  // textContent (not innerHTML) for user-facing strings — no HTML injection.
  const titleEl = dlg.querySelector<HTMLElement>('.app-dialog-title')!;
  if (opts.title) titleEl.textContent = opts.title; else titleEl.remove();
  dlg.querySelector<HTMLElement>('.app-dialog-text')!.textContent = message;
  dlg.querySelector<HTMLElement>('#app-dialog-ok')!.textContent = okLabel;
  const cancelBtn = dlg.querySelector<HTMLButtonElement>('#app-dialog-cancel');
  if (cancelBtn) cancelBtn.textContent = cancelLabel;

  const inputEl = dlg.querySelector<HTMLInputElement>('#app-dialog-input');
  if (inputEl && variant.kind === 'prompt') inputEl.value = variant.defaultValue;

  dlg.querySelector('#app-dialog-ok')!.addEventListener('click', () => {
    if (variant.kind === 'confirm') settle(true);
    else if (variant.kind === 'prompt') settle(inputEl?.value ?? '');
    else settle(undefined);
  });
  cancelBtn?.addEventListener('click', () => settle(cancelValue));
  // Enter in the prompt input confirms.
  inputEl?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); settle(inputEl.value); }
  });

  return new Promise((resolve) => {
    settleCurrent = resolve as (v: unknown) => void;
    if (!dlg.open) dlg.showModal();
    inputEl?.focus();
  });
}

/** Modal replacement for window.alert. Resolves when dismissed. */
export function alertDialog(message: string, opts?: DialogOpts): Promise<void> {
  return run(message, { kind: 'alert' }, opts) as Promise<void>;
}

/** Modal replacement for window.confirm. Resolves true (OK) / false (Cancel/Esc). */
export function confirmDialog(message: string, opts?: DialogOpts): Promise<boolean> {
  return run(message, { kind: 'confirm' }, opts).then((v) => v === true);
}

/** Modal replacement for window.prompt. Resolves the text, or null if cancelled. */
export function promptDialog(message: string, defaultValue = '', opts?: DialogOpts): Promise<string | null> {
  return run(message, { kind: 'prompt', defaultValue }, opts) as Promise<string | null>;
}
