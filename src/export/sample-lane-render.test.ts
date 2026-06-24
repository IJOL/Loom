// src/export/sample-lane-render.test.ts
import { describe, it, expect } from 'vitest';
import { renderDrumLane, renderSampleLane, type OfflineDrumHit, type OfflineSampleSpawn } from './sample-lane-render';
import { seedSynthState, BY_ID } from '../core/drums';
import type { SampleData, SampleSpawn } from '../audio-dsp/sample/types';

const SR = 44100;
const rms = (b: Float32Array) => { let s = 0; for (let i = 0; i < b.length; i++) s += b[i] * b[i]; return Math.sqrt(s / b.length); };
const tone = (n: number): SampleData => {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = Math.sin(2 * Math.PI * 440 * i / SR);
  return { channels: [c], sampleRate: SR };
};
const spawn = (o: Partial<SampleSpawn> = {}): SampleSpawn => ({
  sampleId: 's', beginSec: 0, gateSec: 0.1, rate: 1, offsetSec: 0,
  loop: false, loopStartSec: 0, loopEndSec: 0,
  cutoff: 1, res: 0, attack: 0.005, decay: 0.05,
  level: 1, pan: 0, rev: 0, dly: 0, gain: 1, ...o,
});

describe('renderDrumLane (offline)', () => {
  const kit = BY_ID['909'];
  const bags = seedSynthState(kit);

  it('renders non-silent stereo for kick hits', () => {
    const hits: OfflineDrumHit[] = [
      { voice: 'kick', beginSec: 0, velocity: 0.8 },
      { voice: 'kick', beginSec: 0.25, velocity: 0.8 },
    ];
    const { l, r } = renderDrumLane(hits, { kick: bags.kick }, { kick: { level: 1, pan: 0 } }, SR, SR);
    expect(rms(l)).toBeGreaterThan(1e-3);
    expect(rms(r)).toBeGreaterThan(1e-3);
  });

  it('per-voice pan steers energy to one side', () => {
    const hits: OfflineDrumHit[] = [{ voice: 'kick', beginSec: 0, velocity: 0.9 }];
    const left = renderDrumLane(hits, { kick: bags.kick }, { kick: { level: 1, pan: -1 } }, SR, SR);
    expect(rms(left.l)).toBeGreaterThan(rms(left.r) * 5);
  });

  it('no hits → silence', () => {
    const { l } = renderDrumLane([], { kick: bags.kick }, {}, SR, SR);
    expect(rms(l)).toBe(0);
  });
});

describe('renderSampleLane (offline)', () => {
  it('renders non-silent stereo for a sampler spawn', () => {
    const spawns: OfflineSampleSpawn[] = [{ kind: 'sampler', spawn: spawn(), data: tone(SR) }];
    const { l, r } = renderSampleLane(spawns, SR, SR);
    expect(rms(l)).toBeGreaterThan(1e-3);
    expect(rms(r)).toBeGreaterThan(1e-3);
  });

  it('renders an audio-clip spawn (flat, no filter)', () => {
    const spawns: OfflineSampleSpawn[] = [{ kind: 'audio', spawn: spawn({ gateSec: 0.2 }), data: tone(SR) }];
    const { l } = renderSampleLane(spawns, SR, SR);
    expect(rms(l)).toBeGreaterThan(1e-3);
  });

  it('two spawns at the same id share the bank (no double-register crash)', () => {
    const spawns: OfflineSampleSpawn[] = [
      { kind: 'sampler', spawn: spawn({ beginSec: 0 }), data: tone(SR) },
      { kind: 'sampler', spawn: spawn({ beginSec: 0.05 }), data: tone(SR) },
    ];
    const { l } = renderSampleLane(spawns, SR, SR);
    expect(rms(l)).toBeGreaterThan(1e-3);
  });
});
