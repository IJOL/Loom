import { describe, it, expect } from 'vitest';
import { quantiseSelectValue, normaliseSelectIndex } from '../core/select-control';

// Captures the contract refreshLaneKnobs must satisfy for discrete handles:
// normaliseSelectIndex(idx, n) must round-trip back to idx through
// quantiseSelectValue (the inverse used inside the select handle's setValue).
describe('discrete refresh round-trip', () => {
  it('index -> normalized -> index is identity for a 3-option select', () => {
    for (let idx = 0; idx < 3; idx++) {
      const norm = normaliseSelectIndex(idx, 3);
      expect(quantiseSelectValue(norm, 3)).toBe(idx);
    }
  });
});
