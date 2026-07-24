// Shared in-place rename: replace a label element with a text <input>, commit on
// Enter/blur, cancel on Escape. Used by the session grid (track/scene names) and
// the clip inspector's context breadcrumb. The caller's `commit` is expected to
// mutate state + re-render (which rebuilds the label); on cancel/no-change the
// original label is simply re-shown.

import { html, nothing } from 'lit-html';
import { renderElement } from '../core/lit-fragment';

export interface InlineRenameOptions {
  /** Fired with the trimmed value on Enter/blur — only when non-empty AND
   *  different from `currentValue`. */
  commit: (value: string) => void;
  placeholder?: string;
}

export function beginInlineRename(
  labelEl: HTMLElement,
  currentValue: string,
  opts: InlineRenameOptions,
): HTMLInputElement {
  let done = false;
  const finish = (commit: boolean): void => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    // Blur before remove so focusout fires while the element is still connected —
    // this lets the AutoHistory focusout listener call endGesture() deterministically
    // across all browsers (Enter path bypasses blur otherwise).
    input.blur();
    input.remove();
    labelEl.style.display = '';
    if (commit && v && v !== currentValue) opts.commit(v);
  };

  // A transient node the caller's DOM adopts — instantiated once, never
  // re-rendered, so a one-shot fragment render replaces createElement.
  const input = renderElement<HTMLInputElement>(html`<input
    type="text"
    class="inline-rename-input"
    .value=${currentValue}
    placeholder=${opts.placeholder ?? nothing}
    @keydown=${(e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      // Keep typing from reaching global shortcuts (e.g. clip Delete/Backspace).
      e.stopPropagation();
    }}
    @blur=${() => finish(true)}
    @pointerdown=${
      // Never let the editor's pointer events bubble to an underlying drag/launch.
      (e: Event) => e.stopPropagation()}
    @click=${(e: Event) => e.stopPropagation()}
  />`);

  const parent = labelEl.parentElement;
  labelEl.style.display = 'none';
  // Insert right after the hidden label so it occupies the same slot.
  if (parent) parent.insertBefore(input, labelEl.nextSibling);
  else labelEl.replaceWith(input);
  input.focus();
  input.select();

  return input;
}
