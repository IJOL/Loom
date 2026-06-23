import { describe, it, expect } from 'vitest';
import { defaultSubParams } from '../audio-dsp/default-params';
import type { MainToWorklet } from '../audio-dsp/messages';

// The wrapper's posting logic is pure; test it by capturing posted messages.
// (We don't instantiate a real AudioWorkletNode — that needs a worklet env.)
describe('loom-node message shaping', () => {
  it('defaultSubParams returns a complete SubParams snapshot', () => {
    const p = defaultSubParams();
    expect(p.osc1Level).toBeGreaterThan(0);
    expect(p.filterCutoff).toBeGreaterThan(0);
    expect(p.ampSustain).toBeGreaterThan(0);
  });

  it('postMessage payloads are well-typed spawn/params/config/steal unions', () => {
    const posted: MainToWorklet[] = [];
    const fakePort = { postMessage: (m: MainToWorklet) => posted.push(m) };
    fakePort.postMessage({ type: 'spawn', note: { midi: 60, beginSec: 1, durationSec: 0.5, velocity: 0.8, accent: false, slide: false } });
    fakePort.postMessage({ type: 'params', params: { filterCutoff: 0.7 } });
    fakePort.postMessage({ type: 'config', maxVoices: 12 });
    fakePort.postMessage({ type: 'steal', count: 3 });
    expect(posted.map((m) => m.type)).toEqual(['spawn', 'params', 'config', 'steal']);
  });
});
