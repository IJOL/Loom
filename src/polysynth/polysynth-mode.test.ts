import { describe, it, expect } from 'vitest';
import '../../test/setup';
import { OfflineAudioContext } from 'node-web-audio-api';
import { PolySynth } from './polysynth';

describe('PolySynth.setMode', () => {
  it('mono mode forces maxVoices to 1', () => {
    const ctx = new OfflineAudioContext(1, 44100, 44100) as unknown as AudioContext;
    const ps = new PolySynth(ctx, ctx.destination);
    ps.setMaxVoices(8);
    ps.setMode('mono');
    expect(ps.maxVoices).toBe(1);
  });

  it('poly mode restores user-set maxVoices', () => {
    const ctx = new OfflineAudioContext(1, 44100, 44100) as unknown as AudioContext;
    const ps = new PolySynth(ctx, ctx.destination);
    ps.setMaxVoices(6);
    ps.setMode('mono');
    ps.setMode('poly');
    expect(ps.maxVoices).toBe(6);
  });

  it('setRetrig(false) in mono mode keeps the envelope going across notes', () => {
    const ctx = new OfflineAudioContext(1, 44100, 44100) as unknown as AudioContext;
    const ps = new PolySynth(ctx, ctx.destination);
    ps.setMode('mono');
    ps.setRetrig(false);  // legato
    ps.trigger(60, 0, 1);
    ps.trigger(64, 0.1, 1);
    // Legato: re-pitches in place; no new voice subgraph allocated.
    expect(ps.activeVoiceCount()).toBe(1);
  });

  it('setRetrig(true) in mono mode restarts the voice per note', () => {
    const ctx = new OfflineAudioContext(1, 44100, 44100) as unknown as AudioContext;
    const ps = new PolySynth(ctx, ctx.destination);
    ps.setMode('mono');
    ps.setRetrig(true);   // retrig (default)
    ps.trigger(60, 0, 1);
    ps.trigger(64, 0.1, 1);
    // Retrig: the 2nd trigger steals the first via the maxVoices=1 cap and
    // allocates a fresh voice.
    expect(ps.activeVoiceCount()).toBe(1);
  });
});
