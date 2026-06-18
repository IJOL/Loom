import { describe, it, expect } from 'vitest';
import { defaultSends, remapLaneSendParams } from './send-migration';

describe('send migration', () => {
  it('defaultSends seeds A=delay, B=reverb', () => {
    const s = defaultSends();
    expect(s.map((b) => b.id)).toEqual(['A', 'B']);
    expect(s[0].inserts[0].pluginId).toBe('delay');
    expect(s[1].inserts[0].pluginId).toBe('reverb');
  });

  it('remaps mix.<lane>.rev → sendB and .dly → sendA, leaving others', () => {
    const out = remapLaneSendParams({
      'mix.bass.rev': 0.5, 'mix.bass.dly': 0.2, 'mix.bass.pan': -0.3,
    });
    expect(out['mix.bass.sendB']).toBe(0.5);
    expect(out['mix.bass.sendA']).toBe(0.2);
    expect(out['mix.bass.pan']).toBe(-0.3);
    expect(out['mix.bass.rev']).toBeUndefined();
    expect(out['mix.bass.dly']).toBeUndefined();
  });
});
