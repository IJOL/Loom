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
    expect(summary.textContent).toContain('La menor');
    const scaleSel = host.querySelector('select[data-musicality="scale"]') as HTMLSelectElement;
    scaleSel.value = 'major';
    scaleSel.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ scale: 'major' }));
    handle.refresh();
    expect(summary.textContent).toContain('La');
  });
});
