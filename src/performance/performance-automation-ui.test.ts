import { describe, it, expect } from 'vitest';
import { groupParamsByPrefix } from './performance-automation-ui';

describe('groupParamsByPrefix', () => {
  it('groups param ids by their dotted prefix in insertion order', () => {
    const ids = ['tb-303-1.cutoff', 'tb-303-1.reso', 'fx.reverb.wet', 'mix.bass.vol'];
    const groups = groupParamsByPrefix(ids);
    expect(groups.get('tb-303-1')).toEqual(['tb-303-1.cutoff', 'tb-303-1.reso']);
    expect(groups.get('fx')).toEqual(['fx.reverb.wet']);
    expect(groups.get('mix')).toEqual(['mix.bass.vol']);
  });
});
