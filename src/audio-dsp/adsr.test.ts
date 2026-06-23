import { describe, it, expect } from 'vitest';
import { Adsr } from './adsr';

describe('Adsr', () => {
  it('rises during attack and reaches ~1 at the attack peak', () => {
    // Evaluate per-sample (real usage): the gate-driven state machine returns 0
    // on the off→attack init frame, then interpolates — so call it densely, not
    // with two sparse samples.
    const SR = 48000;
    const e = new Adsr();
    const out: number[] = [];
    for (let i = 0; i <= 480; i++) out.push(e.update(i / SR, 1, 0.01, 0.1, 0.5, 0.2)); // 480 samples = 10ms attack
    const mid = out[240];   // ~halfway up the attack
    const peak = out[480];  // attack end
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(peak);
    expect(peak).toBeGreaterThan(0.9);
  });

  it('settles to the sustain level while the gate is held', () => {
    const e = new Adsr();
    let v = 0;
    for (let t = 0; t <= 0.3; t += 1 / 48000) v = e.update(t, 1, 0.01, 0.05, 0.4, 0.2);
    expect(v).toBeCloseTo(0.4, 1);
  });

  it('releases immediately on a note-off during a long attack (does not wait for the attack to finish)', () => {
    const SR = 48000;
    const e = new Adsr();
    // Long 2 s attack; gate held only for the first 50 ms, then released well
    // before the attack would complete. With a short release the level must
    // reach ~0 long before the 2 s attack would have elapsed.
    let v = 1;
    for (let i = 0; i < SR * 0.05; i++) v = e.update(i / SR, 1, 2.0, 0.3, 0.6, 0.05);
    const atGateOff = v;
    expect(atGateOff).toBeGreaterThan(0);
    expect(atGateOff).toBeLessThan(0.1);                 // still early in the 2 s attack
    for (let i = SR * 0.05; i < SR * 0.2; i++) v = e.update(i / SR, 0, 2.0, 0.3, 0.6, 0.05); // gate off
    expect(v).toBeLessThan(0.001);                        // released, not still attacking
    expect(e.isOff).toBe(true);
  });

  it('falls to 0 and reports off after the release tail', () => {
    const e = new Adsr();
    for (let t = 0; t <= 0.1; t += 1 / 48000) e.update(t, 1, 0.01, 0.02, 0.5, 0.05); // hold
    let v = 1;
    for (let t = 0.1; t <= 0.2; t += 1 / 48000) v = e.update(t, 0, 0.01, 0.02, 0.5, 0.05); // gate off
    expect(v).toBeLessThan(0.001);
    expect(e.isOff).toBe(true);
  });
});
