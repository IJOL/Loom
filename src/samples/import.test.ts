import { describe, it, expect } from 'vitest';
import { buildSampleAsset } from './import';

describe('buildSampleAsset', () => {
  it('derives duration/sampleRate/channels from the decoded buffer', () => {
    // node-web-audio-api is globalised in test/setup.ts.
    const ctx = new OfflineAudioContext(1, 1, 44100);
    const buffer = ctx.createBuffer(2, 22050, 44100); // 0.5s, stereo

    const asset = buildSampleAsset({
      id: 'smp-x',
      name: 'kick.wav',
      mime: 'audio/wav',
      bytes: new Uint8Array([0, 1, 2]).buffer,
      buffer,
      createdAt: 123,
    });

    expect(asset.id).toBe('smp-x');
    expect(asset.channels).toBe(2);
    expect(asset.sampleRate).toBe(44100);
    expect(asset.durationSec).toBeCloseTo(0.5, 3);
    expect(asset.createdAt).toBe(123);
  });
});
