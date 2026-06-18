// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderMusicalityBar } from './musicality-bar';
import { DEFAULT_MUSICALITY } from './session';

describe('musicality bar', () => {
  it('shows the current tonality label and emits changes', () => {
    const host = document.createElement('div');
    const onChange = vi.fn();
    const handle = renderMusicalityBar(host, { get: () => ({ ...DEFAULT_MUSICALITY }), onChange });
    const summary = host.querySelector('.musicality-summary') as HTMLButtonElement;
    expect(summary.textContent).toContain('A minor');
    const scaleSel = host.querySelector('select[data-musicality="scale"]') as HTMLSelectElement;
    scaleSel.value = 'major';
    scaleSel.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ scale: 'major' }));
    handle.refresh();
    expect(summary.textContent).toContain('A');
  });

  it('shows the scale-lock state and toggles it globally', () => {
    const host = document.createElement('div');
    const onChange = vi.fn();
    // Default musicality has lock OFF.
    renderMusicalityBar(host, { get: () => ({ ...DEFAULT_MUSICALITY }), onChange });
    const summary = host.querySelector('.musicality-summary') as HTMLButtonElement;
    expect(summary.textContent).toContain('🔓'); // unlocked glyph visible at a glance

    const lockChk = host.querySelector('[data-musicality="lock"]') as HTMLInputElement;
    expect(lockChk).toBeTruthy();
    expect(lockChk.checked).toBe(false);

    lockChk.checked = true;
    lockChk.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ lock: true }));
  });

  it('reflects an already-locked state from get()', () => {
    const host = document.createElement('div');
    renderMusicalityBar(host, {
      get: () => ({ ...DEFAULT_MUSICALITY, lock: true }), onChange: vi.fn(),
    });
    const summary = host.querySelector('.musicality-summary') as HTMLButtonElement;
    expect(summary.textContent).toContain('🔒');
    const lockChk = host.querySelector('[data-musicality="lock"]') as HTMLInputElement;
    expect(lockChk.checked).toBe(true);
  });
});
