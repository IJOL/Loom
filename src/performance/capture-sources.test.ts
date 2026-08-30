// @vitest-environment jsdom
// src/performance/capture-sources.test.ts — jsdom for a real `navigator`
// (without mediaDevices), so the external sources fail down their own paths.
import { describe, it, expect } from 'vitest';
import { resolveCaptureSource } from './capture-sources';

describe('resolveCaptureSource', () => {
  it('master resolves to the tap itself, internal, with a no-op release', async () => {
    const tap = {} as AudioNode;
    const src = await resolveCaptureSource('master', {} as AudioContext, tap);
    expect(src.node).toBe(tap);
    expect(src.external).toBe(false);
    expect(() => src.release()).not.toThrow();
  });

  it('system/mic fail with a clear message when the API is unavailable (jsdom)', async () => {
    await expect(resolveCaptureSource('system', {} as AudioContext, {} as AudioNode))
      .rejects.toThrow(/system audio/i);
    await expect(resolveCaptureSource('mic', {} as AudioContext, {} as AudioNode))
      .rejects.toThrow(/microphone/i);
  });
});
