// AudioWorklet loader + typed node wrapper for the Sampler + Audio-channel
// processor (2 stereo outputs: dry + fx send).
//
// Loading strategy mirrors loom-node.ts / drums-node.ts: Vite bundles
// sampler-processor.ts (+ its imports) into a separate JS asset via the
// `?worker&url` suffix; addModule receives a base-path-aware URL that works in
// both dev and GitHub Pages (/Loom/) builds. The processor is referenced ONLY
// through this worker-url import and by its registered string name
// "sampler-processor" — NEVER as a bare main-thread ESM import, which would
// execute its `class extends AudioWorkletProcessor` + registerProcessor() on the
// main thread (ReferenceError at boot).
import samplerProcessorUrl from './sampler-processor.ts?worker&url';
import type { SampleSpawn } from '../audio-dsp/sample/types';

/** Registered name of the sampler AudioWorklet processor. Kept as a plain literal
 *  on both sides (here and in sampler-processor.ts) so the main thread never
 *  imports the worklet module. */
const SAMPLER_PROCESSOR_NAME = 'sampler-processor';

// The sampler/audio main↔worklet message protocol.
export type SamplerMsg =
  | { type: 'loadSample'; sampleId: string; channels: Float32Array[]; sampleRate: number }
  | { type: 'spawn'; kind: 'sampler' | 'audio'; spawn: SampleSpawn }
  | { type: 'silence' };

/** Build the loadSample message + its transfer list (the channels' ArrayBuffers
 *  are transferred zero-copy, detaching them from the caller). Pure: testable
 *  without a real AudioWorkletNode. */
export function samplerLoadMessage(
  sampleId: string,
  channels: Float32Array[],
  sampleRate: number,
): [SamplerMsg, Transferable[]] {
  return [{ type: 'loadSample', sampleId, channels, sampleRate }, channels.map((c) => c.buffer)];
}

/** Build a spawn message (no transferables — the spawn is small POD). */
export function samplerSpawnMessage(kind: 'sampler' | 'audio', spawn: SampleSpawn): [SamplerMsg] {
  return [{ type: 'spawn', kind, spawn }];
}

/** Build a silence message (transport Stop): the processor note-offs every live
 *  voice so a long loop/song clip cuts the instant Stop is pressed instead of
 *  playing to the end of its buffer. */
export function samplerSilenceMessage(): [SamplerMsg] {
  return [{ type: 'silence' }];
}

/** Copy every channel out of an AudioBuffer (sliced into its own ArrayBuffer so
 *  it can be transferred without detaching the source buffer) + read the buffer
 *  sampleRate. */
export function extractChannels(buf: AudioBuffer): { channels: Float32Array[]; sampleRate: number } {
  const channels: Float32Array[] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c).slice());
  return { channels, sampleRate: buf.sampleRate };
}

// Cache the addModule promise per BaseAudioContext so OfflineAudioContext is also
// supported (WeakMap keyed on BaseAudioContext, not AudioContext).
const moduleCache = new WeakMap<BaseAudioContext, Promise<void>>();

export async function loadSamplerWorklet(ctx: BaseAudioContext): Promise<void> {
  let p = moduleCache.get(ctx);
  if (!p) {
    p = ctx.audioWorklet.addModule(samplerProcessorUrl);
    // Drop the cache entry if registration fails so a later call can retry,
    // rather than permanently returning a cached rejection.
    p.catch(() => { if (moduleCache.get(ctx) === p) moduleCache.delete(ctx); });
    moduleCache.set(ctx, p);
  }
  return p;
}

export class SamplerWorkletNode {
  readonly node: AudioWorkletNode;
  /** sampleIds already transferred to the worklet bank (load-once guard). */
  private sent = new Set<string>();

  constructor(ctx: BaseAudioContext) {
    this.node = new AudioWorkletNode(ctx, SAMPLER_PROCESSOR_NAME, {
      numberOfInputs: 0,
      numberOfOutputs: 2,
      outputChannelCount: [2, 2],   // [0] dry, [1] fx send
    });
  }

  /** Transfer a decoded AudioBuffer to the worklet bank under `id` (once). */
  loadSample(id: string, buf: AudioBuffer): void {
    if (this.sent.has(id)) return;
    this.sent.add(id);
    const { channels, sampleRate } = extractChannels(buf);
    this.node.port.postMessage(...samplerLoadMessage(id, channels, sampleRate));
  }

  /** Whether `id`'s buffer has already been transferred to the worklet bank. */
  hasSample(id: string): boolean { return this.sent.has(id); }

  spawn(kind: 'sampler' | 'audio', spawn: SampleSpawn): void {
    this.node.port.postMessage(...samplerSpawnMessage(kind, spawn));
  }

  /** Release every live voice (transport Stop / scene-launch boundary) so a long
   *  loop/song clip stops immediately instead of playing its buffer to the end. */
  silenceAll(): void {
    this.node.port.postMessage(...samplerSilenceMessage());
  }

  /** Dry output (outputs[0]) → lane strip input. */
  connectDry(dest: AudioNode): void { this.node.connect(dest, 0); }

  /** Send output (outputs[1]) → both FxBus inputs (delay + reverb). */
  connectSend(delayInput: AudioNode, reverbInput: AudioNode): void {
    this.node.connect(delayInput, 1);
    this.node.connect(reverbInput, 1);
  }

  disconnect(): void { this.node.disconnect(); }
}
