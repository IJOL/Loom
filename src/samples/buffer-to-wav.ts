// src/samples/buffer-to-wav.ts
// Slice a decoded AudioBuffer to a time range and encode it as a 16-bit WAV File
// — used to send just a clip's loop region to the /transcribe backend.
import { encodeWavPcm16 } from '../export/wav-encoder';

/** Encode `buffer[startSec, endSec)` as a 16-bit PCM WAV File named `name`.
 *  Clamps the range to the buffer; preserves channel count + sample rate. */
export function sliceBufferToWavFile(
  buffer: AudioBuffer, startSec: number, endSec: number, name: string,
): File {
  const sr = buffer.sampleRate;
  const s = Math.max(0, Math.floor(startSec * sr));
  const e = Math.max(s + 1, Math.min(buffer.length, Math.ceil(endSec * sr)));
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    channels.push(buffer.getChannelData(ch).subarray(s, e));
  }
  const blob = encodeWavPcm16(channels, sr);
  return new File([blob], name, { type: 'audio/wav' });
}
