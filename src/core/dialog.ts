// src/core/dialog.ts
// One reusable modal facility replacing the native window.alert/confirm/prompt
// (which are ugly, blocking, and out of Loom's visual language). Built on a single
// reused <dialog> element (showModal), styled via .app-dialog (see _dialog.scss).
// All three are async (a custom modal can't block the thread like the natives):
//   await alertDialog('msg')           → void
//   if (await confirmDialog('msg')) …  → boolean
//   const v = await promptDialog('q')  → string | null  (null = cancelled)
// Stable ids (#app-dialog, #app-dialog-ok/-cancel/-input) make it e2e-drivable.
// Content is a lit-html render into the dialog: each invocation patches the
// previous one's DOM instead of an innerHTML wipe + querySelector rewire.

import { html, render, nothing } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import { renderElement } from './lit-fragment';

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
  // Esc (the native 'cancel' event precedes close) resolves with the variant's
  // cancel value (false for confirm, null for prompt, undefined for alert).
  const dlg = renderElement<HTMLDialogElement>(html`<dialog
    id="app-dialog"
    class="app-dialog"
    @cancel=${(e: Event) => { e.preventDefault(); settle(cancelValue); }}
  ></dialog>`);
  document.body.appendChild(dlg);
  dialogEl = dlg;
  return dlg;
}

function promptValue(dlg: HTMLDialogElement): string {
  return dlg.querySelector<HTMLInputElement>('#app-dialog-input')?.value ?? '';
}

function run(message: string, variant: Variant, opts: DialogOpts = {}): Promise<unknown> {
  const dlg = ensureDialog();
  if (settleCurrent) settle(cancelValue); // supersede any pending dialog as cancelled
  cancelValue = variant.kind === 'confirm' ? false : variant.kind === 'prompt' ? null : undefined;

  const showInput = variant.kind === 'prompt';
  const showCancel = variant.kind !== 'alert';

  const onOk = () => {
    if (variant.kind === 'confirm') settle(true);
    else if (variant.kind === 'prompt') settle(promptValue(dlg));
    else settle(undefined);
  };

  // User-facing strings ride in text parts (escaped by lit) — no HTML injection.
  // live() on the input: the dialog DOM persists across invocations, so a plain
  // .value binding would skip re-priming when two prompts share a defaultValue.
  render(html`
    <div class="app-dialog-body">
      ${opts.title ? html`<h3 class="app-dialog-title">${opts.title}</h3>` : nothing}
      <p class="app-dialog-text">${message}</p>
      ${showInput ? html`<input
        type="text" id="app-dialog-input" class="app-dialog-input"
        .value=${live(variant.kind === 'prompt' ? variant.defaultValue : '')}
        @keydown=${(e: KeyboardEvent) => {
          // Enter in the prompt input confirms.
          if (e.key === 'Enter') { e.preventDefault(); settle(promptValue(dlg)); }
        }}
      />` : nothing}
      <div class="app-dialog-actions">
        ${showCancel ? html`<button
          type="button" id="app-dialog-cancel" class="app-dialog-btn"
          @click=${() => settle(cancelValue)}
        >${opts.cancelLabel ?? 'Cancel'}</button>` : nothing}
        <button
          type="button" id="app-dialog-ok"
          class="app-dialog-btn app-dialog-primary${opts.danger ? ' app-dialog-danger' : ''}"
          @click=${onOk}
        >${opts.okLabel ?? 'OK'}</button>
      </div>
    </div>`, dlg);

  return new Promise((resolve) => {
    settleCurrent = resolve as (v: unknown) => void;
    if (!dlg.open) dlg.showModal();
    dlg.querySelector<HTMLInputElement>('#app-dialog-input')?.focus();
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

  render(html`
    <div class="app-dialog-body">
      ${opts.title ? html`<h3 class="app-dialog-title">${opts.title}</h3>` : nothing}
      <p class="app-dialog-text">${message}</p>
      <div class="app-dialog-actions">
        <button
          type="button" id="app-dialog-cancel" class="app-dialog-btn"
          @click=${() => settle(null)}
        >${opts.cancelLabel ?? 'Cancel'}</button>
        ${choices.map((c) => html`<button
          type="button"
          id="app-dialog-choice-${c.id}"
          class="app-dialog-btn${c.primary ? ' app-dialog-primary' : ''}${c.danger ? ' app-dialog-danger' : ''}"
          data-choice=${c.id}
          @click=${() => settle(c.id)}
        >${c.label}</button>`)}
      </div>
    </div>`, dlg);

  return new Promise<string | null>((resolve) => {
    settleCurrent = resolve as (v: unknown) => void;
    if (!dlg.open) dlg.showModal();
  });
}
