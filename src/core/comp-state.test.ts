import { describe, it, expect } from 'vitest';
import {
  DEFAULT_COMP_STATE,
  DEFAULT_LANE_LP_STATE,
  withCompDefaults,
  withLaneLpDefaults,
  withSidechainDefaultsOrNull,
  type CompState,
  type LaneLpState,
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

describe('DEFAULT_LANE_LP_STATE', () => {
  it('starts wide open (cutoff above 1 kHz) so existing patterns are unaffected', () => {
    expect(DEFAULT_LANE_LP_STATE.cutoff).toBeGreaterThan(1000);
  });

  it('has a positive resonance and starts un-bypassed', () => {
    expect(DEFAULT_LANE_LP_STATE.resonance).toBeGreaterThan(0);
    expect(DEFAULT_LANE_LP_STATE.bypass).toBe(false);
  });
});

describe('withLaneLpDefaults', () => {
  it('returns the defaults when input is undefined', () => {
    expect(withLaneLpDefaults(undefined)).toEqual(DEFAULT_LANE_LP_STATE);
  });

  it('overlays provided fields atop the defaults', () => {
    const partial: Partial<LaneLpState> = { cutoff: 800, bypass: true };
    const merged = withLaneLpDefaults(partial);
    expect(merged.cutoff).toBe(800);
    expect(merged.bypass).toBe(true);
    expect(merged.resonance).toBe(DEFAULT_LANE_LP_STATE.resonance);
  });

  it('does not mutate its input', () => {
    const partial: Partial<LaneLpState> = { cutoff: 1200 };
    const before = { ...partial };
    withLaneLpDefaults(partial);
    expect(partial).toEqual(before);
  });
});
