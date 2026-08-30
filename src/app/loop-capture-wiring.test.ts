// src/app/loop-capture-wiring.test.ts
import { describe, it, expect } from 'vitest';
import { takeToFile } from './loop-capture-wiring';

describe('takeToFile', () => {
  it('wraps the PCM as a WAV File the drop gate accepts by extension', async () => {
    const take = { left: new Float32Array(48), right: new Float32Array(48), sampleRate: 48000 };
    const f = takeToFile(take, 3);
    expect(f.name).toBe('Capture 3.wav');
    expect(f.type).toBe('audio/wav');
    const bytes = new Uint8Array(await f.arrayBuffer());
    // RIFF header + 44-byte header + 48 frames * 2 ch * 2 bytes
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF');
    expect(bytes.length).toBe(44 + 48 * 4);
  });
});
