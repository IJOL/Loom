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

export interface DialogChoice {
  /** Returned by choiceDialog when this button is picked. */
  id: string;
  label: string;
  /** Emphasised (accent) button. */
  primary?: boolean;
  /** Destructive (red) button. */
  danger?: boolean;
}

/**
 * Modal with N explicit action buttons plus a Cancel. Resolves the picked
 * choice's `id`, or `null` if cancelled (Cancel button / Esc). Use instead of a
 * binary confirm when both outcomes are positive actions that deserve their own
 * named button (e.g. Add vs Replace) — hiding the meaning behind OK/Cancel is a
 * UX trap. Choice buttons render after Cancel (Cancel left, actions right).
 * Each gets a stable id `#app-dialog-choice-<id>` for e2e.
 */
export function choiceDialog(
  message: string,
  choices: DialogChoice[],
  opts: { title?: string; cancelLabel?: string } = {},
): Promise<string | null> {
  const dlg = ensureDialog();
  if (settleCurrent) settle(cancelValue); // supersede any pending dialog as cancelled
  cancelValue = null;

  dlg.innerHTML = `
    <div class="app-dialog-body">
      <h3 class="app-dialog-title"></h3>
      <p class="app-dialog-text"></p>
      <div class="app-dialog-actions"></div>
    </div>`;
  const titleEl = dlg.querySelector<HTMLElement>('.app-dialog-title')!;
  if (opts.title) titleEl.textContent = opts.title; else titleEl.remove();
  dlg.querySelector<HTMLElement>('.app-dialog-text')!.textContent = message;

  const actions = dlg.querySelector<HTMLElement>('.app-dialog-actions')!;
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.id = 'app-dialog-cancel';
  cancelBtn.className = 'app-dialog-btn';
  cancelBtn.textContent = opts.cancelLabel ?? 'Cancel';
  cancelBtn.addEventListener('click', () => settle(null));
  actions.appendChild(cancelBtn);

  for (const c of choices) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = `app-dialog-choice-${c.id}`;
    btn.className = 'app-dialog-btn'
      + (c.primary ? ' app-dialog-primary' : '')
      + (c.danger ? ' app-dialog-danger' : '');
    btn.dataset.choice = c.id;
    btn.textContent = c.label; // textContent — no HTML injection
    btn.addEventListener('click', () => settle(c.id));
    actions.appendChild(btn);
  }

  return new Promise<string | null>((resolve) => {
    settleCurrent = resolve as (v: unknown) => void;
    if (!dlg.open) dlg.showModal();
  });
}
