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
  onVoiceCount(cb: (active: number) => void): void { this.countCb = cb; }
  connect(dest: AudioNode): void { this.node.connect(dest); }
  disconnect(): void { this.node.disconnect(); }
}
