// test/render.ts
// Renders an engine voice through an OfflineAudioContext and returns the
// mono Float32Array result.

import type { Voice, VoiceTriggerOptions } from '../src/engines/engine-types';

export type RenderEvent =
  | { time: number; type: 'trigger'; midi: number; gateDuration: number;
      accent?: boolean; slide?: boolean; velocity?: number }
  | { time: number; type: 'release' };

export interface EngineFactoryResult {
  voice: Voice;
  output: AudioNode;
}

export type EngineFactory = (ctx: OfflineAudioContext) => EngineFactoryResult;

export interface RenderOpts {
  durationSec: number;
  sampleRate: number;
  events: RenderEvent[];
}

export async function renderEngine(
  factory: EngineFactory,
  opts: RenderOpts,
): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(
    1,
    Math.round(opts.durationSec * opts.sampleRate),
    opts.sampleRate,
  );

  const { voice, output } = factory(ctx);
  output.connect(ctx.destination);

  for (const ev of opts.events) {
    if (ev.type === 'trigger') {
      const triggerOpts: VoiceTriggerOptions = { gateDuration: ev.gateDuration };
      if (ev.accent !== undefined)   triggerOpts.accent   = ev.accent;
      if (ev.slide !== undefined)    triggerOpts.slide    = ev.slide;
      if (ev.velocity !== undefined) triggerOpts.velocity = ev.velocity;
      voice.trigger(ev.midi, ev.time, triggerOpts);
    } else {
      voice.release(ev.time);
    }
  }

  const audioBuffer = await ctx.startRendering();
  // Copy out so the buffer is detached from any context lifetime.
  return new Float32Array(audioBuffer.getChannelData(0));
}
