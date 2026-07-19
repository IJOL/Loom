import { describe, it, expect } from 'vitest';
import { emptySessionState } from './session';

describe('SessionState.name (project name)', () => {
  it('a fresh session is named "Untitled"', () => {
    expect(emptySessionState().name).toBe('Untitled');
  });

  // `name` is required on SessionState now (set at every construction site —
  // emptySessionState, demo/import loaders — never absent), so migration no
  // longer backfills it. The two tests that lived here exercised that removed
  // backfill path; there is nothing left to assert once the field can't be
  // missing.
});
