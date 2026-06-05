/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { wireControlSurfaceUI } from './control-surface-ui';

function dom() {
  document.body.innerHTML = `
    <button id="midi-control-enable"></button>
    <span id="midi-control-status"></span>
    <select id="midi-control-override"></select>`;
}

describe('control-surface-ui', () => {
  it('clicking enable calls onEnable and shows the result status', async () => {
    dom();
    const onEnable = vi.fn(async () => ({ ok: true as const, label: 'APC Key 25 (mk1) ✓' }));
    wireControlSurfaceUI({ onEnable, onDisable: () => {}, profiles: [{ id: 'apc-key25', label: 'APC' }], initialEnabled: false });
    document.getElementById('midi-control-enable')!.dispatchEvent(new Event('click'));
    await Promise.resolve(); await Promise.resolve();
    expect(onEnable).toHaveBeenCalled();
    expect(document.getElementById('midi-control-status')!.textContent).toContain('APC Key 25');
  });

  it('shows an error status when enable fails', async () => {
    dom();
    const onEnable = vi.fn(async () => ({ ok: false as const, label: 'MIDI not supported' }));
    wireControlSurfaceUI({ onEnable, onDisable: () => {}, profiles: [], initialEnabled: false });
    document.getElementById('midi-control-enable')!.dispatchEvent(new Event('click'));
    await Promise.resolve(); await Promise.resolve();
    expect(document.getElementById('midi-control-status')!.textContent).toContain('not supported');
  });
});
