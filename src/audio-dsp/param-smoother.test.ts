// src/audio-dsp/param-smoother.test.ts
// The per-sample knob slew that lets a live param change reach a sounding note
// without a step discontinuity (a click). Pure: no audio, no AudioContext.
import { describe, it, expect } from 'vitest';
import { ParamSmoother } from './param-smoother';

const SR = 48000;

describe('ParamSmoother', () => {
  it('reset seeds values with no ramp and nothing in flight', () => {
    const s = new ParamSmoother(SR);
    s.reset({ 'filter.cutoff': 0.4 });
    expect(s.values['filter.cutoff']).toBe(0.4);
    expect(s.moving).toBe(false);
    expect(s.tick()).toBe(false);
  });

  it('a param seen for the FIRST time lands instantly (boot must not ramp from zero)', () => {
    const s = new ParamSmoother(SR);
    s.setTargets({ 'filter.cutoff': 0.8 });
    expect(s.values['filter.cutoff']).toBe(0.8);
    expect(s.moving).toBe(false);
  });

  it('reports the change when a first-ever write lands instantly', () => {
    // A never-seen id lands with no ramp, so it never enters the in-flight list.
    // tick() must still report that the bag changed, or a consumer caching a
    // derived snapshot (the subtractive lane) keeps a stale value and the write
    // is silently lost.
    const s = new ParamSmoother(SR);
    s.setTargets({ 'filter.cutoff': 0.8 });
    expect(s.moving).toBe(false);
    expect(s.tick()).toBe(true);
    // One-shot: the next tick has nothing to report.
    expect(s.tick()).toBe(false);
  });

  it('a change to a KNOWN param ramps instead of jumping', () => {
    const s = new ParamSmoother(SR);
    s.reset({ 'filter.cutoff': 0.2 });
    s.setTargets({ 'filter.cutoff': 0.9 });
    s.tick();
    const afterOne = s.values['filter.cutoff'];
    // Moved toward the target, but nowhere near it after a single sample.
    expect(afterOne).toBeGreaterThan(0.2);
    expect(afterOne).toBeLessThan(0.25);
  });

  it('converges exactly onto the target and leaves the in-flight list', () => {
    const s = new ParamSmoother(SR);
    s.reset({ 'filter.cutoff': 0.2 });
    s.setTargets({ 'filter.cutoff': 0.9 });
    // 0.3 s. Landing on the epsilon is NOT the same as sounding settled: the ear
    // is done after ~5 time constants (75 ms), but reaching |target|*1e-5 from a
    // 0.7 distance takes ~11 (169 ms), and the 1->0 case below needs ~16 because
    // its epsilon collapses to the absolute floor. 0.3 s clears all of them.
    for (let i = 0; i < SR * 0.3; i++) s.tick();
    expect(s.values['filter.cutoff']).toBe(0.9);
    expect(s.moving).toBe(false);
    expect(s.tick()).toBe(false);
  });

  it('is monotonic across the ramp — no overshoot to click on', () => {
    const s = new ParamSmoother(SR);
    s.reset({ 'amp.level': 1 });
    s.setTargets({ 'amp.level': 0 });
    // 0.3 s: a target of exactly 0 collapses the relative epsilon to its absolute
    // floor (1e-7), so this is the slowest case to land — ~16 time constants.
    let prev = 1;
    for (let i = 0; i < SR * 0.3; i++) {
      s.tick();
      const v = s.values['amp.level'];
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
    expect(prev).toBe(0);
  });

  it('carries several params at once (a preset load) and drops each as it arrives', () => {
    const s = new ParamSmoother(SR);
    s.reset({ a: 0, b: 0, c: 0 });
    s.setTargets({ a: 1, b: 1 });
    expect(s.moving).toBe(true);
    for (let i = 0; i < SR * 0.3; i++) s.tick();
    expect(s.values.a).toBe(1);
    expect(s.values.b).toBe(1);
    expect(s.values.c).toBe(0);
    expect(s.moving).toBe(false);
  });

  it('re-targeting mid-ramp retargets from where it is, without restarting', () => {
    const s = new ParamSmoother(SR);
    s.reset({ x: 0 });
    s.setTargets({ x: 1 });
    for (let i = 0; i < 200; i++) s.tick();
    const mid = s.values.x;
    s.setTargets({ x: 0 });
    s.tick();
    // Turned around from `mid`, it did not jump back to 0 or restart at 1.
    expect(s.values.x).toBeLessThan(mid);
    expect(s.values.x).toBeGreaterThan(0);
  });

  it('setting the SAME value adds no work', () => {
    const s = new ParamSmoother(SR);
    s.reset({ x: 0.5 });
    s.setTargets({ x: 0.5 });
    expect(s.moving).toBe(false);
  });

  it('drops a converged param without allocating (swap-and-pop keeps the bag intact)', () => {
    const s = new ParamSmoother(SR);
    s.reset({ a: 0, b: 0, c: 0 });
    s.setTargets({ a: 1, b: 1, c: 1 });
    for (let i = 0; i < SR * 0.3; i++) s.tick();
    // Every id must land — a swap-and-pop that skipped an element would leave
    // one behind at its start value.
    expect(s.values.a).toBe(1);
    expect(s.values.b).toBe(1);
    expect(s.values.c).toBe(1);
    expect(s.moving).toBe(false);
  });

  it('ignores a non-finite target and keeps the last good value', () => {
    const s = new ParamSmoother(SR);
    s.reset({ 'filter.cutoff': 0.5 });
    s.setTargets({ 'filter.cutoff': NaN });
    expect(s.values['filter.cutoff']).toBe(0.5);
    expect(s.moving).toBe(false);
    s.setTargets({ 'filter.cutoff': Infinity });
    expect(s.values['filter.cutoff']).toBe(0.5);
    expect(s.moving).toBe(false);
    // Still usable afterwards: a good value ramps normally.
    s.setTargets({ 'filter.cutoff': 0.9 });
    for (let i = 0; i < SR * 0.3; i++) s.tick();
    expect(s.values['filter.cutoff']).toBe(0.9);
  });
});
