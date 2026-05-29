import { describe, it, expect } from 'vitest';
import { parseSavedStateV3 } from './saved-state-v3';

describe('parseSavedStateV3 with arrangement + mode', () => {
  it('accepts a v3 save that includes the new arrangement and mode fields', () => {
    const raw = {
      schemaVersion: 3, bpm: 130, swing: 0, masterVol: 0.5,
      kit: '808', wave: 'sawtooth',
      synthParams: {},
      sessionState: { lanes: [], scenes: [], globalQuantize: '1/1' },
      mode: 'performance',
      arrangement: {
        bpm: 130, durationSec: 4,
        lanes: [{ laneId: 'tb-303-1', clipEvents: [], automation: [] }],
        globalAutomation: [],
      },
    };
    const s = parseSavedStateV3(raw);
    expect(s).not.toBeNull();
    expect((s as any).mode).toBe('performance');
    expect((s as any).arrangement?.durationSec).toBe(4);
  });

  it('a v3 save without arrangement still parses; arrangement is undefined', () => {
    const raw = {
      schemaVersion: 3, bpm: 120, swing: 0, masterVol: 0.5,
      kit: 'tr909', wave: 'square',
      synthParams: {}, sessionState: { lanes: [], scenes: [], globalQuantize: '1/1' },
    };
    const s = parseSavedStateV3(raw);
    expect(s).not.toBeNull();
    expect((s as any).arrangement).toBeUndefined();
    expect((s as any).mode).toBeUndefined();
  });
});
