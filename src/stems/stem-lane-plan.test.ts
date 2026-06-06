import { describe, it, expect } from 'vitest';
import { planStemLanes } from './stem-lane-plan';

describe('planStemLanes', () => {
  it('orders known stems and labels them in English', () => {
    const plan = planStemLanes([
      { name: 'other', url: '/o' },
      { name: 'vocals', url: '/v' },
      { name: 'bass', url: '/b' },
      { name: 'drums', url: '/d' },
    ]);
    expect(plan.map((p) => p.label)).toEqual(['Vocals', 'Drums', 'Bass', 'Other']);
    expect(plan.map((p) => p.url)).toEqual(['/v', '/d', '/b', '/o']);
  });

  it('keeps unknown stems at the end with a capitalised fallback label', () => {
    const plan = planStemLanes([
      { name: 'vocals', url: '/v' },
      { name: 'guitar', url: '/g' },
    ]);
    expect(plan.map((p) => p.label)).toEqual(['Vocals', 'Guitar']);
  });
});
