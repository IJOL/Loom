import { describe, it, expect } from 'vitest';
import { drumSubGroupFor, VOICE_DISPLAY_NAMES } from './drum-subgroups';
import { DRUM_LANES } from '../core/drums';

describe('drumSubGroupFor', () => {
  it('maps a per-voice param to its presentable voice name', () => {
    expect(drumSubGroupFor('kick.tune')).toEqual({ key: 'kick', label: 'Kick' });
    expect(drumSubGroupFor('closedHat.decay')).toEqual({ key: 'closedHat', label: 'Closed Hat' });
    expect(drumSubGroupFor('kick.eq.low')).toEqual({ key: 'kick', label: 'Kick' });
  });

  it('returns undefined for the lane bus (not a voice)', () => {
    expect(drumSubGroupFor('bus.level')).toBeUndefined();
    expect(drumSubGroupFor('bus.eq.high')).toBeUndefined();
  });

  it('has a display name for every drum voice', () => {
    for (const v of DRUM_LANES) expect(typeof VOICE_DISPLAY_NAMES[v]).toBe('string');
  });
});
