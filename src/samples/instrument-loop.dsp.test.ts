// End-to-end real-DSP for the LOOP instrument family (Task 14 of the
// sampler-audio plan). Mirrors loop-recompose.dsp.test.ts but drives the *full*
// loop→Sampler pipeline the way the inspector does:
//
//   decode loop WAV → detectLoop → sliceBuffer → slicesToKeymap (the bank) +
//   buildSliceClip (one note per slice on the project grid) → play the
//   reconstructed note clip through the Sampler engine in an OfflineAudioContext.
//
// This proves the loaded loop is audible and that re-triggering its slice bank
// from the generated note clip reproduces roughly the same energy as the whole
// loop. Assertions are RELATIVE: (a) the render is not silent (RMS > 0) and
// (b) its RMS is comparable to the original loop's (ratio within 0.5×–2×). An
// absolute level match is impossible — the Sampler applies its own amp envelope
// + OUTPUT_TRIM + velocity gain — so we only assert the same order of magnitude.

import { describe, it, expect, beforeEach } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { detectLoop } from './loop-analysis';
import { sliceBuffer } from './slice-buffer';
import { slicesToKeymap } from './slice-to-bank';
import { sampleCache } from './sample-cache';
import { SamplerEngine } from '../engines/sampler';
import { buildSliceClip } from '../core/slice-clip';
import { DEFAULT_METER, ticksPerBar } from '../core/meter';
import { TICKS_PER_QUARTER } from '../core/notes';
import { rms } from '../../test/dsp-asserts';
import { listLoopFixtures, readFixtureBytes } from '../../test/loop-fixtures';

async function decode(path: string, ctx: BaseAudioContext): Promise<AudioBuffer> {
  return ctx.decodeAudioData(readFixtureBytes(path)) as unknown as Promise<AudioBuffer>;
}

const fixtures = listLoopFixtures('drum');
const run = fixtures.length > 0 ? it : it.skip;

describe('loop instrument → slice bank → reconstructed note clip (Sampler DSP)', () => {
  beforeEach(() => sampleCache.clear());

  run('plays the loaded loop and its energy is comparable to the original', async () => {
    for (const fx of fixtures.slice(0, 3)) {
      sampleCache.clear();

      // 1. Decode the whole loop (reference for the energy comparison).
      const decodeCtx = new OfflineAudioContext(2, 1, 44100) as unknown as BaseAudioContext;
      const orig = await decode(fx.path, decodeCtx);
      const sr = orig.sampleRate;
      const ch = orig.numberOfChannels;

      // 2. Detect onsets + tempo, exactly like loadInstrument(loop).
      const { slicePointsSec, originalBpm } = detectLoop(orig, DEFAULT_METER);

      // 3. Build the reconstructed note clip on the project grid ('free' so the
      //    onsets aren't quantised away → the most faithful reconstruction).
      const clip = buildSliceClip({
        slicePointsSec,
        durationSec: orig.duration,
        originalBpm,
        projectMeter: DEFAULT_METER,
        gridResolution: 'free',
      });
      expect(clip.notes.length).toBeGreaterThan(0);

      // 4. Render context sized to the whole clip span + a release tail.
      const secPerTick = (60 / originalBpm) / TICKS_PER_QUARTER;
      const clipTicks = clip.lengthBars * ticksPerBar(DEFAULT_METER);
      const renderSec = clipTicks * secPerTick + 0.5;
      const render = new OfflineAudioContext(ch, Math.round(renderSec * sr), sr);

      // 5. Cut the loop into per-slice buffers IN THE RENDER CONTEXT and load
      //    them into the cache under the bank's keymap ids (slicesToKeymap maps
      //    one consecutive note per slice from SLICE_BASE_NOTE).
      const cuts = sliceBuffer(render as unknown as BaseAudioContext, orig, slicePointsSec);
      const ids = cuts.map((_, i) => `loop-${fx.name}-slice-${i}`);
      cuts.forEach((c, i) => sampleCache.put(ids[i], c.buffer));
      const keymap = slicesToKeymap(ids);
      expect(keymap.length).toBe(clip.notes.length);
      // Note↔slice determinism: keymap[i].rootNote === notes[i].midi.
      keymap.forEach((e, i) => expect(clip.notes[i].midi).toBe(e.rootNote));

      // 6. Drive the Sampler: one voice per note, triggered at its tick time.
      const engine = new SamplerEngine();
      engine.setKeymap(keymap);
      const out = render.createGain();
      out.connect(render.destination);
      for (const n of clip.notes) {
        const voice = engine.createVoice(render as unknown as AudioContext, out);
        voice.trigger(n.midi, n.start * secPerTick, { gateDuration: n.duration * secPerTick });
      }

      const rendered = await render.startRendering() as unknown as AudioBuffer;
      const recRms = rms(new Float32Array(rendered.getChannelData(0)));
      const origRms = rms(new Float32Array(orig.getChannelData(0)));

      // (a) the reconstructed loop is audible.
      expect(recRms).toBeGreaterThan(0);
      // (b) comparable energy to the original whole loop (same order of
      //     magnitude — the Sampler's envelope/trim shift the absolute level).
      expect(recRms).toBeGreaterThan(origRms * 0.5);
      expect(recRms).toBeLessThan(origRms * 2);
    }
  });
});
