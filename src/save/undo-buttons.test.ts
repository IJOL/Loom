// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { wireUndoButtons } from './undo-buttons';

describe('wireUndoButtons', () => {
  it('clicks call undo/redo and disabled state tracks canUndo/canRedo', () => {
    document.body.innerHTML = `<button id="undo-btn" disabled></button><button id="redo-btn" disabled></button>`;
    let can = { undo: false, redo: false };
    const undo = vi.fn();
    const redo = vi.fn();
    const onChange = vi.fn((cb: () => void) => { (globalThis as never as { _fire: () => void })._fire = cb; return () => {}; });
    wireUndoButtons({
      undo, redo, canUndo: () => can.undo, canRedo: () => can.redo, onChange,
    });
    const u = document.getElementById('undo-btn') as HTMLButtonElement;
    const r = document.getElementById('redo-btn') as HTMLButtonElement;
    expect(u.disabled).toBe(true);
    can = { undo: true, redo: false };
    (globalThis as never as { _fire: () => void })._fire();   // simulate onChange
    expect(u.disabled).toBe(false);
    expect(r.disabled).toBe(true);
    u.click();
    expect(undo).toHaveBeenCalledOnce();
    // redo button: enable it and verify click calls redo
    can = { undo: true, redo: true };
    (globalThis as never as { _fire: () => void })._fire();
    expect(r.disabled).toBe(false);
    r.click();
    expect(redo).toHaveBeenCalledOnce();
  });
});
