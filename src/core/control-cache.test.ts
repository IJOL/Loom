import { describe, it, expect, vi } from 'vitest';
import { ControlCache } from './control-cache';

describe('ControlCache', () => {
  it('calls the factory once and returns the same instance afterwards', () => {
    const cache = new ControlCache();
    const factory = vi.fn(() => ({ tag: 'knob' }));

    cache.beginPass();
    const a = cache.get('a', factory);
    cache.endPass();

    cache.beginPass();
    const b = cache.get('a', factory);
    cache.endPass();

    expect(factory).toHaveBeenCalledTimes(1);
    expect(b).toBe(a);
  });

  it('keeps entries touched during a pass', () => {
    const cache = new ControlCache();
    cache.beginPass();
    cache.get('a', () => ({}));
    cache.get('b', () => ({}));
    expect(cache.endPass()).toEqual([]);
    expect(cache.size).toBe(2);
  });

  it('drops entries not touched during a pass and reports them', () => {
    const cache = new ControlCache();
    cache.beginPass();
    cache.get('a', () => ({}));
    cache.get('b', () => ({}));
    cache.endPass();

    cache.beginPass();
    cache.get('a', () => ({}));
    const dropped = cache.endPass();

    expect(dropped).toEqual(['b']);
    expect(cache.size).toBe(1);
  });

  it('rebuilds an entry that was dropped and later requested again', () => {
    const cache = new ControlCache();
    const factory = vi.fn(() => ({}));

    cache.beginPass();
    const first = cache.get('a', factory);
    cache.endPass();

    cache.beginPass();
    cache.endPass();                       // 'a' not touched -> dropped

    cache.beginPass();
    const second = cache.get('a', factory);
    cache.endPass();

    expect(factory).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
  });

  it('caches a falsy value (undefined) instead of re-running the factory', () => {
    const cache = new ControlCache();
    const factory = vi.fn(() => undefined);

    cache.beginPass();
    const a = cache.get('a', factory);
    cache.endPass();

    cache.beginPass();
    const b = cache.get('a', factory);
    cache.endPass();

    expect(factory).toHaveBeenCalledTimes(1);
    expect(a).toBe(undefined);
    expect(b).toBe(undefined);
  });

  it('treats a pass with no beginPass as touching nothing', () => {
    const cache = new ControlCache();
    cache.beginPass();
    cache.get('a', () => ({}));
    cache.endPass();

    cache.beginPass();
    expect(cache.endPass()).toEqual(['a']);
    expect(cache.size).toBe(0);
  });
});
