// src/samples/import.ts
// Turning an imported file into a SampleAsset. The pure metadata step is
// separated from the browser File/decode plumbing so it is unit-testable.

import type { SampleAsset } from './types';

/** Pure: assemble a SampleAsset from already-read bytes + a decoded buffer. */
export function buildSampleAsset(opts: {
  id: string;
  name: string;
  mime: string;
  bytes: ArrayBuffer;
  buffer: AudioBuffer;
  createdAt: number;
}): SampleAsset {
  return {
    id: opts.id,
    name: opts.name,
    mime: opts.mime,
    bytes: opts.bytes,
    durationSec: opts.buffer.duration,
    sampleRate: opts.buffer.sampleRate,
    channels: opts.buffer.numberOfChannels,
    createdAt: opts.createdAt,
  };
}

/** Allocate a fresh sample id. */
export function newSampleId(): string {
  return `smp-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36)}`;
}

/** Browser plumbing: read a File, decode it, build the asset. Not unit-tested
 *  (depends on File + decodeAudioData); verified manually / e2e in a later plan.
 *  decodeAudioData detaches its input ArrayBuffer, so we decode a copy and keep
 *  the original bytes for storage. */
export async function importFile(file: File, ctx: AudioContext): Promise<SampleAsset> {
  const bytes = await file.arrayBuffer();
  const buffer = await ctx.decodeAudioData(bytes.slice(0));
  return buildSampleAsset({
    id: newSampleId(),
    name: file.name,
    mime: file.type || 'application/octet-stream',
    bytes,
    buffer,
    createdAt: Date.now(),
  });
}
