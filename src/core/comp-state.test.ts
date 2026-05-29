import { describe, it, expect } from 'vitest';
import {
  DEFAULT_COMP_STATE,
  withCompDefaults,
  withSidechainDefaultsOrNull,
  type CompState,
  type SidechainState,
} from './comp-state';

describe('DEFAULT_COMP_STATE', () => {
  it('starts bypassed so existing patterns are unaffected', () => {
    expect(DEFAULT_COMP_STATE.bypass).toBe(true);
  });

  it('has musically sane defaults', () => {
    expect(DEFAULT_COMP_STATE.ratio).toBeGreaterThan(1);
    expect(DEFAULT_COMP_STATE.threshold).toBeLessThan(0);
    expect(DEFAULT_COMP_STATE.attack).toBeGreaterThan(0);
    expect(DEFAULT_COMP_STATE.release).toBeGreaterThan(0);
    expect(DEFAULT_COMP_STATE.knee).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_COMP_STATE.makeup).toBeGreaterThan(0);
  });
});

describe('withCompDefaults', () => {
  it('returns the defaults when the input is undefined', () => {
    expect(withCompDefaults(undefined)).toEqual(DEFAULT_COMP_STATE);
  });

  it('overlays provided fields atop the defaults', () => {
    const partial: Partial<CompState> = { bypass: false, ratio: 8 };
    const merged = withCompDefaults(partial);
    expect(merged.bypass).toBe(false);
    expect(merged.ratio).toBe(8);
    expect(merged.threshold).toBe(DEFAULT_COMP_STATE.threshold);
  });

  it('does not mutate its input', () => {
    const partial: Partial<CompState> = { ratio: 2 };
    const before = { ...partial };
    withCompDefaults(partial);
    expect(partial).toEqual(before);
  });
});

describe('withSidechainDefaultsOrNull', () => {
  it('returns null when input is null or undefined', () => {
    expect(withSidechainDefaultsOrNull(null)).toBeNull();
    expect(withSidechainDefaultsOrNull(undefined)).toBeNull();
  });

  it('fills missing fields with sane defaults when input is partial', () => {
    const partial: Partial<SidechainState> = { source: 'drums' };
    const sc = withSidechainDefaultsOrNull(partial)!;
    expect(sc.source).toBe('drums');
    expect(sc.depth).toBeGreaterThan(0);
    expect(sc.depth).toBeLessThanOrEqual(1);
    expect(sc.attack).toBeGreaterThan(0);
    expect(sc.release).toBeGreaterThan(0);
  });
});
