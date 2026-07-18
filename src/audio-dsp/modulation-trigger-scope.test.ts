// LFO TRIG and SCOPE. Both reduce to one question: where does the phase start?
//
//   free   + shared  → origin 0        (free-running, one phase for the lane)
//   note   + shared  → origin = the lane's most recent note-on (retrigger)
//   scope 'voice'    → origin = THAT voice's note-on (each note independent)
//
// Until now neither setting was serialised to the worklet, so every LFO
// free-ran and was shared regardless of what the UI said.
import { describe, it, expect } from 'vitest';
import { ModulationRuntime, type ModLite } from './modulation-runtime';

const lfo = (over: Partial<ModLite> = {}): ModLite => ({
  id: 'l1', kind: 'lfo', enabled: true, rateHz: 1, waveform: 'sine',
  depthByParam: { filterCutoff: 1 }, ...over,
});

/** A sine LFO at 1 Hz is 0 at phase 0, +1 at phase 0.25. Reading it exactly one
 *  quarter-cycle after its origin must give +1 whatever the absolute time is. */
const QUARTER = 0.25;

describe('LFO phase origin — free (the existing behaviour)', () => {
  it('free+shared ignores note-ons: phase follows absolute time', () => {
    const rt = new ModulationRuntime(48000);
    rt.setMods([lfo({ trigger: 'free', scope: 'shared' })]);
    // Same absolute time, different note-on times → identical output.
    const a = rt.offsetFor('filterCutoff', QUARTER, { voiceStartT: 10, lastNoteOnT: 10 });
    const b = rt.offsetFor('filterCutoff', QUARTER, { voiceStartT: 99, lastNoteOnT: 99 });
    expect(a).toBeCloseTo(1, 5);
    expect(b).toBeCloseTo(1, 5);
  });

  it('defaults to free+shared when the fields are absent (back-compat)', () => {
    const rt = new ModulationRuntime(48000);
    rt.setMods([lfo()]);                       // no trigger, no scope
    expect(rt.offsetFor('filterCutoff', QUARTER, { voiceStartT: 7, lastNoteOnT: 7 })).toBeCloseTo(1, 5);
  });
});

describe('LFO phase origin — TRIG = note', () => {
  it('phase restarts from the lane\'s most recent note-on', () => {
    const rt = new ModulationRuntime(48000);
    rt.setMods([lfo({ trigger: 'note', scope: 'shared' })]);
    // A note landed at t=10; a quarter-cycle later the sine must peak.
    const v = rt.offsetFor('filterCutoff', 10 + QUARTER, { voiceStartT: 10, lastNoteOnT: 10 });
    expect(v).toBeCloseTo(1, 5);
  });

  it('a later note-on moves the origin — the same absolute time now reads differently', () => {
    const rt = new ModulationRuntime(48000);
    rt.setMods([lfo({ trigger: 'note', scope: 'shared' })]);
    const t = 10 + QUARTER;
    const beforeRetrig = rt.offsetFor('filterCutoff', t, { voiceStartT: 10, lastNoteOnT: 10 });
    const afterRetrig  = rt.offsetFor('filterCutoff', t, { voiceStartT: 10, lastNoteOnT: t });
    expect(beforeRetrig).toBeCloseTo(1, 5);   // a quarter cycle in
    expect(afterRetrig).toBeCloseTo(0, 5);    // just retriggered → phase 0
  });
});

describe('LFO phase origin — SCOPE = voice', () => {
  it('each voice runs from its OWN note-on, so two voices differ', () => {
    const rt = new ModulationRuntime(48000);
    rt.setMods([lfo({ scope: 'voice' })]);
    const t = 10 + QUARTER;
    const early = rt.offsetFor('filterCutoff', t, { voiceStartT: 10, lastNoteOnT: t });
    const late  = rt.offsetFor('filterCutoff', t, { voiceStartT: t,  lastNoteOnT: t });
    expect(early).toBeCloseTo(1, 5);   // a quarter cycle into ITS note
    expect(late).toBeCloseTo(0, 5);    // just started
    expect(Math.abs(early - late)).toBeGreaterThan(0.5);
  });

  it('voice scope wins over trigger — the voice origin is used either way', () => {
    const rt = new ModulationRuntime(48000);
    rt.setMods([lfo({ scope: 'voice', trigger: 'free' })]);
    const t = 10 + QUARTER;
    expect(rt.offsetFor('filterCutoff', t, { voiceStartT: 10, lastNoteOnT: 0 })).toBeCloseTo(1, 5);
  });
});

describe('needsPerVoicePhase — the fast-path guard', () => {
  it('is false when every LFO is free+shared (keep the cheap shared path)', () => {
    const rt = new ModulationRuntime(48000);
    rt.setMods([lfo({ trigger: 'free', scope: 'shared' }), lfo({ id: 'l2' })]);
    expect(rt.needsPerVoicePhase()).toBe(false);
  });

  it('is true when any LFO is note-triggered or per-voice', () => {
    const perVoice = new ModulationRuntime(48000);
    perVoice.setMods([lfo(), lfo({ id: 'l2', scope: 'voice' })]);
    expect(perVoice.needsPerVoicePhase()).toBe(true);

    const retrig = new ModulationRuntime(48000);
    retrig.setMods([lfo({ trigger: 'note' })]);
    expect(retrig.needsPerVoicePhase()).toBe(true);
  });

  it('ignores disabled modulators', () => {
    const rt = new ModulationRuntime(48000);
    rt.setMods([lfo({ scope: 'voice', enabled: false })]);
    expect(rt.needsPerVoicePhase()).toBe(false);
  });
});

describe('offsetsInto honours the phase origin too', () => {
  it('fills the pooled struct using the voice origin', () => {
    const rt = new ModulationRuntime(48000);
    rt.setMods([lfo({ scope: 'voice' })]);
    const out: Record<string, number> = {};
    rt.offsetsInto(out, 10 + QUARTER, { voiceStartT: 10, lastNoteOnT: 0 });
    expect(out.filterCutoff).toBeCloseTo(1, 5);
  });
});
