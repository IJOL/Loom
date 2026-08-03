// src/audio-dsp/engine-parity.dsp.test.ts
// The safety net for the params-by-index work: what each engine renders, frozen
// BEFORE a single production line changed.
//
// Captured with `npx tsx tools/gen-engine-reference.ts <id> --out
// src/audio-dsp/reference/<id>.json`, from each engine's own declared defaults —
// so a default that quietly changes shows up here instead of hiding.
//
// A reference captured AFTER a change only proves the change equals itself.
// That is why these five JSONs are committed in their own task, ahead of the
// work they exist to defend.
import { describe, it, expect } from 'vitest';
import { referenceFor } from '../../tools/gen-engine-reference';

import tb303 from './reference/tb303.json';
import subtractive from './reference/subtractive.json';

// Only the engines still IN the tree are defended here. fm, wavetable and
// westcoast ship as plugins now: their reference travelled with them to
// plugins/<id>/reference-render.json and is checked by that plugin's own
// <id>-parity.dsp.test.ts. Keeping a second copy here would have been two
// owners for one fact.
const COMMITTED: Record<string, number[]> = { tb303, subtractive };

describe('engine render parity', () => {
  for (const [id, committed] of Object.entries(COMMITTED)) {
    it(`${id} renders exactly what it rendered before the index change`, async () => {
      const fresh = await referenceFor(id);
      expect(fresh.length).toBe(committed.length);
      for (let i = 0; i < committed.length; i++) {
        // Ten decimals: far below anything audible, far above float rounding.
        // If an engine ever needs this relaxed, THAT is the finding — the sound
        // moved. Do not widen it to make a red test green.
        expect(fresh[i], `${id} sample ${i * 512}`).toBeCloseTo(committed[i], 10);
      }
    });
  }
});
