import { describe, it, expect, beforeEach } from 'vitest';
import '../../test/setup';
import { SidechainBus } from './sidechain-bus';

describe('SidechainBus', () => {
  let ctx: AudioContext;
  let bus: SidechainBus;

  beforeEach(() => {
    ctx = new AudioContext();
    bus = new SidechainBus();
  });

  it('returns null for unknown lane ids', () => {
    expect(bus.getTap('does-not-exist')).toBeNull();
  });

  it('returns the registered tap by lane id', () => {
    const tap = ctx.createGain();
    bus.register('bass', tap, 'BASS');
    expect(bus.getTap('bass')).toBe(tap);
  });

  it('replaces the tap on duplicate register (last-write-wins)', () => {
    const a = ctx.createGain();
    const b = ctx.createGain();
    bus.register('bass', a, 'BASS');
    bus.register('bass', b, 'BASS');
    expect(bus.getTap('bass')).toBe(b);
  });

  it('unregister clears the lane id', () => {
    const tap = ctx.createGain();
    bus.register('bass', tap, 'BASS');
    bus.unregister('bass');
    expect(bus.getTap('bass')).toBeNull();
  });

  it('listSources returns a stable, alphabetised view of registrations', () => {
    bus.register('poly', ctx.createGain(), 'POLY');
    bus.register('bass', ctx.createGain(), 'BASS');
    bus.register('drums', ctx.createGain(), 'DRUMS');
    const ids = bus.listSources().map((s) => s.id);
    expect(ids).toEqual(['bass', 'drums', 'poly']);
  });

  it('listSources omits the optional excludeId so a lane cannot self-duck', () => {
    bus.register('poly', ctx.createGain(), 'POLY');
    bus.register('bass', ctx.createGain(), 'BASS');
    const ids = bus.listSources('poly').map((s) => s.id);
    expect(ids).toEqual(['bass']);
  });

  it('subscribe fires on register and unregister', () => {
    const seen: number[] = [];
    bus.subscribe(() => seen.push(bus.listSources().length));
    bus.register('bass', ctx.createGain(), 'BASS');
    bus.register('drums', ctx.createGain(), 'DRUMS');
    bus.unregister('bass');
    expect(seen).toEqual([1, 2, 1]);
  });
});
