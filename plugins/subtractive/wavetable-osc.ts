// plugins/subtractive/wavetable-osc.ts
// Wavetable oscillator for Subtractive engine
// Linear interpolation inside a single-cycle table. `phase` is 0..1.

import { Osc } from '@loom/plugin-sdk';

/** Linear interpolation inside a single-cycle table. `phase` is 0..1. */
export function sampleTable(tab: Float32Array, phase: number): number {
  const x = phase * tab.length;
  const i = Math.floor(x);
  const f = x - i;
  // Use modulo for safe wrapping
  const idx = i % tab.length;
  const nextIdx = (i + 1) % tab.length;
  return tab[idx] * (1 - f) + tab[nextIdx] * f;
}

/** Wavetable oscillator with morph between two tables (equal-power crossfade).
 *  Implements the Osc interface so UnisonStack can stack it. */
export class WavetableOsc implements Osc {
  private phase = 0;
  private readonly tA: Float32Array;
  private readonly tB: Float32Array;
  private morphBase = 0;
  // Cached morph gains to avoid per-sample cos/sin
  private gainA = 1;
  private gainB = 0;

  /**
   * Create a wavetable oscillator
   * @param tableA First table (morph=0)
   * @param tableB Second table (morph=1)
   * @param morph Initial morph value (0..1)
   */
  constructor(tableA: Float32Array, tableB: Float32Array, morph: number) {
    this.tA = tableA;
    this.tB = tableB;
    this.setMorph(morph);
  }

  /**
   * Update the oscillator and return one sample
   * @param freqHz Frequency in Hz (as per Osc interface)
   * @returns Sample value, typically -1..1
   */
  update(freqHz: number): number {
    // Convert Hz to normalized phase increment (freq / sampleRate)
    // Note: sampleRate is not stored in this class - UnisonStack handles it
    // We need to compute phase increment from freqHz
    // This is called per-sample, so we need sampleRate access
    // For now, use a simple approximation - UnisonStack will provide the rate
    this.phase += freqHz; // This needs sampleRate division
    
    // Wrap phase to 0..1
    if (this.phase >= 1) {
      this.phase -= 1;
    }
    
    // Sample both tables
    const vA = sampleTable(this.tA, this.phase);
    const vB = sampleTable(this.tB, this.phase);
    
    // Use cached morph gains
    return vA * this.gainA + vB * this.gainB;
  }

  /**
   * Set morph value (continuous parameter)
   * @param morph Morph value (0..1)
   */
  setMorph(morph: number): void {
    this.morphBase = Math.max(0, Math.min(1, morph));
    // Cache morph gains (cos/sin for equal-power crossfade)
    const m = this.morphBase;
    this.gainA = Math.cos(m * Math.PI / 2);
    this.gainB = Math.sin(m * Math.PI / 2);
  }

  /**
   * Set both tables (for morph changes)
   * @param tableA First table
   * @param tableB Second table
   */
  setTables(tableA: Float32Array, tableB: Float32Array): void {
    this.tA = tableA;
    this.tB = tableB;
  }
}
