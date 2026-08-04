// The host-side wrapper's own job: turning a spec into a registry entry. The
// GRAPH is the SDK's and is tested there
// (packages/loom-plugin-sdk/src/dsp/modulated-delay.test.ts) — what is left to
// prove here is that the manifest a caller gets matches the effect it asked
// for, which is the only decision this file still makes.
import { describe, it, expect } from 'vitest';
import { makeModulatedDelayPlugin, type ModDelaySpec } from './modulated-delay';

const CHORUS: ModDelaySpec = {
  id: 'md-chorus', name: 'MD Chorus',
  baseDelaySec: 0.018, sweepSec: 0.006, maxFeedback: 0, color: '#4dd0a7',
};
const FLANGER: ModDelaySpec = {
  id: 'md-flanger', name: 'MD Flanger',
  baseDelaySec: 0.002, sweepSec: 0.0018, maxFeedback: 0.9, color: '#7fb2ff',
};

describe('makeModulatedDelayPlugin — the manifest follows the spec', () => {
  it('a spec with no feedback ceiling declares no feedback knob', () => {
    const ids = makeModulatedDelayPlugin(CHORUS).manifest.params.map((p) => p.id);
    expect(ids).toEqual(['rate', 'depth', 'mix']);
  });

  it('a spec with a feedback ceiling declares one', () => {
    const ids = makeModulatedDelayPlugin(FLANGER).manifest.params.map((p) => p.id);
    expect(ids).toEqual(['rate', 'depth', 'feedback', 'mix']);
  });

  it('carries the caller id, name and rack colour through', () => {
    const m = makeModulatedDelayPlugin(FLANGER).manifest;
    expect(m.id).toBe('md-flanger');
    expect(m.name).toBe('MD Flanger');
    expect(m.color).toBe('#7fb2ff');
  });

  it('declares the same defaults the graph starts at', () => {
    // The manifest and the SDK graph must not drift about what a fresh
    // instance sounds like — both read MODULATED_DELAY_DEFAULTS, and this is
    // what would go red if one of them stopped.
    const fx = makeModulatedDelayPlugin(FLANGER)
      .create(new OfflineAudioContext(1, 128, 44100) as unknown as AudioContext);
    for (const p of makeModulatedDelayPlugin(FLANGER).manifest.params) {
      expect(fx.getBaseValue(p.id)).toBe(p.default);
    }
  });
});
