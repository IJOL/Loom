import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadEnginePresets, validatePresetEntry, __resetPresetCache } from './preset-loader';

beforeEach(() => { __resetPresetCache(); });

describe('validatePresetEntry', () => {
  it('accepts a valid preset', () => {
    expect(validatePresetEntry({ name: 'A', gm: [0, 1], params: {} })).toBe(true);
  });

  it('rejects missing name', () => {
    expect(validatePresetEntry({ gm: [0], params: {} } as unknown)).toBe(false);
  });

  it('rejects non-array gm', () => {
    expect(validatePresetEntry({ name: 'A', gm: 0 as unknown, params: {} } as unknown)).toBe(false);
  });

  it('rejects gm values outside [0,128)', () => {
    expect(validatePresetEntry({ name: 'A', gm: [128], params: {} })).toBe(false);
    expect(validatePresetEntry({ name: 'A', gm: [-1], params: {} })).toBe(false);
    expect(validatePresetEntry({ name: 'A', gm: [3.5], params: {} })).toBe(false);
  });

  it('rejects missing params', () => {
    expect(validatePresetEntry({ name: 'A', gm: [0] } as unknown)).toBe(false);
  });
});

describe('loadEnginePresets', () => {
  it('fetches and returns valid presets', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        engineId: 'tb303',
        presets: [
          { name: 'Acid 1', gm: [32], params: { cutoff: 0.3 } },
          { name: 'Acid 2', gm: [33], params: { cutoff: 0.5 } },
        ],
      }),
    }));
    const out = await loadEnginePresets('tb303');
    expect(out).toHaveLength(2);
    expect(out[0].name).toBe('Acid 1');
    vi.unstubAllGlobals();
  });

  it('drops malformed entries with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        engineId: 'tb303',
        presets: [
          { name: 'Good', gm: [0], params: {} },
          { name: 'Bad', gm: 'oops', params: {} },
        ],
      }),
    }));
    const out = await loadEnginePresets('tb303');
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Good');
    expect(warn).toHaveBeenCalled();
    vi.unstubAllGlobals();
    warn.mockRestore();
  });

  it('drops duplicate names with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        engineId: 'tb303',
        presets: [
          { name: 'A', gm: [0], params: {} },
          { name: 'A', gm: [1], params: {} },
        ],
      }),
    }));
    const out = await loadEnginePresets('tb303');
    expect(out).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
    vi.unstubAllGlobals();
    warn.mockRestore();
  });

  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(loadEnginePresets('nope')).rejects.toThrow(/404/);
    vi.unstubAllGlobals();
  });
});
