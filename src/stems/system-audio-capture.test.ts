// @vitest-environment jsdom
// The stream-request failure paths — the only part of this browser-only file
// a unit test can honestly reach (jsdom has no getDisplayMedia).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { requestSystemAudioStream } from './system-audio-capture';

afterEach(() => vi.unstubAllGlobals());

describe('requestSystemAudioStream', () => {
  it('rejects with the support message when getDisplayMedia is absent', async () => {
    await expect(requestSystemAudioStream()).rejects.toThrow(/does not support/i);
  });

  it('releases every track and rejects when no audio was shared', async () => {
    const stop = vi.fn();
    const fakeStream = {
      getAudioTracks: () => [],
      getTracks: () => [{ stop }, { stop }],
    };
    vi.stubGlobal('navigator', {
      mediaDevices: { getDisplayMedia: vi.fn(async () => fakeStream) },
    });
    await expect(requestSystemAudioStream()).rejects.toThrow(/no audio was shared/i);
    expect(stop).toHaveBeenCalledTimes(2); // the screen-share must not stay live
  });
});
