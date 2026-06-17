// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { beginInlineRename } from './inline-rename';

function mountLabel(text: string): HTMLElement {
  document.body.innerHTML = `<div class="parent"><span class="lbl">${text}</span></div>`;
  return document.querySelector('.lbl') as HTMLElement;
}

describe('beginInlineRename', () => {
  it('Enter commits the trimmed new value and removes the input', () => {
    const label = mountLabel('Old');
    const commit = vi.fn();
    const input = beginInlineRename(label, 'Old', { commit });
    input.value = '  New  ';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(commit).toHaveBeenCalledWith('New');
    expect(document.querySelector('.inline-rename-input')).toBeNull();
    expect(label.style.display).toBe('');
  });

  it('Escape cancels without committing', () => {
    const label = mountLabel('Old');
    const commit = vi.fn();
    const input = beginInlineRename(label, 'Old', { commit });
    input.value = 'New';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(commit).not.toHaveBeenCalled();
    expect(document.querySelector('.inline-rename-input')).toBeNull();
  });

  it('blur commits the changed value', () => {
    const label = mountLabel('Old');
    const commit = vi.fn();
    const input = beginInlineRename(label, 'Old', { commit });
    input.value = 'Changed';
    input.dispatchEvent(new FocusEvent('blur'));
    expect(commit).toHaveBeenCalledWith('Changed');
  });

  it('does not commit an unchanged or empty value', () => {
    const label = mountLabel('Same');
    const c1 = vi.fn();
    beginInlineRename(label, 'Same', { commit: c1 })
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(c1).not.toHaveBeenCalled();

    const label2 = mountLabel('X');
    const c2 = vi.fn();
    const input2 = beginInlineRename(label2, 'X', { commit: c2 });
    input2.value = '   ';
    input2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(c2).not.toHaveBeenCalled();
  });
});
