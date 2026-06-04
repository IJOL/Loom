import { describe, it, expect } from 'vitest';
import { computeStripMutes, computeVoiceMutes, type MuteSoloLane } from './mute-solo';

const VOICES = ['kick', 'snare', 'closedHat', 'openHat', 'clap', 'cowbell', 'tom', 'ride'] as const;

describe('computeVoiceMutes (per-voice mute/solo within one kit)', () => {
  it('no mutes/solos → nothing muted', () => {
    const out = computeVoiceMutes(VOICES, {}, {});
    for (const v of VOICES) expect(out[v]).toBe(false);
  });

  it('muting one voice mutes only that voice', () => {
    const out = computeVoiceMutes(VOICES, { snare: true }, {});
    expect(out.snare).toBe(true);
    expect(out.kick).toBe(false);
  });

  it('soloing one voice mutes every OTHER voice', () => {
    const out = computeVoiceMutes(VOICES, {}, { kick: true });
    expect(out.kick).toBe(false);
    expect(out.snare).toBe(true);
    expect(out.closedHat).toBe(true);
  });

  it('solo overrides an explicit mute on a different voice (Ableton model)', () => {
    const out = computeVoiceMutes(VOICES, { snare: true }, { kick: true });
    expect(out.kick).toBe(false);   // soloed → audible
    expect(out.snare).toBe(true);   // muted because not soloed
  });

  it('two solos keep both audible', () => {
    const out = computeVoiceMutes(VOICES, {}, { kick: true, snare: true });
    expect(out.kick).toBe(false);
    expect(out.snare).toBe(false);
    expect(out.closedHat).toBe(true);
  });
});

// A lane "owns" extra mixer track ids (the drum bus owns the drum-voice
// strips, the bass lane owns the legacy `bass` alias, etc.). Solo'ing a
// lane should unmute every owned strip — the previous bug muted drum
// voices because each voice strip was treated as a separate solo target.
const LANES: MuteSoloLane[] = [
  { id: 'tb-303-1',      ownedTrackIds: ['bass'] },
  { id: 'subtractive-1', ownedTrackIds: ['poly'] },
  { id: 'drums-1',       ownedTrackIds: ['drumBus', 'kick', 'snare', 'closedHat', 'openHat', 'clap', 'cowbell', 'tom', 'ride'] },
];

describe('computeStripMutes', () => {
  it('with no mutes or solos, nothing is muted', () => {
    const out = computeStripMutes({ lanes: LANES, muteState: {}, soloState: {} });
    for (const key of Object.keys(out)) expect(out[key]).toBe(false);
  });

  it('muting drums-1 mutes the drum bus AND every owned drum voice', () => {
    const out = computeStripMutes({
      lanes: LANES, muteState: { 'drums-1': true }, soloState: {},
    });
    expect(out['drums-1']).toBe(true);
    expect(out['drumBus']).toBe(true);
    expect(out['kick']).toBe(true);
    expect(out['snare']).toBe(true);
    expect(out['closedHat']).toBe(true);
    // unrelated lanes stay audible
    expect(out['tb-303-1']).toBe(false);
    expect(out['bass']).toBe(false);
  });

  it('soloing drums-1 leaves drums + its owned voices AUDIBLE and mutes everything else', () => {
    // This is the regression: previously the per-voice strips were treated as
    // separate solo targets, so they all got muted (anySolo = true,
    // soloState[voice] = false → !false = true). The bus stayed unmuted, but
    // no signal reached it because every voice strip was silenced.
    const out = computeStripMutes({
      lanes: LANES, muteState: {}, soloState: { 'drums-1': true },
    });
    expect(out['drums-1']).toBe(false);
    expect(out['drumBus']).toBe(false);
    expect(out['kick']).toBe(false);
    expect(out['snare']).toBe(false);
    expect(out['closedHat']).toBe(false);
    expect(out['openHat']).toBe(false);
    expect(out['clap']).toBe(false);
    expect(out['cowbell']).toBe(false);
    expect(out['tom']).toBe(false);
    expect(out['ride']).toBe(false);
    // every non-soloed lane (and its owned strips) is silenced
    expect(out['tb-303-1']).toBe(true);
    expect(out['bass']).toBe(true);
    expect(out['subtractive-1']).toBe(true);
    expect(out['poly']).toBe(true);
  });

  it('soloing drums-1 + tb-303-1 leaves both audible, silences the rest', () => {
    const out = computeStripMutes({
      lanes: LANES, muteState: {},
      soloState: { 'drums-1': true, 'tb-303-1': true },
    });
    expect(out['drums-1']).toBe(false);
    expect(out['drumBus']).toBe(false);
    expect(out['kick']).toBe(false);
    expect(out['tb-303-1']).toBe(false);
    expect(out['bass']).toBe(false);
    expect(out['subtractive-1']).toBe(true);
    expect(out['poly']).toBe(true);
  });

  it('explicit lane mute is OVERRIDDEN by a solo on a different lane (Ableton model)', () => {
    // Once any solo is active, mute flags are ignored — only the solo set
    // determines who plays.
    const out = computeStripMutes({
      lanes: LANES,
      muteState: { 'tb-303-1': true },
      soloState: { 'drums-1': true },
    });
    expect(out['tb-303-1']).toBe(true);  // muted because not soloed (not because muted flag)
    expect(out['drums-1']).toBe(false);
  });
});
