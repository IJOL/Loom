// src/app/toolbar-status-chips.test.ts
import { describe, it, expect } from 'vitest';
import { musicalityChipLabel } from './toolbar-status-chips';

describe('musicalityChipLabel', () => {
  it('shows root + short scale + style, and which way the lock is', () => {
    const base = { key: 9, scale: 'minor', style: 'acid-techno', lock: false } as const;
    const unlocked = musicalityChipLabel(base);
    const locked = musicalityChipLabel({ ...base, lock: true });
    expect(unlocked).toContain('A');          // key 9 = A
    expect(unlocked).toContain('Acid Techno'); // style 'acid-techno' → STYLE_CATALOG label
    expect(unlocked).not.toContain('🔒');   // open shows 🔓, never 🔒
    expect(locked).toContain('🔒');
  });
});

describe('the scale lock is visible either way', () => {
  const base = { key: 9, scale: 'minor', style: 'acid-techno' } as const;

  it('shows an open padlock when the lock is open', () => {
    // Open is information too: it is what decides whether a library pattern
    // arrives as written or gets pulled into key. Showing nothing hides that.
    expect(musicalityChipLabel({ ...base, lock: false })).toContain('🔓');
  });

  it('shows a closed padlock when the lock is closed', () => {
    expect(musicalityChipLabel({ ...base, lock: true })).toContain('🔒');
  });
});
