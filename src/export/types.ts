// src/export/types.ts
// Shared contract for scene export. Both capture backends (real-time now,
// offline later) return RenderedAudio; the encoder + download steps are
// identical for both. The encoder seam is where MP3 plugs in later.

/** Channel-major PCM produced by any capture backend. channels[0] = left,
 *  channels[1] = right (mono backends may return a single channel). */
export interface RenderedAudio {
  channels: Float32Array[];
  sampleRate: number;
}

/** Encodes PCM into a downloadable Blob. WAV now; MP3/other later. */
export interface AudioEncoder {
  /** File extension without the dot, e.g. "wav". */
  readonly extension: string;
  /** MIME type for the Blob, e.g. "audio/wav". */
  readonly mimeType: string;
  encode(channels: Float32Array[], sampleRate: number): Blob;
}

/** A backend that fills a buffer for `totalSec` seconds and returns it. */
export interface SceneRecorder {
  record(totalSec: number): Promise<RenderedAudio>;
}
