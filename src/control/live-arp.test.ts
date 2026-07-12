import { describe, it, expect, vi } from 'vitest';
import { arpIntervalSec, liveArpParamsFor, createLiveArp } from './live-arp';
import { getNoteFxChain } from '../notefx/notefx-registry';
import { ARP_PROCESSOR_DEFAULTS } from '../notefx/arp-processor';

describe('arpIntervalSec', () => {
  it('free rate → 1 / Hz', () => {
    expect(arpIntervalSec({ ...ARP_PROCESSOR_DEFAULTS, rate: 'free', rateFreeHz: 8 }, 120)).toBeCloseTo(0.125, 5);
  });
  it('sync rate → a positive interval', () => {
    expect(arpIntervalSec({ ...ARP_PROCESSOR_DEFAULTS, rate: '1/16' }, 120)).toBeGreaterThan(0);
  });
});

describe('liveArpParamsFor', () => {
  it('returns null when the lane has no enabled arp note-FX', () => {
    expect(liveArpParamsFor('lane-arp-none')).toBeNull();
  });
  it('returns the arp params with octaves forced to 1 ("anular la octava")', () => {
    const chain = getNoteFxChain('lane-arp-on');
    const s = chain.addNoteFx('arp');
    s.enabled = true;
    expect(ARP_PROCESSOR_DEFAULTS.octaves).toBeGreaterThan(1);   // the default really spans octaves
    const p = liveArpParamsFor('lane-arp-on');
    expect(p).not.toBeNull();
    expect(p!.octaves).toBe(1);
  });
});

describe('createLiveArp', () => {
  it('start returns false and sounds nothing when no arp is enabled', () => {
    const spawnVoice = vi.fn();
    const arp = createLiveArp({ spawnVoice, now: () => 0, bpm: () => 120, setTimer: vi.fn(() => 1), clearTimer: vi.fn(), defer: () => {} });
    expect(arp.start('lane-arp-none2', 60, 100)).toBe(false);
    expect(spawnVoice).not.toHaveBeenCalled();
    expect(arp.isRunning()).toBe(false);
  });

  it('with arp enabled: plays the first step from the held note, loops, and gates each step (staccato)', () => {
    const chain = getNoteFxChain('lane-arp-run');
    chain.addNoteFx('arp').enabled = true;
    const trigger = vi.fn();
    const spawnVoice = vi.fn(() => ({ trigger, release: () => {}, dispose: () => {} }) as never);
    const setTimer = vi.fn(() => 7);
    const clearTimer = vi.fn();
    const arp = createLiveArp({ spawnVoice, now: () => 0, bpm: () => 120, setTimer, clearTimer, defer: () => {} });

    expect(arp.start('lane-arp-run', 60, 100)).toBe(true);
    expect(spawnVoice).toHaveBeenCalledTimes(1);            // first step fires immediately
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger.mock.calls[0][0]).toBe(60);              // first arp note = the held root
    const opts = trigger.mock.calls[0][2] as { gateDuration: number };
    expect(opts.gateDuration).toBeGreaterThan(0);           // gate honoured (short note)
    expect(setTimer).toHaveBeenCalledTimes(1);              // the loop is scheduled
    expect(arp.isRunning()).toBe(true);

    arp.stop('lane-arp-run', 60);
    expect(clearTimer).toHaveBeenCalledWith(7);
    expect(arp.isRunning()).toBe(false);
  });

  it('a new start restarts the arp (mono, last note wins)', () => {
    getNoteFxChain('lane-arp-mono').addNoteFx('arp').enabled = true;
    const spawnVoice = vi.fn(() => ({ trigger: vi.fn(), release: () => {}, dispose: () => {} }) as never);
    const clearTimer = vi.fn();
    let id = 0;
    const arp = createLiveArp({ spawnVoice, now: () => 0, bpm: () => 120, setTimer: vi.fn(() => ++id), clearTimer, defer: () => {} });
    arp.start('lane-arp-mono', 60, 100);
    arp.start('lane-arp-mono', 64, 100);      // restart from a new root
    expect(clearTimer).toHaveBeenCalledWith(1);   // the first loop was halted
    expect(arp.isRunning()).toBe(true);
  });
});
