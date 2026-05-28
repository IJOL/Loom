// test/dsp-battery.ts
// Shared DSP test battery for SynthEngine voices. Each engine's
// .dsp.test.ts calls runStandardEngineBattery(...) plus its own
// engine-specific extras.

import { describe, it, expect } from 'vitest';
import type { SynthEngine, Voice } from '../src/engines/engine-types';
import { renderEngine, type RenderEvent } from './render';
import { rms, peak, isSilent, spectralCentroid } from './dsp-asserts';
import { writeWav, wavPath } from './wav';

export interface BatteryOpts {
  /** Test file prefix, e.g. 'tb303', 'fm', 'wavetable'. */
  name: string;
  /** Fresh engine instance per test. */
  createEngine: () => SynthEngine;
  /** Param id for the engine's main filter cutoff (skip filter test if undefined). */
  cutoffParamId?: string;
  /** Param ids written to 'maxed-out' values for the doesn't-clip test. */
  maxOutParams?: Record<string, number>;
  /** Whether the engine implements an audible accent. Default true. */
  hasAccent?: boolean;
  /** MIDI note used for the standard triggers. */
  midi?: number;
  /** Gate duration used for the standard triggers. */
  gateDuration?: number;
  /** Sample rate for renders. */
  sampleRate?: number;
}

const DEFAULT_MIDI = 36;
const DEFAULT_GATE = 0.2;
const DEFAULT_SR   = 44100;

function buildFactory(engine: SynthEngine) {
  // We construct the output node here but do NOT connect it to ctx.destination
  // — renderEngine() owns that single connection so we don't double-route.
  return (ctx: OfflineAudioContext) => {
    const output = (ctx as unknown as { createGain(): GainNode }).createGain();
    const voice: Voice = engine.createVoice(
      ctx as unknown as AudioContext,
      output,
    );
    return { voice, output };
  };
}

async function render(
  engine: SynthEngine,
  events: RenderEvent[],
  opts: { durationSec: number; sampleRate: number },
): Promise<Float32Array> {
  return renderEngine(buildFactory(engine), {
    durationSec: opts.durationSec,
    sampleRate: opts.sampleRate,
    events,
  });
}

export function runStandardEngineBattery(o: BatteryOpts): void {
  const midi = o.midi ?? DEFAULT_MIDI;
  const gate = o.gateDuration ?? DEFAULT_GATE;
  const sr   = o.sampleRate   ?? DEFAULT_SR;

  describe(`${o.name} — standard DSP battery`, () => {
    it('produces audible sound on trigger', async () => {
      const engine = o.createEngine();
      const buf = await render(engine, [
        { time: 0, type: 'trigger', midi, gateDuration: gate },
      ], { durationSec: 0.4, sampleRate: sr });
      writeWav(buf, wavPath(`${o.name}__sounds`), sr);
      expect(isSilent(buf)).toBe(false);
      expect(peak(buf)).toBeGreaterThan(0.01);
    });

    it('does not clip with max-out params', async () => {
      const engine = o.createEngine();
      if (o.maxOutParams) {
        for (const [id, v] of Object.entries(o.maxOutParams)) engine.setBaseValue(id, v);
      }
      const buf = await render(engine, [
        { time: 0, type: 'trigger', midi, gateDuration: gate, accent: true },
      ], { durationSec: 0.4, sampleRate: sr });
      writeWav(buf, wavPath(`${o.name}__no-clip`), sr);
      expect(peak(buf)).toBeLessThan(1.0);
    });

    if (o.cutoffParamId) {
      it('opening filter cutoff raises spectral centroid', async () => {
        const engineLow = o.createEngine();
        engineLow.setBaseValue(o.cutoffParamId!, 0.1);
        const bufLow = await render(engineLow, [
          { time: 0, type: 'trigger', midi, gateDuration: gate },
        ], { durationSec: 0.4, sampleRate: sr });

        const engineHi = o.createEngine();
        engineHi.setBaseValue(o.cutoffParamId!, 0.9);
        const bufHi = await render(engineHi, [
          { time: 0, type: 'trigger', midi, gateDuration: gate },
        ], { durationSec: 0.4, sampleRate: sr });

        writeWav(bufLow, wavPath(`${o.name}__cutoff-low`), sr);
        writeWav(bufHi,  wavPath(`${o.name}__cutoff-hi`),  sr);

        const cLow = spectralCentroid(bufLow, sr);
        const cHi  = spectralCentroid(bufHi,  sr);
        expect(cHi).toBeGreaterThan(cLow * 2);
      });
    }

    if (o.hasAccent !== false) {
      it('accent raises RMS', async () => {
        const engineN = o.createEngine();
        const bufN = await render(engineN, [
          { time: 0, type: 'trigger', midi, gateDuration: gate, accent: false },
        ], { durationSec: 0.4, sampleRate: sr });

        const engineA = o.createEngine();
        const bufA = await render(engineA, [
          { time: 0, type: 'trigger', midi, gateDuration: gate, accent: true },
        ], { durationSec: 0.4, sampleRate: sr });

        writeWav(bufN, wavPath(`${o.name}__accent-off`), sr);
        writeWav(bufA, wavPath(`${o.name}__accent-on`),  sr);

        expect(rms(bufA)).toBeGreaterThan(rms(bufN));
      });
    }

    it('release cuts the gate', async () => {
      const engine = o.createEngine();
      const buf = await render(engine, [
        { time: 0,   type: 'trigger', midi, gateDuration: 1.0 },
        { time: 0.1, type: 'release' },
      ], { durationSec: 1.0, sampleRate: sr });
      writeWav(buf, wavPath(`${o.name}__release`), sr);

      const headLen = Math.round(0.1 * sr);
      const tailLen = Math.round(0.05 * sr);
      const head = buf.subarray(0, headLen);
      const tail = buf.subarray(buf.length - tailLen);
      expect(rms(tail)).toBeLessThan(rms(head) * 0.1);
    });
  });
}
