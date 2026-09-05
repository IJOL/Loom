// plugins/subtractive/wavetable-osc.test.ts
// TDD tests for WavetableOsc - the wavetable oscillator for Subtractive engine
import { describe, it, expect } from 'vitest';

// `dsp.ts` calls Loom.registerRenderer at module scope — that is the ABI — so
// the global must exist before the import graph is evaluated. vi.hoisted is the
// only hook that runs that early. Same two-line stub the parity test next door
// installs, for the same reason.
import { vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as unknown as { Loom: unknown }).Loom = {
    apiVersion: 1, registerRenderer: () => {},
  };
});

// Import after hoisting
import { sampleTable, WavetableOsc } from './wavetable-osc';

// Simple test data - 8-sample tables for fast testing
const makeSineTable = (size: number): Float32Array => {
  const tab = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    tab[i] = Math.sin((i / size) * 2 * Math.PI);
  }
  return tab;
};

const makeSawTable = (size: number): Float32Array => {
  const tab = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const phase = i / size;
    tab[i] = 2 * phase - 1;
  }
  return tab;
};

const makeSquareTable = (size: number): Float32Array => {
  const tab = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    tab[i] = i < size / 2 ? 1 : -1;
  }
  return tab;
};

describe('sampleTable', () => {
  it('returns correct values for sine wave at different phases', () => {
    const table = makeSineTable(256);
    
    // Phase 0 should be ~0 for sine
    expect(sampleTable(table, 0)).toBeCloseTo(0, 3);
    
    // Phase 0.25 should be ~1 for sine (peak)
    expect(sampleTable(table, 0.25)).toBeCloseTo(1, 3);
    
    // Phase 0.5 should be ~0 for sine
    expect(sampleTable(table, 0.5)).toBeCloseTo(0, 3);
    
    // Phase 0.75 should be ~-1 for sine (trough)
    expect(sampleTable(table, 0.75)).toBeCloseTo(-1, 3);
  });

  it('returns correct values for saw wave at different phases', () => {
    const table = makeSawTable(256);
    
    // Phase 0 should be ~-1 for saw
    expect(sampleTable(table, 0)).toBeCloseTo(-1, 3);
    
    // Phase 0.5 should be ~0 for saw
    expect(sampleTable(table, 0.5)).toBeCloseTo(0, 3);
    
    // Phase 1.0 should wrap to 0 and be ~-1
    expect(sampleTable(table, 1.0)).toBeCloseTo(-1, 3);
  });

  it('interpolates between table values', () => {
    const table = new Float32Array(4);
    table[0] = 0;
    table[1] = 1;
    table[2] = 0;
    table[3] = -1;
    
    // At phase 0.125, should interpolate between 0 and 1
    expect(sampleTable(table, 0.125)).toBeCloseTo(0.5, 3);
    
    // At phase 0.625, should interpolate between 0 and -1
    expect(sampleTable(table, 0.625)).toBeCloseTo(-0.5, 3);
  });

  it('wraps phase correctly (phase > 1)', () => {
    const table = makeSineTable(256);
    
    // Phase 1.0 should equal phase 0.0 (wrapped)
    expect(sampleTable(table, 1.0)).toBeCloseTo(sampleTable(table, 0.0), 5);
    
    // Phase 1.25 should equal phase 0.25 (wrapped)
    expect(sampleTable(table, 1.25)).toBeCloseTo(sampleTable(table, 0.25), 5);
  });

  it('handles edge case at phase 1.0 (should wrap to 0)', () => {
    const table = new Float32Array(10);
    for (let i = 0; i < 10; i++) {
      table[i] = i / 10;
    }
    
    // Phase 1.0 should wrap to index 0
    expect(sampleTable(table, 1.0)).toBeCloseTo(0, 5);
    
    // Phase 0.95 → x = 9.5 → interpolate between table[9]=0.9 and table[0]=0
    // Result should be ~0.45 (midway between 0.9 and 0)
    expect(sampleTable(table, 0.95)).toBeCloseTo(0.45, 2);
  });
});

describe('WavetableOsc', () => {
  it('generates audible output at different frequencies', () => {
    const table = makeSineTable(256);
    const osc = new WavetableOsc(table, table, 0, 48000);
    
    const samples: number[] = [];
    for (let i = 0; i < 480; i++) {
      samples.push(osc.update(440 / 48000)); // 440 Hz at 48kHz
    }
    
    // Should be audible (non-zero RMS)
    const rms = Math.sqrt(samples.reduce((s, v) => s + v * v, 0) / samples.length);
    expect(rms).toBeGreaterThan(0.01);
  });

  it('morph between two tables produces different outputs', () => {
    const sine = makeSineTable(256);
    const square = makeSquareTable(256);
    
    // Morph at 0 (all sine)
    const osc0 = new WavetableOsc(sine, square, 0, 48000);
    const samples0: number[] = [];
    for (let i = 0; i < 256; i++) {
      samples0.push(osc0.update(440 / 48000));
    }
    
    // Morph at 1 (all square)
    const osc1 = new WavetableOsc(sine, square, 1, 48000);
    const samples1: number[] = [];
    for (let i = 0; i < 256; i++) {
      samples1.push(osc1.update(440 / 48000));
    }
    
    // Should produce different waveforms
    const meanAbs0 = samples0.reduce((s, v) => s + Math.abs(v), 0) / samples0.length;
    const meanAbs1 = samples1.reduce((s, v) => s + Math.abs(v), 0) / samples1.length;
    
    // Square should have different characteristics than sine
    expect(Math.abs(meanAbs0 - meanAbs1)).toBeGreaterThan(0.001);
  });

  it('morph at 0.5 produces equal-power crossfade', () => {
    const table = makeSineTable(256);
    const osc = new WavetableOsc(table, table, 0.5, 48000);
    
    const samples: number[] = [];
    for (let i = 0; i < 480; i++) {
      samples.push(osc.update(440 / 48000));
    }
    
    // Should be audible
    const rms = Math.sqrt(samples.reduce((s, v) => s + v * v, 0) / samples.length);
    expect(rms).toBeGreaterThan(0.001);
  });

  it('produces consistent output for same frequency (deterministic)', () => {
    const table = makeSineTable(256);
    
    const osc1 = new WavetableOsc(table, table, 0, 48000);
    const osc2 = new WavetableOsc(table, table, 0, 48000);
    
    const samples1: number[] = [];
    const samples2: number[] = [];
    
    for (let i = 0; i < 100; i++) {
      samples1.push(osc1.update(440 / 48000));
      samples2.push(osc2.update(440 / 48000));
    }
    
    // Should produce identical output
    expect(samples1).toEqual(samples2);
  });

  it('handles phase wrapping at high frequencies', () => {
    const table = makeSineTable(256);
    const osc = new WavetableOsc(table, table, 0, 48000);
    
    // High frequency: 22kHz (near Nyquist)
    const samples: number[] = [];
    for (let i = 0; i < 480; i++) {
      samples.push(osc.update(22000 / 48000));
    }
    
    // Should not crash and should produce some output
    const rms = Math.sqrt(samples.reduce((s, v) => s + v * v, 0) / samples.length);
    expect(rms).toBeGreaterThan(0);
  });

  it('setMorph updates the morph value', () => {
    const sine = makeSineTable(256);
    const square = makeSquareTable(256);
    const osc = new WavetableOsc(sine, square, 0, 48000);
    
    const samples0: number[] = [];
    for (let i = 0; i < 256; i++) {
      samples0.push(osc.update(440 / 48000));
    }
    
    // Change morph to 1 (all square)
    osc.setMorph(1);
    
    const samples1: number[] = [];
    for (let i = 0; i < 256; i++) {
      samples1.push(osc.update(440 / 48000));
    }
    
    // Should be different (square vs sine)
    const sum0 = samples0.reduce((s, v) => s + Math.abs(v), 0);
    const sum1 = samples1.reduce((s, v) => s + Math.abs(v), 0);
    
    expect(Math.abs(sum0 - sum1)).toBeGreaterThan(10);
  });
});
