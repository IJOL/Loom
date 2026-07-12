export interface ControlUiDeps {
  onEnable: (overrideProfileId: string | null) => Promise<{ ok: boolean; label: string }>;
  onDisable: () => void;
  profiles: Array<{ id: string; label: string }>;
  initialEnabled: boolean;
  /** Loop-record over live MIDI (Task 5/6). Optional so callers/tests that
   *  don't wire capture yet still compile; the Rec button stays absent. */
  capture?: { toggle: () => void; isRecording: () => boolean; canRecord: () => boolean };
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
  // `setEnabledUI` is `const` (not reassignable), so the Rec button's `refresh()`
  // below is called explicitly at the two places `enabled` changes instead of
  // wrapping this function.
  const setEnabledUI = (on: boolean) => {
    enabled = on;
    enableBtn.textContent = on ? 'Disable MIDI controller' : 'Enable MIDI controller';
    if (overrideEl) overrideEl.style.display = on ? '' : 'none';
  };
  setEnabledUI(enabled);
  setStatus(enabled ? 'enabled' : 'off');

  const recBtn = document.getElementById('midi-control-rec') as HTMLButtonElement | null;
  const refreshRec = () => {
    if (!recBtn || !deps.capture) return;
    recBtn.disabled = !enabled || !deps.capture.canRecord();
    recBtn.textContent = deps.capture.isRecording() ? '■ Stop' : '● Rec';
    recBtn.classList.toggle('recording', deps.capture.isRecording());
  };
  if (recBtn && deps.capture) {
    recBtn.addEventListener('click', () => { deps.capture!.toggle(); refreshRec(); });
    refreshRec();
  }

  enableBtn.addEventListener('click', async () => {
    if (enabled) {
      deps.onDisable();
      setEnabledUI(false);
      setStatus('off');
      refreshRec();
      return;
    }
    setStatus('requesting permission…');
    const override = overrideEl?.value || null;
    const res = await deps.onEnable(override);
    if (res.ok) { setEnabledUI(true); setStatus(res.label); }
    else { setEnabledUI(false); setStatus(res.label); }
    refreshRec();
  });
}
