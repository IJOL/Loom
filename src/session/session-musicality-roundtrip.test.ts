import { describe, it, expect } from 'vitest';
import { migrateLoadedSessionState } from './session-migration';
import type { SessionState } from './session';

describe('musicality survives a JSON round-trip + migration', () => {
  it('preserves key/scale/style/lock and a lane override', () => {
    const s: SessionState = { name: 'Test', masterInserts: [], sends: [],
      lanes: [{ inserts: [], id: 'l1', engineId: 'tb303', clips: [], musicalityOverride: { scale: 'major' } }],
      scenes: [], globalQuantize: 'immediate',
      musicality: { key: 2, scale: 'dorian', style: 'house', lock: false },
    };
    const reloaded = migrateLoadedSessionState(JSON.parse(JSON.stringify(s)) as SessionState);
    expect(reloaded.musicality).toEqual({ key: 2, scale: 'dorian', style: 'house', lock: false });
    expect(reloaded.lanes[0].musicalityOverride).toEqual({ scale: 'major' });
  });
});
