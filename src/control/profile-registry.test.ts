// src/control/profile-registry.test.ts
import { describe, it, expect } from 'vitest';
import { listProfiles, pickProfile } from './profile-registry';

describe('profile-registry', () => {
  it('discovers the APC and generic profiles', () => {
    const ids = listProfiles().map((p) => p.id);
    expect(ids).toContain('apc-key25');
    expect(ids).toContain('generic-keyboard');
  });
  it('picks the APC for an APC port', () => {
    const p = pickProfile({ name: 'APC Key 25 mk2', manufacturer: 'Akai', id: 'a' });
    expect(p?.id).toBe('apc-key25');
  });
  it('falls back to generic-keyboard for an unknown port', () => {
    const p = pickProfile({ name: 'Mystery Pad', manufacturer: '', id: 'b' });
    expect(p?.id).toBe('generic-keyboard');
  });
});
