// src/control/persistence.ts
export interface ControlPrefs { enabled: boolean; overrideProfileId: string | null; }

const KEY = 'loom.control.prefs';
const DEFAULTS: ControlPrefs = { enabled: false, overrideProfileId: null };

function storage(explicit?: Storage): Storage | null {
  if (explicit) return explicit;
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

export function loadControlPrefs(explicit?: Storage): ControlPrefs {
  const s = storage(explicit);
  if (!s) return { ...DEFAULTS };
  try {
    const raw = s.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const p = JSON.parse(raw);
    return {
      enabled: !!p.enabled,
      overrideProfileId: typeof p.overrideProfileId === 'string' ? p.overrideProfileId : null,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveControlPrefs(prefs: ControlPrefs, explicit?: Storage): void {
  const s = storage(explicit);
  if (!s) return;
  try { s.setItem(KEY, JSON.stringify(prefs)); } catch { /* private mode / quota — ignore */ }
}
