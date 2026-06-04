import { describe, it, expect, beforeEach } from 'vitest';
import { loadDrumKits, __resetDrumKitsCache } from '../presets/drum-kits-loader';
import { pickRandomDrumKit } from './randomize-ui';

describe('pickRandomDrumKit', () => {
  beforeEach(async () => {
    __resetDrumKitsCache();
    await loadDrumKits((async () => ({ ok: true, json: async () => ({ presets: [
      { name: 'TR-909', group: 'Synth', kind: 'synth', kitId: '909' },
      { name: 'TR-808 (samples)', group: 'Samples', kind: 'sample', drumkitId: 'tr808' },
    ] }) })) as unknown as typeof fetch);
  });

  it('returns a unified entry name (can be a sample kit)', () => {
    const names = new Set<string>();
    for (let i = 0; i < 50; i++) { const n = pickRandomDrumKit(() => Math.random()); if (n) names.add(n); }
    for (const n of names) expect(['TR-909', 'TR-808 (samples)']).toContain(n);
    expect(names.size).toBeGreaterThan(0);
  });

  it('returns null when the list is empty', () => {
    __resetDrumKitsCache();
    expect(pickRandomDrumKit(() => 0)).toBeNull();
  });
});
