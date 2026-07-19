import { describe, it, expect } from 'vitest';
import { defaultSends } from './send-migration';

describe('send migration', () => {
  it('defaultSends seeds A=delay, B=reverb', () => {
    const s = defaultSends();
    expect(s.map((b) => b.id)).toEqual(['A', 'B']);
    expect(s[0].inserts[0].pluginId).toBe('delay');
    expect(s[1].inserts[0].pluginId).toBe('reverb');
  });
});
