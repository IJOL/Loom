// src/export/kernel-lane-render.test.ts
// The offline kernel render path: renderKernelLane drives the same per-sample
// VoiceManager the worklet uses, summing a lane's notes into a Float32Array.
// Pure (no Web Audio), so it runs in the default vitest environment.

import { describe, it, expect, beforeAll } from 'vitest';
import { renderKernelLane, type KernelLaneSpec } from './kernel-lane-render';
import type { NoteSpec } from '../audio-dsp/types';
// Register the kernel renderers (side-effect imports).
import '../audio-dsp/subtractive-renderer';
import '../audio-dsp/tb303-renderer';

function rms(ch: Float32Array): number {
  let s = 0;
  for (let i = 0; i < ch.length; i++) s += ch[i] * ch[i];
  return Math.sqrt(s / ch.length);
}

const SR = 44100;

function note(beginSec: number, durationSec: number, midi: number): NoteSpec {
  return { midi, beginSec, durationSec, velocity: 0.8, accent: false, slide: false };
}

describe('renderKernelLane (pure kernel offline synthesis)', () => {
  beforeAll(() => { /* renderers self-register on import */ });

  it('renders a non-silent buffer for a subtractive lane', () => {
    const spec: KernelLaneSpec = {
      engineId: 'subtractive',
      params: { 'osc1.level': 0.9, 'filter.cutoff': 0.7, 'amp.sustain': 0.8 },
      maxVoices: 8, mods: [],
      notes: [{ note: note(0, 0.4, 48) }, { note: note(0.25, 0.4, 55) }],
    };
    const frames = Math.ceil(0.8 * SR);
    const buf = renderKernelLane(spec, frames, SR);
    expect(buf.length).toBe(frames);
    expect(rms(buf)).toBeGreaterThan(1e-4);
  });

  it('a louder ParamBag renders louder than a quiet one (params reach the renderer)', () => {
    const mk = (lvl: number, sus: number): KernelLaneSpec => ({
      engineId: 'subtractive',
      params: { 'osc1.level': lvl, 'osc2.level': 0, 'sub.level': 0, 'filter.cutoff': 0.9, 'amp.sustain': sus },
      maxVoices: 4, mods: [],
      notes: [{ note: note(0, 0.5, 48) }],
    });
    const frames = Math.ceil(0.6 * SR);
    const loud = rms(renderKernelLane(mk(1, 0.9), frames, SR));
    const quiet = rms(renderKernelLane(mk(0.1, 0.1), frames, SR));
    expect(loud).toBeGreaterThan(quiet * 1.5);
  });

  it('per-note ParamBag snapshots are captured at spawn (automation parity)', () => {
    // Two notes: the first spawned with a dark cutoff, the second with a bright
    // one. The second half of the render must be brighter than the first.
    const brightness = (ch: Float32Array): number => {
      let s = 0;
      for (let i = 1; i < ch.length; i++) s += Math.abs(ch[i] - ch[i - 1]);
      return s / Math.max(1, ch.length - 1);
    };
    const base = { 'osc1.wave': 0, 'osc1.level': 0.9, 'osc2.level': 0, 'sub.level': 0,
      'filter.resonance': 0.1, 'filter.envAmount': 0, 'amp.sustain': 0.9, 'filter.builtinEnv': 1 };
    const spec: KernelLaneSpec = {
      engineId: 'subtractive',
      params: { ...base, 'filter.cutoff': 0.1 },
      maxVoices: 4, mods: [],
      notes: [
        { note: note(0, 0.45, 48), params: { ...base, 'filter.cutoff': 0.1 } },
        { note: note(0.5, 0.45, 48), params: { ...base, 'filter.cutoff': 0.95 } },
      ],
    };
    const frames = Math.ceil(1.0 * SR);
    const buf = renderKernelLane(spec, frames, SR);
    const half = Math.floor(frames / 2);
    const b1 = brightness(buf.subarray(0, half));
    const b2 = brightness(buf.subarray(half));
    expect(b2).toBeGreaterThan(b1 * 1.5);
  });

  it('velocity drives loudness: vel 120 is louder than vel 40', () => {
    // Pins the velocity→loudness contract at the kernel level (the legacy
    // velocity-gain.dsp.test rendered the deleted node-per-note engines).
    const mk = (vel127: number): KernelLaneSpec => ({
      engineId: 'subtractive',
      params: { 'osc1.level': 0.9, 'osc2.level': 0, 'sub.level': 0, 'filter.cutoff': 0.8, 'amp.sustain': 0.8 },
      maxVoices: 4, mods: [],
      notes: [{ note: { midi: 60, beginSec: 0, durationSec: 0.4, velocity: vel127 / 127, accent: false, slide: false } }],
    });
    const frames = Math.ceil(0.5 * SR);
    const soft = rms(renderKernelLane(mk(40), frames, SR));
    const loud = rms(renderKernelLane(mk(120), frames, SR));
    expect(loud).toBeGreaterThan(soft * 1.2);
  });

  it('renders a tb303 lane non-silent', () => {
    const spec: KernelLaneSpec = {
      engineId: 'tb303',
      params: { 'filter.cutoff': 0.6, 'filter.resonance': 0.5, 'env.amount': 0.5, 'env.decay': 0.4 },
      maxVoices: 1, mods: [],
      notes: [{ note: note(0, 0.2, 40) }, { note: note(0.25, 0.2, 43) }],
    };
    const frames = Math.ceil(0.6 * SR);
    const buf = renderKernelLane(spec, frames, SR);
    expect(rms(buf)).toBeGreaterThan(1e-4);
  });
});
