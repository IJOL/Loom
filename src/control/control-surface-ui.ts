export interface ControlUiDeps {
  onEnable: (overrideProfileId: string | null) => Promise<{ ok: boolean; label: string }>;
  onDisable: () => void;
  profiles: Array<{ id: string; label: string }>;
  initialEnabled: boolean;
}

export function wireControlSurfaceUI(deps: ControlUiDeps): void {
  const enableBtn = document.getElementById('midi-control-enable') as HTMLButtonElement | null;
  const statusEl = document.getElementById('midi-control-status') as HTMLElement | null;
  const overrideEl = document.getElementById('midi-control-override') as HTMLSelectElement | null;
  if (!enableBtn || !statusEl) { console.warn('[control-ui] DOM ids missing, skipping'); return; }

  let enabled = deps.initialEnabled;

  if (overrideEl) {
    overrideEl.innerHTML = '<option value="">Auto-detect</option>'
      + deps.profiles.map((p) => `<option value="${p.id}">${p.label}</option>`).join('');
  }

  const setStatus = (s: string) => { statusEl.textContent = s; };
  const setEnabledUI = (on: boolean) => {
    enabled = on;
    enableBtn.textContent = on ? 'Disable MIDI controller' : 'Enable MIDI controller';
    if (overrideEl) overrideEl.style.display = on ? '' : 'none';
  };
  setEnabledUI(enabled);
  setStatus(enabled ? 'enabled' : 'off');

  enableBtn.addEventListener('click', async () => {
    if (enabled) {
      deps.onDisable();
      setEnabledUI(false);
      setStatus('off');
      return;
    }
    setStatus('requesting permission…');
    const override = overrideEl?.value || null;
    const res = await deps.onEnable(override);
    if (res.ok) { setEnabledUI(true); setStatus(res.label); }
    else { setEnabledUI(false); setStatus(res.label); }
  });
}
