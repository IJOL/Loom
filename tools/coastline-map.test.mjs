import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCoastline, LOOM_VARIANT, CRATE_VARIANT, CYCLE_TICKS, LENGTH_BARS } from './coastline-map.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const haps = JSON.parse(readFileSync(join(HERE, 'data', 'coastline-haps.json'), 'utf8'));

const laneById = (d, id) => d.lanes.find((l) => l.id === id);

describe('coastline mapper', () => {
  it('maps one Strudel cycle onto half a Loom bar', () => {
    expect(CYCLE_TICKS).toBe(192);
    expect(LENGTH_BARS).toBe(32);
  });

  it('builds four lanes and one scene that launches them all', () => {
    const d = buildCoastline(haps, LOOM_VARIANT);
    expect(d.lanes.map((l) => l.id)).toEqual(['drums-1', 'keys-1', 'bass-1', 'lead-1']);
    expect(d.scenes).toHaveLength(1);
    expect(Object.keys(d.scenes[0].clipPerLane)).toHaveLength(4);
    expect(d.bpm).toBe(90);
  });

  it('keeps every event: lane note counts add up to the extraction', () => {
    const d = buildCoastline(haps, LOOM_VARIANT);
    const total = d.lanes.reduce((s, l) => s + l.clips[0].notes.length, 0);
    expect(total).toBe(haps.events.length);
    expect(laneById(d, 'keys-1').clips[0].notes).toHaveLength(80);
    expect(laneById(d, 'bass-1').clips[0].notes).toHaveLength(80);
    expect(laneById(d, 'lead-1').clips[0].notes).toHaveLength(109);
    expect(laneById(d, 'drums-1').clips[0].notes).toHaveLength(553);
  });

  it('puts every note on an integer tick inside a 32-bar clip', () => {
    const d = buildCoastline(haps, LOOM_VARIANT);
    const end = LENGTH_BARS * 384;
    for (const lane of d.lanes) {
      expect(lane.clips[0].lengthBars).toBe(LENGTH_BARS);
      for (const nt of lane.clips[0].notes) {
        expect(Number.isInteger(nt.start)).toBe(true);
        expect(nt.start).toBeGreaterThanOrEqual(0);
        expect(nt.start).toBeLessThan(end);
        expect(nt.duration).toBeGreaterThan(0);
        expect(nt.start + nt.duration).toBeLessThanOrEqual(end);
      }
    }
  });

  it('leaves the lead velocity below the accent threshold and its gate at 0.6 of the span', () => {
    const d = buildCoastline(haps, LOOM_VARIANT);
    const lead = laneById(d, 'lead-1').clips[0];
    for (const nt of lead.notes) expect(nt.velocity).toBe(77);
    // segment(4) events span a quarter cycle = 48 ticks; chunk(4, fast(2)) halves
    // some of them. Every gate is 0.6 of ITS OWN span, so the ratio is constant.
    const spans = new Set(lead.notes.map((nt) => nt.duration));
    for (const s of spans) expect(Number.isInteger(s)).toBe(true);
    expect(Math.max(...spans)).toBeLessThanOrEqual(Math.round(48 * 0.6));
  });

  it('hands the lead a random note-FX instead of baking the dice', () => {
    const d = buildCoastline(haps, LOOM_VARIANT);
    const fx = laneById(d, 'lead-1').engineState.noteFx;
    expect(fx).toHaveLength(1);
    expect(fx[0].kind).toBe('random');
    expect(fx[0].enabled).toBe(true);
    expect(fx[0].params.durChance).toBe(1);
    expect(fx[0].params.velChance).toBe(1);
    expect(fx[0].params.durRandom).toBeCloseTo(0.3333, 4);
    expect(fx[0].params.velRandom).toBeCloseTo(0.29, 4);
    expect(fx[0].params.velSmooth).toBe(1);
    expect(fx[0].params.velSmoothRate).toBeCloseTo(0.75, 4);
  });

  it('sweeps the lead filter and FM over eight periods, in each param own units', () => {
    const d = buildCoastline(haps, LOOM_VARIANT);
    const lead = laneById(d, 'lead-1');
    expect(lead.engineId).toBe('fm');
    const envs = lead.clips[0].envelopes;
    const cut = envs.find((e) => e.paramId === 'lead-1.fx:coastline-lpf.freq');
    const mods = ['op2', 'op3', 'op4'].map((op) => envs.find((e) => e.paramId === `lead-1.${op}.level`));
    for (const e of [cut, ...mods]) {
      expect(e.values).toHaveLength(LENGTH_BARS * 16 * 16);
      expect(Math.min(...e.values)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...e.values)).toBeLessThanOrEqual(1);
    }
    // 500..1000 Hz, denormalised linearly over the multifilter's [20, 20000].
    expect(Math.min(...cut.values)).toBeCloseTo(0.024024, 5);
    expect(Math.max(...cut.values)).toBeCloseTo(0.049049, 5);
    // fmi 3..8 spread across three summed modulators: level = fmi/9.
    for (const m of mods) {
      expect(Math.min(...m.values)).toBeCloseTo(0.3333, 4);
      expect(Math.max(...m.values)).toBeCloseTo(0.8889, 4);
    }
    // The three modulators are ONE gesture — identical curves, or the summed
    // depth stops matching fmi.
    expect(mods[1].values).toEqual(mods[0].values);
    expect(mods[2].values).toEqual(mods[0].values);
  });

  it('puts the lowpass before the distortion, as superdough does', () => {
    const d = buildCoastline(haps, LOOM_VARIANT);
    expect(laneById(d, 'lead-1').inserts.map((i) => i.pluginId)).toEqual(['multifilter', 'distortion']);
    const lpf = laneById(d, 'lead-1').inserts[0];
    expect(lpf.params.q).toBe(5);      // lpq(5) — both are a biquad Q
    expect(lpf.params.type).toBe(0);   // lowpass
  });

  it('alternates the rim and snare reverb send once per cycle', () => {
    const d = buildCoastline(haps, LOOM_VARIANT);
    const envs = laneById(d, 'drums-1').clips[0].envelopes;
    const snare = envs.find((e) => e.paramId === 'drums-1.zone38.rev');
    expect(snare).toBeDefined();
    expect(new Set(snare.values)).toEqual(new Set([0, 0.2]));
    // 128 values per cycle, 64 cycles, alternating: value 0 in even cycles.
    expect(snare.values[0]).toBe(0);
    expect(snare.values[128]).toBe(0.2);
    expect(snare.values[256]).toBe(0);
  });

  it('names every envelope target after a param the engine declares', () => {
    const d = buildCoastline(haps, LOOM_VARIANT);
    for (const lane of d.lanes) {
      for (const e of lane.clips[0].envelopes ?? []) {
        expect(e.paramId.startsWith(`${lane.id}.`)).toBe(true);
        expect(e.paramId.slice(lane.id.length + 1)).not.toBe('');
      }
    }
  });
});

describe('crate variant', () => {
  it('keeps the sample variants on their own pads', () => {
    const d = buildCoastline(haps, CRATE_VARIANT);
    const pads = new Set(laneById(d, 'drums-1').clips[0].notes.map((n) => n.midi));
    // 36 Kick, 37 Side Stick, 38 Snare + 40 Snare E, 42 CH + 44 Pedal HH +
    // 46 OH, 51 Ride 1 + 59 Ride 2 — every variant on a note that means it.
    expect([...pads].sort((a, b) => a - b)).toEqual([36, 37, 38, 40, 42, 44, 46, 51, 59]);
  });

  it('addresses the per-pad sends by note', () => {
    const d = buildCoastline(haps, CRATE_VARIANT);
    const ids = laneById(d, 'drums-1').clips[0].envelopes.map((e) => e.paramId);
    expect(ids).toEqual(['drums-1.zone37.rev', 'drums-1.zone38.rev', 'drums-1.zone40.rev']);
  });

  it('plays the melodic lanes through the bundled instruments', () => {
    const d = buildCoastline(haps, CRATE_VARIANT);
    expect(laneById(d, 'keys-1').engineId).toBe('sampler');
    expect(laneById(d, 'keys-1').engineState.sampler.instrumentId).toBe('gm-epiano1');
    expect(laneById(d, 'bass-1').engineState.sampler.instrumentId).toBe('gm-acoustic-bass');
    expect(laneById(d, 'drums-1').engineState.sampler.drumkitId).toBe('crate');
  });

  it('carries the same note count as the other variant', () => {
    const loom = buildCoastline(haps, LOOM_VARIANT);
    const crate = buildCoastline(haps, CRATE_VARIANT);
    const count = (d) => d.lanes.reduce((s, l) => s + l.clips[0].notes.length, 0);
    expect(count(crate)).toBe(count(loom));
  });
});
