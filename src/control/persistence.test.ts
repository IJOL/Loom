// src/control/persistence.test.ts
import { describe, it, expect } from 'vitest';
import { loadControlPrefs, saveControlPrefs } from './persistence';

function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null, length: 0,
  } as unknown as Storage;
}

describe('control persistence', () => {
  it('round-trips enabled + override', () => {
    const s = memStorage();
    saveControlPrefs({ enabled: true, overrideProfileId: 'apc-key25' }, s);
    expect(loadControlPrefs(s)).toEqual({ enabled: true, overrideProfileId: 'apc-key25' });
  });
  it('returns defaults when nothing stored or stored value is garbage', () => {
    const s = memStorage();
    expect(loadControlPrefs(s)).toEqual({ enabled: false, overrideProfileId: null });
    s.setItem('loom.control.prefs', 'not json');
    expect(loadControlPrefs(s)).toEqual({ enabled: false, overrideProfileId: null });
  });
});
