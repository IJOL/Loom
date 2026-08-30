// src/app/loop-capture-wiring.ts
// The browser half of loop capture: build the source → recorder-worklet chain
// (the same connect/teardown shape as export/live-take.ts, including the
// silent keep-alive into destination), and wrap a finished take as a WAV File
// for the round-1 drop ingestion gate. The controller in
// performance/loop-capture.ts stays DOM- and AudioContext-free.

import { RECORDER_PROCESSOR_NAME, ensureRecorderWorklet } from '../export/recorder-worklet';
import { encodeWavPcm16 } from '../export/wav-encoder';
import { resolveCaptureSource, type CaptureSourceKind, type CaptureSource } from '../performance/capture-sources';
import type { CaptureSession, CaptureTake } from '../performance/loop-capture';

export interface CaptureWiringDeps {
  ctx: AudioContext;
  /** audio-graph's masterComp.output — the same node the ⏱ live take records. */
  masterTap: AudioNode;
  getSource(): CaptureSourceKind;
  /** 🎧 — read live so the toggle acts mid-capture. External sources only. */
  getMonitor(): boolean;
}

export function takeToFile(take: CaptureTake, n: number): File {
  const blob = encodeWavPcm16([take.left, take.right], take.sampleRate);
  return new File([blob], `Capture ${n}.wav`, { type: 'audio/wav' });
}

export function createCaptureSessionFactory(deps: CaptureWiringDeps) {
  return async (onDone: (take: CaptureTake) => void): Promise<CaptureSession> => {
    const { ctx } = deps;
    await ensureRecorderWorklet(ctx);
    const source: CaptureSource = await resolveCaptureSource(deps.getSource(), ctx, deps.masterTap);
    const node = new AudioWorkletNode(ctx, RECORDER_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });
    // Monitoring path for external sources; a gain so the toggle is a connect,
    // not a rebuild. The master needs none — it is already audible.
    const monitor = source.external ? new GainNode(ctx, { gain: 1 }) : null;
    let monitoring = false;
    const setMonitor = (on: boolean) => {
      if (!monitor || on === monitoring) return;
      monitoring = on;
      if (on) { source.node.connect(monitor); monitor.connect(ctx.destination); }
      else { try { source.node.disconnect(monitor); monitor.disconnect(); } catch { /* torn down */ } }
    };
    const teardown = () => {
      setMonitor(false);
      try { source.node.disconnect(node); } catch { /* already torn down */ }
      try { node.disconnect(); } catch { /* already torn down */ }
      source.release();
    };
    node.port.onmessage = (e: MessageEvent) => {
      const d = e.data as { type: string; left: Float32Array; right: Float32Array; sampleRate: number };
      if (d?.type !== 'done') return;
      teardown();
      onDone({ left: d.left, right: d.right, sampleRate: d.sampleRate });
    };
    source.node.connect(node);
    node.connect(ctx.destination); // silent keep-alive: the node must be pulled
    setMonitor(deps.getMonitor());
    return {
      setWindow: (startSec, endSec) => {
        setMonitor(deps.getMonitor()); // cheap re-read: the 🎧 may have toggled
        node.port.postMessage({ type: 'window', startTime: startSec, endTime: endSec });
      },
      cancel: teardown,
    };
  };
}
