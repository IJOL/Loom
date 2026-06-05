// src/samples/slice-to-bank.ts
// Mode 2 helpers: turn cut slice buffers into bank samples + a single-note
// keymap (one consecutive note per slice from SLICE_BASE_NOTE). The original
// loop's audio thereby lives in the bank, played via the normal keymap one-shot
// path (no clip-local slice regions).

import type { KeymapEntry } from './types';
import { SLICE_BASE_NOTE } from '../core/slice-clip';
import { encodeWavPcm16 } from '../export/wav-encoder';

/** One single-note keymap entry per slice id, consecutive from `baseNote`. */
export function slicesToKeymap(sliceIds: string[], baseNote: number = SLICE_BASE_NOTE): KeymapEntry[] {
  return sliceIds.map((sampleId, i) => ({
    sampleId, rootNote: baseNote + i, loNote: baseNote + i, hiNote: baseNote + i,
  }));
}

/** AudioBuffer → 16-bit PCM WAV bytes (for SampleStore persistence). */
export async function audioBufferToWavBytes(buf: AudioBuffer): Promise<ArrayBuffer> {
  const chans: Float32Array[] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c).slice());
  const blob = encodeWavPcm16(chans, buf.sampleRate);
  return blob.arrayBuffer();
}
