import { describe, it, expect, beforeAll } from 'vitest';
import '../../test/setup';
import { ChannelStrip, FxBus } from './fx';
import {
  STRIP_PARAM_SPECS,
  STRIP_PARAM_PREFIX,
  isStripParamId,
  getStripParam,
  setStripParam,
  stripAudioParams,
} from './channel-strip-params';

// OFFLINE context deliberately, same reason as fx.test.ts: writing an
// AudioParam's .value and reading it straight back on a real-time context can
// return the audio thread's stale value under suite load.
function makeStrip(): ChannelStrip {
  const ctx = new OfflineAudioContext(1, 4410, 44100) as unknown as AudioContext;
  const fx = new FxBus(ctx, ctx.destination);
  return new ChannelStrip(ctx, ctx.destination, fx);
}

describe('STRIP_PARAM_SPECS', () => {
  it('declares exactly the seven channel-strip params the mixer column shows', () => {
    expect(STRIP_PARAM_SPECS.map((s) => s.id)).toEqual([
      'bus.level', 'bus.pan', 'bus.sendA', 'bus.sendB',
      'bus.eq.low', 'bus.eq.mid', 'bus.eq.high',
    ]);
  });

  it('declares every one of them continuous, so the catalogue emits them', () => {
    // listAutomationTargets skips `kind !== 'continuous'`; a discrete spec here
    // would silently drop the param from every picker.
    for (const s of STRIP_PARAM_SPECS) expect(s.kind).toBe('continuous');
  });

  it('carries the ranges the mixer column knobs are built with', () => {
    const byId = new Map(STRIP_PARAM_SPECS.map((s) => [s.id, s]));
    expect(byId.get('bus.level')).toMatchObject({ min: 0, max: 1.5, default: 1 });
    expect(byId.get('bus.pan')).toMatchObject({ min: -1, max: 1, default: 0 });
    expect(byId.get('bus.sendA')).toMatchObject({ min: 0, max: 1, default: 0 });
    expect(byId.get('bus.sendB')).toMatchObject({ min: 0, max: 1, default: 0 });
    for (const band of ['bus.eq.low', 'bus.eq.mid', 'bus.eq.high']) {
      expect(byId.get(band)).toMatchObject({ min: -18, max: 18, default: 0 });
    }
  });

  it('every id sits under the prefix isStripParamId recognises', () => {
    for (const s of STRIP_PARAM_SPECS) {
      expect(s.id.startsWith(STRIP_PARAM_PREFIX)).toBe(true);
      expect(isStripParamId(s.id)).toBe(true);
    }
    expect(isStripParamId('filter.cutoff')).toBe(false);
    expect(isStripParamId('busy.level')).toBe(false);
  });
});

describe('setStripParam / getStripParam', () => {
  it('round-trips the six directly-written params through the strip', () => {
    // Pan is excluded on purpose — it ramps rather than writing .value; its own
    // test below covers it. Everything else lands immediately.
    const strip = makeStrip();
    const values: Record<string, number> = {
      'bus.level': 0.42, 'bus.sendA': 0.3, 'bus.sendB': 0.7,
      'bus.eq.low': -6, 'bus.eq.mid': 3, 'bus.eq.high': 12,
    };
    for (const [id, v] of Object.entries(values)) {
      expect(setStripParam(strip, id, v)).toBe(true);
      expect(getStripParam(strip, id)).toBeCloseTo(v, 4);
    }
  });

  it('ramps pan instead of stepping it, and converges on the target', async () => {
    // ChannelStrip.setPan uses setTargetAtTime(…, 0.01) so a moved pan control
    // does not click. Consequence for automation: a pan write is a SCHEDULED
    // approach, so it reads back as the old value until time advances. Asserted
    // here rather than "fixed", because the smoothing is what stops the zipper
    // noise — and drum lanes have relied on it since `bus.pan` existed.
    const ctx = new OfflineAudioContext(1, 4410, 44100) as unknown as AudioContext;
    const fx = new FxBus(ctx, ctx.destination);
    const strip = new ChannelStrip(ctx, ctx.destination, fx);

    expect(setStripParam(strip, 'bus.pan', -0.5)).toBe(true);
    expect(getStripParam(strip, 'bus.pan')).toBeCloseTo(0, 4);   // not yet — it ramps

    // 4410 frames @ 44.1 kHz = 100 ms = 10 · tau, so the approach has converged.
    await (ctx as unknown as OfflineAudioContext).startRendering();
    expect(getStripParam(strip, 'bus.pan')).toBeCloseTo(-0.5, 3);
  });

  it('lands on the audio nodes, not a side table', () => {
    const strip = makeStrip();
    setStripParam(strip, 'bus.level', 0.25);
    setStripParam(strip, 'bus.sendA', 0.6);
    setStripParam(strip, 'bus.eq.high', -9);
    expect(strip.level.gain.value).toBeCloseTo(0.25, 4);
    expect(strip.sendA.gain.value).toBeCloseTo(0.6, 4);
    expect(strip.getEqGainParam('high').value).toBeCloseTo(-9, 4);
  });

  it('refuses an unknown id instead of silently doing nothing', () => {
    const strip = makeStrip();
    expect(setStripParam(strip, 'bus.nope', 1)).toBe(false);
    expect(setStripParam(strip, 'filter.cutoff', 1)).toBe(false);
    expect(getStripParam(strip, 'bus.nope')).toBeUndefined();
  });

  // The sends were `bus.delaySend` / `bus.reverbSend` in this file alone, while
  // ChannelState, the bus list and the mixer labels said A and B. Saved
  // envelopes, saved connections and five shipped demos hold the old spelling,
  // so it has to keep resolving — but only the NEW id is declared, which is
  // what the catalogue and the pickers offer.
  it('still answers to the ids the sends used to carry', () => {
    const strip = makeStrip();
    expect(setStripParam(strip, 'bus.delaySend', 0.4)).toBe(true);
    expect(setStripParam(strip, 'bus.reverbSend', 0.6)).toBe(true);

    expect(getStripParam(strip, 'bus.sendA')).toBeCloseTo(0.4, 4);
    expect(getStripParam(strip, 'bus.sendB')).toBeCloseTo(0.6, 4);
    expect(getStripParam(strip, 'bus.delaySend')).toBeCloseTo(0.4, 4);
  });

  it('declares only the new ids, so nothing offers the user two names for one send', () => {
    const ids = STRIP_PARAM_SPECS.map((s) => s.id);
    expect(ids).toContain('bus.sendA');
    expect(ids).toContain('bus.sendB');
    expect(ids).not.toContain('bus.delaySend');
    expect(ids).not.toContain('bus.reverbSend');
  });
});

describe('stripAudioParams', () => {
  it('exposes one AudioParam per declared param, under the same ids', () => {
    const strip = makeStrip();
    const params = stripAudioParams(strip);
    // The declared seven, plus the two ids the sends carried before the rename:
    // this map is looked up BY a saved modulation connection's target.
    const expected = [...STRIP_PARAM_SPECS.map((s) => s.id), 'bus.delaySend', 'bus.reverbSend'];
    expect([...params.keys()].sort()).toEqual(expected.sort());
    for (const [, ap] of params) expect(typeof ap.value).toBe('number');
  });

  it('the old send ids point at the SAME nodes as the new ones', () => {
    const strip = makeStrip();
    const params = stripAudioParams(strip);
    expect(params.get('bus.delaySend')).toBe(params.get('bus.sendA'));
    expect(params.get('bus.reverbSend')).toBe(params.get('bus.sendB'));
  });

  it('hands out the strip own params, so a write through one is visible on the other', () => {
    const strip = makeStrip();
    const params = stripAudioParams(strip);
    setStripParam(strip, 'bus.eq.mid', 7);
    expect(params.get('bus.eq.mid')!.value).toBeCloseTo(7, 4);
  });
});
