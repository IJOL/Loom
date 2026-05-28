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
import { SubtractiveEngine } from '../engines/subtractive';

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

  it('SubtractiveEngine ships with the demo presets used by slots B + C', () => {
    // The demo's per-slot configurators must apply presets that exist in
    // SubtractiveEngine.presets (because subtractive-1 is the only poly lane
    // in the default 3-lane session). If a preset name doesn't resolve, the
    // configurator is a silent no-op and slots A/B/C/D all sound the same —
    // which defeats the whole point of the demo.
    const engine = new SubtractiveEngine();
    const names = engine.presets.map((p) => p.name);
    expect(names).toContain('Bright Stab');
    expect(names).toContain('Sub Bell');
  });

  it('demo presets differ from defaults (no-op preset guard)', () => {
    // Pin: each preset must move at least filter.cutoff away from the
    // engine's default 0.55, otherwise applying it is sonically pointless.
    const engine = new SubtractiveEngine();
    const defaultCutoff = engine.params.find((p) => p.id === 'filter.cutoff')!.default;
    for (const presetName of ['Bright Stab', 'Sub Bell']) {
      const preset = engine.presets.find((p) => p.name === presetName)!;
      expect(preset.params['filter.cutoff'],
        `preset '${presetName}' should set filter.cutoff to a non-default value`,
      ).not.toBe(defaultCutoff);
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

import { buildMinimalTechnoDemoSession } from './demo-minimal-techno';

describe('minimal-techno session demo (per-lane loops)', () => {
  it('returns a SessionState with 1 scene and 3 lanes with varying clip lengths', () => {
    const state = buildMinimalTechnoDemoSession();
    expect(state.scenes).toHaveLength(1);
    expect(state.lanes).toHaveLength(3);

    const bass  = state.lanes.find((l) => l.id === 'tb-303-1');
    const drums = state.lanes.find((l) => l.id === 'drums-1');
    const poly  = state.lanes.find((l) => l.id === 'subtractive-1');
    expect(bass).toBeDefined();
    expect(drums).toBeDefined();
    expect(poly).toBeDefined();
  });

  it('clips have non-identical lengthBars so loops are independent', () => {
    const state = buildMinimalTechnoDemoSession();
    const lengths = state.lanes.map((l) => l.clips[0]?.lengthBars).filter((n): n is number => typeof n === 'number');
    // At least one pair of distinct lengths.
    const distinct = new Set(lengths);
    expect(distinct.size).toBeGreaterThan(1);
  });

  it('drums clip has drum hits, bass clip has bass notes, pad clip has pad notes', () => {
    const state = buildMinimalTechnoDemoSession();
    const bass  = state.lanes.find((l) => l.id === 'tb-303-1')!.clips[0]!;
    const drums = state.lanes.find((l) => l.id === 'drums-1')!.clips[0]!;
    const poly  = state.lanes.find((l) => l.id === 'subtractive-1')!.clips[0]!;
    expect(bass.notes.length).toBeGreaterThan(0);
    expect(drums.notes.length).toBeGreaterThan(0);
    expect(poly.notes.length).toBeGreaterThan(0);
    // Drums use GM_DRUM_MAP midi values (36 kick, 38 snare, 42 closed hat, etc.)
    expect(drums.notes.every((n) => n.midi >= 35 && n.midi <= 50)).toBe(true);
  });

  it('the single scene assigns clip 0 of every lane', () => {
    const state = buildMinimalTechnoDemoSession();
    const scene = state.scenes[0];
    expect(scene.clipPerLane['tb-303-1']).toBe(0);
    expect(scene.clipPerLane['drums-1']).toBe(0);
    expect(scene.clipPerLane['subtractive-1']).toBe(0);
  });
});
