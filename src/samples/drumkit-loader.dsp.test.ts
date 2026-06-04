// src/samples/drumkit-loader.dsp.test.ts
// Layer-3 real-DSP: load a small committed TR-808 fixture kit's actual WAVs off
// disk, decode them through a real OfflineAudioContext into the sample cache,
// then render a SamplerEngine voice on a GM drum note and assert it is audible.
// Proves the whole loadDrumkit → keymap → sampler-voice path with real audio.
//
// The full kit under public/drumkits/**/*.wav is gitignored (mixed-license raw
// audio), so this test reads a self-contained 2-pad fixture (kick + snare)
// committed under test/fixtures/drumkits/ — enough to exercise the real path
// in a fresh checkout / CI without bundling the whole kit.

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadDrumkit, type DrumkitManifest } from './drumkit-loader';
import { sampleCache } from './sample-cache';
import { keymapEntryFor } from './keymap';
import { SamplerEngine } from '../engines/sampler';
import { peak, isSilent } from '../../test/dsp-asserts';

const SR = 44100;
const KIT_DIR = path.resolve(process.cwd(), 'test/fixtures/drumkits');

/** A fetch that reads /drumkits/<rel> from the public/ folder on disk. */
function diskFetch(): typeof fetch {
  return (async (url: string) => {
    const rel = url.replace(/^\/drumkits\//, '');
    const buf = fs.readFileSync(path.join(KIT_DIR, rel));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return { ok: true, arrayBuffer: async () => ab } as unknown as Response;
  }) as unknown as typeof fetch;
}

const tr808 = (): DrumkitManifest =>
  JSON.parse(fs.readFileSync(path.join(KIT_DIR, 'tr808.json'), 'utf8')) as DrumkitManifest;

const GM_NOTES = [36, 38]; // kick, snare — the fixture kit's two pads

describe('loadDrumkit — real TR-808 fixture WAVs through OfflineAudioContext', () => {
  beforeEach(() => sampleCache.clear());

  it('maps the fixture pads at their GM notes, each backed by a decoded buffer', async () => {
    const ctx = new OfflineAudioContext(1, Math.round(0.2 * SR), SR);
    const manifest = tr808();
    const km = await loadDrumkit(manifest, ctx as unknown as AudioContext, {
      store: { put: async () => {} },
      fetchFn: diskFetch(),
      now: () => 0,
    });
    // keymap notes mirror the manifest order exactly...
    expect(km.map((e) => e.rootNote)).toEqual(manifest.samples.map((s) => s.note));
    // ...and cover all 8 GM drum voices (order-independent).
    expect(new Set(km.map((e) => e.rootNote))).toEqual(new Set(GM_NOTES));
    expect(km.every((e) => e.loNote === e.rootNote && e.hiNote === e.rootNote)).toBe(true);
    for (const e of km) {
      const buf = sampleCache.get(e.sampleId);
      expect(buf).toBeDefined();
      expect(buf!.duration).toBeGreaterThan(0);
    }
  });

  it('a sampler voice triggered on the kick note is audible; an unmapped note is silent', async () => {
    const ctx = new OfflineAudioContext(1, Math.round(0.4 * SR), SR);
    const km = await loadDrumkit(tr808(), ctx as unknown as AudioContext, {
      store: { put: async () => {} },
      fetchFn: diskFetch(),
      now: () => 0,
    });
    const engine = new SamplerEngine();
    engine.setKeymap(km);
    const out = ctx.createGain();
    out.connect(ctx.destination);
    const voice = engine.createVoice(ctx as unknown as AudioContext, out);
    voice.trigger(36, 0, { gateDuration: 0.2, accent: true }); // kick
    const rendered = new Float32Array((await ctx.startRendering()).getChannelData(0));
    expect(isSilent(rendered)).toBe(false);
    expect(peak(rendered)).toBeGreaterThan(0.01);

    // A note no pad covers resolves to nothing.
    expect(keymapEntryFor(km, 100)).toBeUndefined();
  });
});
