// src/plugins/fx/delay.test.ts
import { describe, it, expect } from 'vitest';
import { delayPlugin } from './delay';

describe('delay sync', () => {
  it('Free mode leaves time under manual control', () => {
    const ctx = new AudioContext();
    const inst = delayPlugin.kind === 'fx' ? delayPlugin.create(ctx) : null!;
    inst.setBaseValue('sync', 0);
    inst.setBaseValue('time', 0.5);
    inst.setBpm?.(120);
    expect(inst.getBaseValue('time')).toBeCloseTo(0.5, 3);
  });

  it('synced mode derives time from bpm (1/8 at 120 BPM = 0.25s)', () => {
    const ctx = new AudioContext();
    const inst = delayPlugin.kind === 'fx' ? delayPlugin.create(ctx) : null!;
    inst.setBaseValue('sync', 2); // index 2 = 1/8 per the options table
    inst.setBpm?.(120);
    expect(inst.getBaseValue('time')).toBeCloseTo(0.25, 2);
  });
});
