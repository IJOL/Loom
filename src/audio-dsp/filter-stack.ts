// src/audio-dsp/filter-stack.ts
// Everything the Subtractive voice knows about filtering: which circuit a kind
// selects, and how the two blocks combine.
//
// It exists so the renderer does not have to. Hand it a sample and six numbers
// and it hands a sample back; it knows nothing about notes, envelopes or params.

import { Svf } from './filter';
import { LadderFilter, type LadderTap } from './ladder';
import { CombFilter } from './comb';
import {
  FILTER_MODES, ROUTING_OFF, ROUTING_SER, ROUTING_PAR, ROUTING_DIFF, tapFor, type FilterTap,
} from './filter-kinds';

export * from './filter-kinds';

/** The cutoff rails the engine has always used: 60 * 220^x, capped at 18 kHz. */
const CUTOFF_MIN_HZ = 20;
const CUTOFF_MAX_HZ = 18000;

/**
 * Where filter B's cutoff lands, given how far filter A has moved from its own
 * base (`aRatio` = A's final cutoff / A's base cutoff — its envelope and key
 * tracking, as one number).
 *
 * MULTIPLICATIVE on purpose. Following A additively in Hz would collapse the
 * interval between the two the moment the envelope opened: B a tenth of an
 * octave over A at rest would be a hair over it at full sweep. A ratio keeps the
 * interval in OCTAVES, which is the interval you hear.
 *
 * track 0 = B is nailed where its knob puts it (a fixed high-pass under a
 * sweeping low-pass). track 1 = B moves by exactly A's ratio.
 */
export function trackedCutoff(baseBHz: number, aRatio: number, track: number): number {
  const hz = baseBHz * (1 + track * (aRatio - 1));
  return hz < CUTOFF_MIN_HZ ? CUTOFF_MIN_HZ : hz > CUTOFF_MAX_HZ ? CUTOFF_MAX_HZ : hz;
}

/** One filter: a circuit plus the response taken out of it. */
class FilterBlock {
  private svf: Svf | null = null;
  private ladder: LadderFilter | null = null;
  private comb: CombFilter | null = null;
  private readonly tap: FilterTap;

  constructor(model: number, type: number, sr: number) {
    const mode = FILTER_MODES[Math.max(0, Math.min(FILTER_MODES.length - 1, Math.round(model)))];
    this.tap = tapFor(model, type);
    if (mode.value === 'comb') this.comb = new CombFilter(sr);
    else if (mode.value === 'mog' || mode.value === 'acid') {
      this.ladder = new LadderFilter(mode.value === 'mog' ? 'moog' : 'diode', sr, this.tap as LadderTap);
    } else this.svf = new Svf(sr);
  }

  update(x: number, cutoffHz: number, res: number): number {
    // Under COMB the two knobs mean something else: cutoffHz is the comb's
    // TUNING (the frequency its peaks are spaced by) and res is its feedback.
    // Declared, not hidden here -- see the filter.cutoff/filter.resonance
    // param comments in subtractive-params.ts, the place a reader actually
    // looks for what a knob does, and docs/manual/04-engines.md#the-comb-and-its-two-borrowed-knobs
    // for the player-facing version of the same explanation.
    if (this.comb) return this.comb.update(x, cutoffHz, res, this.tap);
    if (this.ladder) return this.ladder.update(x, cutoffHz, res);
    const f = this.svf!;
    f.update(x, cutoffHz, res);
    switch (this.tap) {
      case 'hp': return f.hp;
      case 'bp': return f.bp;
      case 'notch': return f.notch;
      default: return f.lp;
    }
  }
}

export class FilterStack {
  private readonly a: FilterBlock;
  /** Built only when the routing asks for it: OFF costs exactly what one filter
   *  cost before this module existed. */
  private readonly b: FilterBlock | null;
  private readonly routing: number;

  constructor(modelA: number, typeA: number, modelB: number, typeB: number, routing: number, sr: number) {
    this.routing = Math.round(routing);
    this.a = new FilterBlock(modelA, typeA, sr);
    this.b = this.routing === ROUTING_OFF ? null : new FilterBlock(modelB, typeB, sr);
  }

  /**
   * One sample through both blocks.
   * @param blend how much of B is in the result, in EVERY mode: 0 is filter A
   *              alone whatever the routing says, 1 is the mode at full.
   */
  update(x: number, cutA: number, resA: number, cutB: number, resB: number, blend: number): number {
    const a = this.a.update(x, cutA, resA);
    const b = this.b;
    if (!b) return a;                    // routing OFF: filter A alone
    return this.combine(a, x, b, cutB, resB, blend);
  }

  /** The three real routing modes, plus OFF's fallthrough (unreachable: `update`
   *  never calls this without a B block, but `default` keeps it total). */
  private combine(
    a: number, x: number, b: FilterBlock, cutB: number, resB: number, blend: number,
  ): number {
    switch (this.routing) {
      // A feeds B. Lerped, so blend 0 is A untouched rather than a hard switch.
      case ROUTING_SER: { const chained = b.update(a, cutB, resB); return a + blend * (chained - a); }
      // Both see the same input. B is added on top of A, so A never leaves the
      // mix -- DIFF's formula with the sign flipped.
      case ROUTING_PAR: return a + blend * b.update(x, cutB, resB);
      // A minus B: what A passes and B does not. Two lowpasses this way are a
      // band-pass between their cutoffs, which no single circuit here is.
      case ROUTING_DIFF: return a - blend * b.update(x, cutB, resB);
      default: return a;
    }
  }
}
