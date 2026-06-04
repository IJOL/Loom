// src/export/wav-encoder.ts
// 16-bit PCM WAV encoder for the browser (DataView/Blob, no Node Buffer).
// Channel-major Float32 in, interleaved 16-bit WAV Blob out.

import type { AudioEncoder } from './types';

export function encodeWavPcm16(channels: Float32Array[], sampleRate: number): Blob {
  const numChannels = Math.max(1, channels.length);
  const numFrames = channels.length > 0 ? channels[0].length : 0;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numFrames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);           // fmt chunk size
  view.setUint16(20, 1, true);            // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);           // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const v = channels[ch][i] ?? 0;
      const clamped = Math.max(-1, Math.min(1, v));
      const s = clamped < 0 ? clamped * 32768 : clamped * 32767;
      view.setInt16(offset, Math.round(s), true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export const wavEncoder: AudioEncoder = {
  extension: 'wav',
  mimeType: 'audio/wav',
  encode: encodeWavPcm16,
};
