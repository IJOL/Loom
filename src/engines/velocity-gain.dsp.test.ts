// src/engines/velocity-gain.dsp.test.ts
import { describe, it, expect } from 'vitest';
// Importing the engine modules runs their registerEngineFactory side-effects
// (the registry is NOT plugin-bootstrapped in tests), so createEngineInstance works.
import './subtractive';
import './fm';
import './wavetable';
import './karplus';
import './tb303';
import { createEngineInstance } from './registry';
import { rms } from '../../test/dsp-asserts';

function renderEngine(engineId: string, velocity: number): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, 44100, 44100);
  const engine = createEngineInstance(engineId)!;
  const voice = engine.createVoice(ctx as unknown as AudioContext, ctx.destination as unknown as AudioNode);
  voice.trigger(60, 0, { gateDuration: 0.4, accent: false, velocity });
  return ctx.startRendering().then((b) => b.getChannelData(0));
}

describe('velocity drives loudness', () => {
  for (const id of ['subtractive', 'fm', 'wavetable', 'karplus', 'tb303']) {
    it(`${id}: vel 120 is louder than vel 40`, async () => {
      const soft = rms(await renderEngine(id, 40));
      const loud = rms(await renderEngine(id, 120));
      expect(loud).toBeGreaterThan(soft * 1.2);
    });
  }
});
