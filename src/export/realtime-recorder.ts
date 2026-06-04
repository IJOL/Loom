// src/export/realtime-recorder.ts
// Real-time backend: taps the live master output through the recorder worklet,
// plays the scene once from the top, and resolves with the captured stereo PCM.

import type { RenderedAudio, SceneRecorder } from './types';
import { RECORDER_PROCESSOR_NAME, ensureRecorderWorklet } from './recorder-worklet';

export interface RealtimeRecorderDeps {
  ctx: AudioContext;
  /** Node carrying the full master signal (audio-graph `masterComp.output`). */
  tap: AudioNode;
  /** Seconds to wait after setup before the recording window starts, so the
   *  worklet is live and the scene restart has been queued (e.g. 0.15). */
  leadSec: number;
  /** Called with the absolute window start time; the orchestrator uses it to
   *  restart the sounding lanes and start the transport. */
  onStart: (startTime: number) => void;
}

export class RealtimeSceneRecorder implements SceneRecorder {
  constructor(private deps: RealtimeRecorderDeps) {}

  async record(totalSec: number): Promise<RenderedAudio> {
    const { ctx, tap, leadSec, onStart } = this.deps;
    await ensureRecorderWorklet(ctx);

    const node = new AudioWorkletNode(ctx, RECORDER_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });

    const done = new Promise<RenderedAudio>((resolve) => {
      node.port.onmessage = (e: MessageEvent) => {
        const d = e.data as { type: string; left: Float32Array; right: Float32Array; sampleRate: number };
        if (d && d.type === 'done') {
          resolve({ channels: [d.left, d.right], sampleRate: d.sampleRate });
        }
      };
    });

    // Tap into the master output; the node emits silence to destination so it
    // is pulled every quantum without doubling the audible signal.
    tap.connect(node);
    node.connect(ctx.destination);

    const startTime = ctx.currentTime + leadSec;
    const endTime = startTime + totalSec;
    node.port.postMessage({ type: 'window', startTime, endTime });

    // Restart the scene + start the transport so the window captures beat 1.
    onStart(startTime);

    try {
      return await done;
    } finally {
      try { tap.disconnect(node); } catch { /* already torn down */ }
      try { node.disconnect(); } catch { /* already torn down */ }
    }
  }
}
