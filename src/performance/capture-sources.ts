// src/performance/capture-sources.ts
// Every capture source resolves to the same shape: an AudioNode to feed the
// recorder worklet, and a release() for teardown. The controller never knows
// which one it holds. Master is phase 1; system audio and mic land in later
// tasks of the same round — until then they fail with the message the toast
// shows.

export type CaptureSourceKind = 'master' | 'system' | 'mic';

export interface CaptureSource {
  node: AudioNode;
  release(): void;
  /** External sources (system/mic) may be monitored through 🎧; the master is
   *  already audible. */
  external: boolean;
}

export async function resolveCaptureSource(
  kind: CaptureSourceKind, ctx: AudioContext, masterTap: AudioNode,
): Promise<CaptureSource> {
  if (kind === 'master') return { node: masterTap, release: () => {}, external: false };
  if (kind === 'system') return resolveSystemSource(ctx);
  return resolveMicSource(ctx);
}

async function resolveSystemSource(ctx: AudioContext): Promise<CaptureSource> {
  const { requestSystemAudioStream } = await import('../stems/system-audio-capture');
  const { stream, release } = await requestSystemAudioStream();
  const node = new MediaStreamAudioSourceNode(ctx, { mediaStream: stream });
  return {
    node,
    release: () => { try { node.disconnect(); } catch { /* torn down */ } release(); },
    external: true,
  };
}

async function resolveMicSource(ctx: AudioContext): Promise<CaptureSource> {
  const md = navigator.mediaDevices;
  if (!md?.getUserMedia) throw new Error('Your browser does not support microphone capture.');
  // Music, not speech: leave the signal alone.
  const stream = await md.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const node = new MediaStreamAudioSourceNode(ctx, { mediaStream: stream });
  return {
    node,
    release: () => {
      try { node.disconnect(); } catch { /* torn down */ }
      stream.getTracks().forEach((t) => t.stop());
    },
    external: true,
  };
}
