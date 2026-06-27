// AudioWorklet loader + typed node wrapper for the synth-mode drum machine
// processor (8 mono outputs, one per DrumVoice).
//
// Loading strategy mirrors loom-node.ts: Vite bundles drums-processor.ts (+ its
// imports) into a separate JS asset via the `?worker&url` suffix; addModule
// receives a base-path-aware URL that works in both dev and GitHub Pages (/Loom/)
// builds. The processor is referenced ONLY through this worker-url import and by
// its registered string name "drums-processor" — NEVER as a bare main-thread ESM
// import, which would execute its `class extends AudioWorkletProcessor` +
// registerProcessor() on the main thread (ReferenceError at boot).
import drumsProcessorUrl from './drums-processor.ts?worker&url';
import { DRUM_VOICE_IDS, type DrumVoiceId } from '../audio-dsp/drums/types';
import type { ParamBag } from '../audio-dsp/types';

/** Registered name of the drums AudioWorklet processor. Kept as a plain literal
 *  on both sides (here and in drums-processor.ts) so the main thread never imports
 *  the worklet module. */
const DRUMS_PROCESSOR_NAME = 'drums-processor';

// The drums-specific main↔worklet message protocol.
export type DrumsMsg =
  | { type: 'hit'; voice: DrumVoiceId; beginSec: number; velocity: number }
  | { type: 'voiceParams'; voice: DrumVoiceId; params: ParamBag }
  // Dispose: stop the processor (its process() returns false on `kill`).
  | { type: 'kill' };

/** Pure message builders (testable without a real AudioWorkletNode). */
export function drumsHitMessage(voice: DrumVoiceId, beginSec: number, velocity: number): DrumsMsg {
  return { type: 'hit', voice, beginSec, velocity };
}
export function drumsVoiceParamsMessage(voice: DrumVoiceId, params: ParamBag): DrumsMsg {
  return { type: 'voiceParams', voice, params };
}

// Cache the addModule promise per BaseAudioContext so OfflineAudioContext is also
// supported (WeakMap keyed on BaseAudioContext, not AudioContext).
const moduleCache = new WeakMap<BaseAudioContext, Promise<void>>();

export async function loadDrumsWorklet(ctx: BaseAudioContext): Promise<void> {
  let p = moduleCache.get(ctx);
  if (!p) {
    p = ctx.audioWorklet.addModule(drumsProcessorUrl);
    // Drop the cache entry if registration fails so a later call can retry,
    // rather than permanently returning a cached rejection.
    p.catch(() => { if (moduleCache.get(ctx) === p) moduleCache.delete(ctx); });
    moduleCache.set(ctx, p);
  }
  return p;
}

export class DrumsWorkletNode {
  readonly node: AudioWorkletNode;

  constructor(ctx: BaseAudioContext) {
    this.node = new AudioWorkletNode(ctx, DRUMS_PROCESSOR_NAME, {
      numberOfInputs: 0,
      numberOfOutputs: 8,
      outputChannelCount: [1, 1, 1, 1, 1, 1, 1, 1],
    });
  }

  private post(m: DrumsMsg): void { this.node.port.postMessage(m); }

  hit(voice: DrumVoiceId, beginSec: number, velocity: number): void {
    this.post(drumsHitMessage(voice, beginSec, velocity));
  }
  setVoiceParams(voice: DrumVoiceId, params: ParamBag): void {
    this.post(drumsVoiceParamsMessage(voice, params));
  }
  /** Connect output `i` (DRUM_VOICE_IDS[i]) to a strip input. */
  connectVoice(i: number, dest: AudioNode): void { this.node.connect(dest, i, 0); }
  /** Output index for a voice — the single source of truth is DRUM_VOICE_IDS. */
  voiceIndex(voice: DrumVoiceId): number { return DRUM_VOICE_IDS.indexOf(voice); }
  disconnect(): void { this.node.disconnect(); }
  /** Tear-down: kill the processor (its process() returns false) THEN disconnect.
   *  Without the kill, the disposed drums processor keeps running forever — see
   *  loom-node.ts dispose() for the full rationale. */
  dispose(): void { this.post({ type: 'kill' }); this.node.disconnect(); }
}
