// AudioWorklet loader + typed node wrapper for the Loom synthesis processor.
//
// Loading strategy: Vite bundles loom-processor.ts (+ its imports) into a
// separate JS asset via the `?worker&url` suffix; addModule receives a
// base-path-aware URL that works in both dev and GitHub Pages (/Loom/) builds.
import loomProcessorUrl from './loom-processor.ts?worker&url';
import type { MainToWorklet, WorkletToMain } from '../audio-dsp/messages';
import type { NoteSpec, ParamBag } from '../audio-dsp/types';
import type { ModLite } from '../audio-dsp/modulation-runtime';
// Import the name from a worklet-code-free module, NOT from loom-processor.ts:
// importing loom-processor.ts here would execute its `class extends
// AudioWorkletProcessor` on the MAIN thread (ReferenceError). loom-processor.ts
// is referenced ONLY via the `?worker&url` import above (a separate worklet chunk).
import { LOOM_PROCESSOR_NAME } from './processor-name';

// Cache the addModule promise per BaseAudioContext so OfflineAudioContext is
// also supported (WeakMap keyed on BaseAudioContext, not AudioContext).
const moduleCache = new WeakMap<BaseAudioContext, Promise<void>>();

export async function loadLoomWorklet(ctx: BaseAudioContext): Promise<void> {
  let p = moduleCache.get(ctx);
  if (!p) {
    p = ctx.audioWorklet.addModule(loomProcessorUrl);
    // Drop the cache entry if registration fails so a later call can retry,
    // rather than permanently returning a cached rejection.
    p.catch(() => { if (moduleCache.get(ctx) === p) moduleCache.delete(ctx); });
    moduleCache.set(ctx, p);
  }
  return p;
}

export class LoomWorkletNode {
  readonly node: AudioWorkletNode;
  private countCb: ((n: number) => void) | null = null;

  constructor(ctx: BaseAudioContext, engineId = 'subtractive') {
    this.node = new AudioWorkletNode(ctx, LOOM_PROCESSOR_NAME, {
      outputChannelCount: [2],
      processorOptions: { engineId },   // tells the worklet which renderer to build
    });
    this.node.port.onmessage = (e: MessageEvent<WorkletToMain>) => {
      if (e.data.type === 'voices') this.countCb?.(e.data.active);
    };
  }

  private post(m: MainToWorklet): void { this.node.port.postMessage(m); }

  spawn(note: NoteSpec): void { this.post({ type: 'spawn', note }); }
  setParams(params: ParamBag): void { this.post({ type: 'params', params }); }
  setMaxVoices(n: number): void { this.post({ type: 'config', maxVoices: n }); }
  setMods(mods: ModLite[]): void { this.post({ type: 'mods', mods }); }
  steal(count: number): void { this.post({ type: 'steal', count }); }
  /** Release EVERY active voice (transport Stop / STOP ALL / scene-launch
   *  boundary). steal noteOffs the oldest `count` voices, so a count past the
   *  per-lane cap (≤64) releases them all — their release tails ring out, same
   *  as the legacy voice.release() the live-voice registry used to call. */
  silenceAll(): void { this.steal(1024); }
  onVoiceCount(cb: (active: number) => void): void { this.countCb = cb; }
  connect(dest: AudioNode): void { this.node.connect(dest); }
  disconnect(): void { this.node.disconnect(); }
  /** Tear-down for a disposed lane. `disconnect()` alone only removes the node from
   *  the graph — the processor's process() returns true, so the audio engine keeps
   *  running it forever. Sending `kill` makes process() return false so the engine
   *  reclaims it; without this, re-importing MIDIs piled up phantom processors that
   *  burned audio-thread CPU → progressive clicks/dropouts. */
  dispose(): void { this.post({ type: 'kill' }); this.node.disconnect(); }
}
