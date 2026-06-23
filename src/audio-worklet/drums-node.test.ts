import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DRUM_VOICE_IDS } from '../audio-dsp/drums/types';
import { drumsHitMessage, drumsVoiceParamsMessage, type DrumsMsg } from './drums-node';

// The wrapper's posting logic is pure; test it by capturing posted messages.
// (We don't instantiate a real AudioWorkletNode — that needs a worklet env.)
describe('drums node message shaping', () => {
  it('exposes the 8 drum voices in canonical order', () => {
    expect(DRUM_VOICE_IDS).toEqual(['kick', 'snare', 'closedHat', 'openHat', 'clap', 'cowbell', 'tom', 'ride']);
  });

  it('hit + voiceParams payloads are well-shaped DrumsMsg unions', () => {
    const posted: DrumsMsg[] = [];
    const fakePort = { postMessage: (m: DrumsMsg) => posted.push(m) };
    fakePort.postMessage(drumsHitMessage('kick', 1, 0.8));
    fakePort.postMessage(drumsVoiceParamsMessage('snare', { decay: 0.2 }));
    expect(posted.map((m) => m.type)).toEqual(['hit', 'voiceParams']);
    expect(posted[0]).toMatchObject({ type: 'hit', voice: 'kick', beginSec: 1, velocity: 0.8 });
    expect(posted[1]).toMatchObject({ type: 'voiceParams', voice: 'snare', params: { decay: 0.2 } });
  });

  // Regression guard, mirroring the loom-node one: importing drums-processor.ts
  // as a normal ESM module on the main thread executes its top-level
  // `class extends AudioWorkletProcessor` + registerProcessor() → ReferenceError
  // at boot (those globals exist only in the worklet scope). The processor MUST
  // be referenced ONLY via the ?worker&url import (a separate worklet chunk); the
  // node refers to it by the registered string name "drums-processor".
  it('drums-node references drums-processor ONLY via ?worker&url (never a bare main-thread import)', () => {
    const src = readFileSync(new URL('./drums-node.ts', import.meta.url), 'utf8');
    // a bare `from './drums-processor'` (with or without .ts, no ?worker&url) is forbidden
    expect(src).not.toMatch(/from\s+['"]\.\/drums-processor(\.ts)?['"]/);
    // the allowed worker-url form must be present
    expect(src).toMatch(/\.\/drums-processor\.ts\?worker&url/);
    // the registered processor name string literal must be present
    expect(src).toMatch(/['"]drums-processor['"]/);
  });
});
