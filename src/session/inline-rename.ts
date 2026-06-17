// Shared in-place rename: replace a label element with a text <input>, commit on
// Enter/blur, cancel on Escape. Used by the session grid (track/scene names) and
// the clip inspector's context breadcrumb. The caller's `commit` is expected to
// mutate state + re-render (which rebuilds the label); on cancel/no-change the
// original label is simply re-shown.

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
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'inline-rename-input';
  input.value = currentValue;
  if (opts.placeholder) input.placeholder = opts.placeholder;

  const parent = labelEl.parentElement;
  labelEl.style.display = 'none';
  // Insert right after the hidden label so it occupies the same slot.
  if (parent) parent.insertBefore(input, labelEl.nextSibling);
  else labelEl.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const finish = (commit: boolean): void => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    input.remove();
    labelEl.style.display = '';
    if (commit && v && v !== currentValue) opts.commit(v);
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    // Keep typing from reaching global shortcuts (e.g. clip Delete/Backspace).
    e.stopPropagation();
  });
  input.addEventListener('blur', () => finish(true));
  // Never let the editor's pointer events bubble to an underlying drag/launch.
  input.addEventListener('pointerdown', (e) => e.stopPropagation());
  input.addEventListener('click', (e) => e.stopPropagation());

  return input;
}
