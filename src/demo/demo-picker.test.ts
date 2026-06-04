// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { wireDemoPicker } from './demo-picker';
import type { SessionHost } from '../session/session-host';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('wireDemoPicker', () => {
  it('applies the demo bpm after loading when the demo carries one', async () => {
    const applyLoadedSessionState = vi.fn();
    const sessionHost = { applyLoadedSessionState } as unknown as SessionHost;
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

    expect(applyLoadedSessionState).toHaveBeenCalledOnce();
    expect(applyBpm).toHaveBeenCalledWith(84);
    vi.unstubAllGlobals();
  });

  it('does not call applyBpm when the demo has no bpm', async () => {
    const sessionHost = { applyLoadedSessionState: vi.fn() } as unknown as SessionHost;
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
