// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { wireDemoPicker } from './demo-picker';
import type { SessionHost } from '../session/session-host';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('wireDemoPicker', () => {
  it('applies the demo bpm after loading when the demo carries one', async () => {
    const replaceSession = vi.fn();
    const sessionHost = { replaceSession } as unknown as SessionHost;
    const applyBpm = vi.fn();
    const selectEl = document.createElement('select');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ lanes: [], scenes: [], globalQuantize: '1/1', bpm: 84 }),
    }));

    wireDemoPicker({
      sessionHost, selectEl, applyBpm,
      demos: [{ label: 'Blue Hour', path: '/demos/blue-hour.json' }],
    });

    selectEl.value = '/demos/blue-hour.json';
    selectEl.dispatchEvent(new Event('change'));
    await flush();

    expect(replaceSession).toHaveBeenCalledOnce();
    expect(applyBpm).toHaveBeenCalledWith(84);
    vi.unstubAllGlobals();
  });

  it('does not call applyBpm when the demo has no bpm', async () => {
    const sessionHost = { replaceSession: vi.fn() } as unknown as SessionHost;
    const applyBpm = vi.fn();
    const selectEl = document.createElement('select');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ lanes: [], scenes: [], globalQuantize: '1/1' }),
    }));

    wireDemoPicker({
      sessionHost, selectEl, applyBpm,
      demos: [{ label: 'Untitled', path: '/demos/untitled.json' }],
    });

    selectEl.value = '/demos/untitled.json';
    selectEl.dispatchEvent(new Event('change'));
    await flush();

    expect(applyBpm).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('wireDemoPicker — time signature', () => {
  const load = async (payload: Record<string, unknown>) => {
    const replaceSession = vi.fn();
    const applyBpm = vi.fn();
    const applyMeter = vi.fn();
    const selectEl = document.createElement('select');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ lanes: [], scenes: [], globalQuantize: '1/1', ...payload }),
    }));
    wireDemoPicker({
      sessionHost: { replaceSession } as unknown as SessionHost,
      selectEl, applyBpm, applyMeter,
      demos: [{ label: 'T', path: '/demos/t.json' }],
    });
    selectEl.value = '/demos/t.json';
    selectEl.dispatchEvent(new Event('change'));
    await flush();
    vi.unstubAllGlobals();
    return { applyBpm, applyMeter, replaceSession };
  };

  it('applies a demo time signature when it carries one', async () => {
    const { applyMeter } = await load({ timeSignature: { num: 3, den: 4 }, bpm: 120 });
    expect(applyMeter).toHaveBeenCalledWith({ num: 3, den: 4 });
  });

  it('leaves the current meter alone when the demo has none', async () => {
    const { applyMeter, applyBpm } = await load({ bpm: 120 });
    expect(applyMeter).not.toHaveBeenCalled();
    expect(applyBpm).toHaveBeenCalledWith(120);
  });

  it('sets the meter BEFORE the tempo, so the grid is right when the tempo lands', async () => {
    const order: string[] = [];
    const replaceSession = vi.fn();
    const selectEl = document.createElement('select');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ lanes: [], scenes: [], globalQuantize: '1/1', bpm: 90, timeSignature: { num: 6, den: 8 } }),
    }));
    wireDemoPicker({
      sessionHost: { replaceSession } as unknown as SessionHost,
      selectEl,
      applyBpm: () => order.push('bpm'),
      applyMeter: () => order.push('meter'),
      demos: [{ label: 'T', path: '/demos/t.json' }],
    });
    selectEl.value = '/demos/t.json';
    selectEl.dispatchEvent(new Event('change'));
    await flush();
    expect(order).toEqual(['meter', 'bpm']);
    vi.unstubAllGlobals();
  });
});
