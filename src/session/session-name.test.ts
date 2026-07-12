import { describe, it, expect } from 'vitest';
import { emptySessionState } from './session';
import { migrateLoadedSessionState } from './session-migration';
import type { SessionState } from './session-types';

describe('SessionState.name (project name)', () => {
  it('a fresh session is named "Untitled"', () => {
    expect(emptySessionState().name).toBe('Untitled');
  });

  it('migration backfills a missing name to "Untitled"', () => {
    const legacy = { lanes: [], scenes: [], globalQuantize: '1/1' } as unknown as SessionState;
    expect(migrateLoadedSessionState(legacy).name).toBe('Untitled');
  });

  it('migration preserves an existing name', () => {
    const named = { lanes: [], scenes: [], globalQuantize: '1/1', name: 'My Track' } as unknown as SessionState;
    expect(migrateLoadedSessionState(named).name).toBe('My Track');
  });
});
