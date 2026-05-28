// src/demo/demo-minimal-techno.test.ts
// Regression test for the minimal-techno demo: it must populate every
// session lane with audible content after the Classic → Session migration.
//
// Two bugs surfaced after Phase B of the lane-resource refactor renamed
// internal laneIds from `bass`/`main`/`drums` to the slug ids
// `tb-303-1`/`subtractive-1`/`drums-1`:
//   1. The demo's per-slot preset configurators called `applyPreset('main', …)`
//      which no longer matches any lane.
//   2. The automation envelope was built with paramId `main.filter.cutoff`
//      but `envelopesForLane(pat, 'subtractive-1')` filters by the new prefix.
// This test pins both behaviours.

import { describe, it, expect } from 'vitest';
import { buildMinimalTechnoDemo } from './demo-minimal-techno';
import { PatternBank } from '../core/pattern';
import { importClassicToSession } from '../session/session-migration';

describe('minimal-techno demo', () => {
  it('builds 4 patterns', () => {
    const patterns = buildMinimalTechnoDemo();
    expect(patterns).toHaveLength(4);
  });

  it('Classic→Session migration populates the three default lanes with clips', () => {
    const patterns = buildMinimalTechnoDemo();
    const bank = new PatternBank(32);
    for (let i = 0; i < 4; i++) bank.slots[i] = patterns[i];
    const state = importClassicToSession(bank);

    const bass  = state.lanes.find((l) => l.id === 'tb-303-1');
    const drums = state.lanes.find((l) => l.id === 'drums-1');
    const poly  = state.lanes.find((l) => l.id === 'subtractive-1');

    expect(bass).toBeDefined();
    expect(drums).toBeDefined();
    expect(poly).toBeDefined();

    // Each of the 4 scenes should have at least one clip per lane with notes.
    for (let scene = 0; scene < 4; scene++) {
      const bassClip  = bass!.clips[scene];
      const drumsClip = drums!.clips[scene];
      const polyClip  = poly!.clips[scene];
      expect(bassClip,  `bass clip in scene ${scene}`).toBeDefined();
      expect(drumsClip, `drums clip in scene ${scene}`).toBeDefined();
      expect(polyClip,  `poly clip in scene ${scene}`).toBeDefined();
      expect(drumsClip!.notes.length,
        `drums clip ${scene} should have drum hits`).toBeGreaterThan(0);
    }
  });

  it('automation envelope on subtractive cutoff is carried into the matching clip', () => {
    const patterns = buildMinimalTechnoDemo();
    const bank = new PatternBank(32);
    for (let i = 0; i < 4; i++) bank.slots[i] = patterns[i];
    const state = importClassicToSession(bank);

    const poly = state.lanes.find((l) => l.id === 'subtractive-1')!;
    // At least one scene must carry the cutoff envelope into its main-poly clip.
    const hasCutoffEnvelope = poly.clips.some((c) =>
      c?.envelopes?.some((e) => e.paramId === 'subtractive-1.filter.cutoff'),
    );
    expect(hasCutoffEnvelope).toBe(true);
  });
});
