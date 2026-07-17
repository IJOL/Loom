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

  it('accepts a sampler preset with valid zones', () => {
    expect(validatePresetEntry({
      name: 'Sweep Pad', gm: [89], params: {},
      zones: [
        { url: 'instruments/sweep-pad/low.wav', rootNote: 36, loNote: 0, hiNote: 47 },
        { url: 'instruments/sweep-pad/mid.wav', rootNote: 60, loNote: 48, hiNote: 127, gain: 0.8 },
      ],
    })).toBe(true);
  });

  it('rejects zones that are not an array', () => {
    expect(validatePresetEntry({ name: 'A', gm: [0], params: {}, zones: 'oops' as unknown })).toBe(false);
  });

  it('rejects a zone missing its url', () => {
    expect(validatePresetEntry({
      name: 'A', gm: [0], params: {},
      zones: [{ rootNote: 60, loNote: 0, hiNote: 127 }],
    })).toBe(false);
  });

  it('rejects a zone with an out-of-range note', () => {
    expect(validatePresetEntry({
      name: 'A', gm: [0], params: {},
      zones: [{ url: 'x.wav', rootNote: 128, loNote: 0, hiNote: 127 }],
    })).toBe(false);
  });
});

describe('loadEnginePresets', () => {
  it('fetches and returns valid presets', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
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
      headers: { get: () => 'application/json' },
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
      headers: { get: () => 'application/json' },
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

  it('returns empty for a missing presets file (404), without throwing', async () => {
    // Engines like `audio` have no presets/<id>.json at all; in production a
    // missing file is a real 404. That is "no presets for this engine", not an
    // error — resolve to [] so loadAllPresets stays quiet.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(loadEnginePresets('nope')).resolves.toEqual([]);
    vi.unstubAllGlobals();
  });

  it('returns empty when the dev server serves the SPA fallback (text/html)', async () => {
    // Vite's dev server answers an unknown public path with index.html (a 200 +
    // text/html), so `res.json()` would choke on `<!DOCTYPE`. Treat the non-JSON
    // content-type as "file absent" and resolve to [] instead of erroring.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
      text: async () => '<!DOCTYPE html><html></html>',
    }));
    await expect(loadEnginePresets('audio')).resolves.toEqual([]);
    vi.unstubAllGlobals();
  });
});

describe('validatePresetEntry — modulators (a preset can carry its LFO)', () => {
  const lfo = {
    id: 'lfo1', kind: 'lfo', enabled: true, rateHz: 4, waveform: 'sine',
    connections: [{ paramId: 'filter.cutoff', depth: 0.6 }],
  };

  it('accepts a preset with a well-formed modulators array', () => {
    expect(validatePresetEntry({ name: 'Wobble', gm: [38], params: {}, modulators: [lfo] })).toBe(true);
  });

  it('accepts a preset with no modulators field (every existing preset)', () => {
    expect(validatePresetEntry({ name: 'Plain', gm: [0], params: {} })).toBe(true);
  });

  it('rejects modulators that is not an array', () => {
    expect(validatePresetEntry({ name: 'X', gm: [0], params: {}, modulators: {} as unknown })).toBe(false);
  });

  it('rejects a modulator missing its id or kind', () => {
    expect(validatePresetEntry({ name: 'X', gm: [0], params: {}, modulators: [{ enabled: true }] })).toBe(false);
    expect(validatePresetEntry({ name: 'X', gm: [0], params: {}, modulators: [{ id: 'lfo1' }] })).toBe(false);
  });

  it('rejects a modulator whose connections is not an array', () => {
    expect(validatePresetEntry({
      name: 'X', gm: [0], params: {},
      modulators: [{ id: 'lfo1', kind: 'lfo', enabled: true, connections: 'nope' }],
    })).toBe(false);
  });
});
