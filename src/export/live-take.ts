// src/export/live-take.ts
// Real-time "live take" recorder: arm → (on transport Play) capture open-ended →
// (on any Stop) finalize with a tail and deliver the take. Unlike the fixed-
// window RealtimeSceneRecorder, this records exactly from the downbeat until the
// user stops, so the full performance (including scene changes) is captured.
//
// Arming pre-connects the worklet tap (capturing nothing, startTime=Infinity) so
// that starting the capture on Play is a single cheap port message — the audio
// thread is already live, giving sample-tight sync to the first beat.

import type { RenderedAudio } from './types';
import { RECORDER_PROCESSOR_NAME, ensureRecorderWorklet } from './recorder-worklet';

export type LiveTakeState = 'idle' | 'armed' | 'recording';

export interface LiveTakeDeps {
  ctx: AudioContext;
  /** Node carrying the full master signal (audio-graph `masterComp.output`). */
  tap: AudioNode;
  /** Seconds captured after Stop so reverb/delay tails aren't clipped. */
  tailSec: number;
  /** Notified on every state change so the UI can reflect armed/recording/idle. */
  onState: (s: LiveTakeState) => void;
  /** Called with the finished take's PCM when a recording finalizes. */
  onTake: (audio: RenderedAudio) => void;
  /** Called with a human-readable message if arming/recording fails. */
  onError: (message: string) => void;
}

export class LiveTakeRecorder {
  private state: LiveTakeState = 'idle';
  private node: AudioWorkletNode | null = null;

  constructor(private deps: LiveTakeDeps) {}

  isArmed(): boolean { return this.state === 'armed'; }
  isRecording(): boolean { return this.state === 'recording'; }
  isActive(): boolean { return this.state !== 'idle'; }

  /** Toggle arm: idle→armed (pre-connect tap + wait for Play); armed→idle
   *  (cancel + tear down). No-op while recording. */
  async toggleArm(): Promise<void> {
    if (this.state === 'recording') return;
    if (this.state === 'armed') { this.teardown(); this.setState('idle'); return; }
    try {
      await this.connect();
      this.setState('armed');
    } catch (err) {
      this.teardown();
      this.setState('idle');
      this.deps.onError('No se pudo armar la grabación: ' + ((err as Error)?.message ?? String(err)));
    }
  }

  /** Transport started (Play): if armed, begin capturing from this instant. */
  onTransportStart(): void {
    if (this.state !== 'armed' || !this.node) return;
    this.node.port.postMessage({ type: 'window', startTime: this.deps.ctx.currentTime, endTime: Infinity });
    this.setState('recording');
  }

  /** Called by the unified stop. If recording, tell the worklet to finalize after
   *  the tail; the 'done' handler then delivers the take and resets to idle. */
  finish(): void {
    // Stopped while armed but never played → tear down the live tap (no take),
    // so the worklet node isn't leaked and the UI returns to idle.
    if (this.state === 'armed') { this.teardown(); this.setState('idle'); return; }
    if (this.state !== 'recording' || !this.node) return;
    this.node.port.postMessage({ type: 'stop', tailSec: this.deps.tailSec });
  }

  private async connect(): Promise<void> {
    const { ctx, tap } = this.deps;
    await ensureRecorderWorklet(ctx);
    const node = new AudioWorkletNode(ctx, RECORDER_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });
    node.port.onmessage = (e: MessageEvent) => {
      const d = e.data as { type: string; left: Float32Array; right: Float32Array; sampleRate: number };
      if (d && d.type === 'done') {
        const take: RenderedAudio = { channels: [d.left, d.right], sampleRate: d.sampleRate };
        this.teardown();
        this.setState('idle');
        this.deps.onTake(take);
      }
    };
    // Tap the master output; the node emits silence to destination so it is
    // pulled every quantum without doubling the audible signal.
    tap.connect(node);
    node.connect(ctx.destination);
    // Armed but capturing nothing until onTransportStart sets a real startTime.
    node.port.postMessage({ type: 'window', startTime: Infinity, endTime: Infinity });
    this.node = node;
  }

  private teardown(): void {
    if (!this.node) return;
    try { this.deps.tap.disconnect(this.node); } catch { /* already torn down */ }
    try { this.node.disconnect(); } catch { /* already torn down */ }
    this.node = null;
  }

  private setState(s: LiveTakeState): void {
    this.state = s;
    this.deps.onState(s);
  }
}
