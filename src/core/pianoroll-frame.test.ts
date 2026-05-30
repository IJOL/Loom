/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { buildEditorFrame } from './pianoroll';

describe('buildEditorFrame', () => {
  it('builds the three editor surfaces inside the host', () => {
    const host = document.createElement('div');
    const f = buildEditorFrame(host);

    expect(host.querySelector('.pr-frame')).not.toBeNull();
    expect(f.rulerCanvas.tagName).toBe('CANVAS');
    expect(f.keysCanvas.tagName).toBe('CANVAS');
    expect(f.gridCanvas.tagName).toBe('CANVAS');
    // the grid viewport is the only scroller (both axes)
    expect(f.gridVp.style.overflow).toBe('auto');
    // ruler/keys live outside the scroller so they can stay pinned
    expect(f.rulerWrap.contains(f.gridVp)).toBe(false);
  });

  it('clears the host before building (idempotent re-render)', () => {
    const host = document.createElement('div');
    host.innerHTML = '<span class="stale"></span>';
    buildEditorFrame(host);
    expect(host.querySelector('.stale')).toBeNull();
    expect(host.querySelectorAll('.pr-frame').length).toBe(1);
  });
});
