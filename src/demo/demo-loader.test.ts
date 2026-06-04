import { describe, it, expect, vi } from 'vitest';
import { fetchDemoSession } from './demo-loader';
import type { SessionState } from '../session/session';

describe('fetchDemoSession', () => {
  it('parses a SessionState from the response body', async () => {
    const fake: SessionState = {
      lanes: [{ id: 'tb-303-1', engineId: 'tb303', clips: [] }],
      scenes: [],
      globalQuantize: '1/1',
    };
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fake,
    });
    vi.stubGlobal('fetch', fetchSpy);
    const result = await fetchDemoSession('/demos/minimal-techno.json');
    expect(result.lanes[0].id).toBe('tb-303-1');
    expect(fetchSpy).toHaveBeenCalledWith('/demos/minimal-techno.json');
    vi.unstubAllGlobals();
  });

  it('exposes an optional bpm when the demo carries one', async () => {
    const fake = {
      lanes: [], scenes: [], globalQuantize: '1/1', bpm: 132,
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => fake }));
    const result = await fetchDemoSession('/demos/acid-rain.json');
    expect(result.bpm).toBe(132);
    vi.unstubAllGlobals();
  });

  it('throws when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(fetchDemoSession('/missing.json')).rejects.toThrow(/404/);
    vi.unstubAllGlobals();
  });
});
