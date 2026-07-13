// src/app/toolbar-status-chips.test.ts
import { describe, it, expect } from 'vitest';
import { musicalityChipLabel } from './toolbar-status-chips';

describe('musicalityChipLabel', () => {
  it('shows root + short scale, and a lock glyph only when locked', () => {
    const base = { key: 9, scale: 'minor', style: 'acid', lock: false } as const;
    const unlocked = musicalityChipLabel(base);
    const locked = musicalityChipLabel({ ...base, lock: true });
    expect(unlocked).toContain('A');          // key 9 = A
    expect(unlocked).not.toContain('🔒');
    expect(locked).toContain('🔒');
  });
});
