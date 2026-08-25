import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTune, cycleTicksFor, ticksPerBar } from './tune-map.mjs';
import { TUNE_SPECS } from './tune-specs.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const hapsOf = (n) => JSON.parse(readFileSync(join(HERE, 'data', `${n}-haps.json`), 'utf8'));
const NAMES = Object.keys(TUNE_SPECS);

/** The param ids a plugin declares, or null when the id belongs to one of the
 *  three in-tree engines, which ship no manifest. */
const manifestCache = new Map();
function paramIdsOf(pluginId) {
  if (!manifestCache.has(pluginId)) {
    let ids = null;
    try {
      const m = JSON.parse(readFileSync(join(HERE, '..', 'plugins', pluginId, 'plugin.json'), 'utf8'));
      ids = m.components.flatMap((c) => c.params.map((prm) => prm.id));
    } catch { /* not a plugin — an in-tree engine */ }
    manifestCache.set(pluginId, ids);
  }
  return manifestCache.get(pluginId);
}

describe('tune mapper', () => {
  it('derives ticks-per-cycle from cps and bpm rather than choosing it', () => {
    // A cycle lasts 1/cps seconds and a second is bpm/60 quarters.
    expect(cycleTicksFor(0.5, 120)).toBe(384);   // 2s at 120bpm = one 4/4 bar
    expect(cycleTicksFor(0.5, 90)).toBe(288);    // 2s at 90bpm  = one 3/4 bar
    expect(ticksPerBar({ num: 3, den: 4 })).toBe(288);
    expect(ticksPerBar({ num: 4, den: 4 })).toBe(384);
  });

  for (const name of NAMES) {
    describe(name, () => {
      const haps = hapsOf(name);
      const spec = TUNE_SPECS[name];
      const demo = buildTune(haps, spec);

      it('fills whole bars — the check that the meter and bpm are right', () => {
        const bars = (haps.cycles * cycleTicksFor(haps.cps, spec.bpm)) / ticksPerBar(spec.meter);
        expect(Number.isInteger(bars)).toBe(true);
        for (const l of demo.lanes) expect(l.clips[0].lengthBars).toBe(bars);
      });

      it('carries its time signature so the grid is not silently 4/4', () => {
        expect(demo.timeSignature).toEqual(spec.meter);
      });

      it('routes every event to exactly one voice', () => {
        const total = demo.lanes.reduce((s, l) => s + l.clips[0].notes.length, 0);
        expect(total).toBe(haps.events.length);
        for (const l of demo.lanes) expect(l.clips[0].notes.length).toBeGreaterThan(0);
      });

      it('puts every note on an integer tick inside the clip, at a sane pitch', () => {
        const end = demo.lanes[0].clips[0].lengthBars * ticksPerBar(spec.meter);
        for (const l of demo.lanes) {
          for (const n of l.clips[0].notes) {
            expect(Number.isInteger(n.start)).toBe(true);
            expect(Number.isInteger(n.midi)).toBe(true);
            expect(n.midi).toBeGreaterThanOrEqual(0);
            expect(n.midi).toBeLessThanOrEqual(127);
            expect(n.start).toBeGreaterThanOrEqual(0);
            expect(n.start).toBeLessThan(end);
            expect(n.duration).toBeGreaterThan(0);
            expect(n.velocity).toBeLessThan(100);   // never trip the accent
          }
        }
      });

      // A voice whose Strudel scale names an octave — `'G1:minor'` — plays from
      // that root upwards, so its register is DERIVED, not chosen. This is the
      // assertion that was missing when `'G1 minor'` silently stopped resolving:
      // the sanity check above only asked for 0..127, and Flatrave shipped with
      // its bass at C3-G#3 and its arp an octave under where it belongs.
      it('keeps every scale-anchored voice in the register its root implies', () => {
        for (const v of spec.voices) {
          if (!v.register) continue;
          const notes = demo.lanes.find((l) => l.id === v.id).clips[0].notes;
          const [lo, hi] = v.register;
          expect(Math.min(...notes.map((n) => n.midi))).toBeGreaterThanOrEqual(lo);
          expect(Math.max(...notes.map((n) => n.midi))).toBeLessThanOrEqual(hi);
        }
      });

      // A drum note whose pad has no sample behind it is SILENCE, not an error:
      // nothing throws, the lane just plays fewer drums than the tune has. So
      // every note a drums lane emits is checked against the pads its own kit
      // actually ships.
      it('only hits pads its kit actually has', () => {
        for (const l of demo.lanes.filter((x) => x.engineId === 'drums-machine')) {
          const kitId = l.engineState.sampler.drumkitId;
          const kit = JSON.parse(readFileSync(join(HERE, '..', 'public', 'drumkits', `${kitId}.json`), 'utf8'));
          const have = new Set(kit.samples.map((s) => s.note));
          for (const midi of new Set(l.clips[0].notes.map((n) => n.midi))) {
            expect({ kitId, midi, has: have.has(midi) }).toEqual({ kitId, midi, has: true });
          }
        }
      });

      // Same failure mode one level up: a sampler lane pointed at an instrument
      // that is not in the index loads nothing and plays nothing, quietly. Its
      // zones must also reach every note the lane asks for.
      it('points its sampler lanes at an instrument that exists and spans them', () => {
        const index = JSON.parse(readFileSync(join(HERE, '..', 'public', 'instruments', 'index.json'), 'utf8'));
        for (const l of demo.lanes.filter((x) => x.engineState?.sampler?.instrumentId)) {
          const id = l.engineState.sampler.instrumentId;
          expect(index.map((e) => e.id)).toContain(id);
          const inst = JSON.parse(readFileSync(join(HERE, '..', 'public', 'instruments', `${id}.json`), 'utf8'));
          for (const midi of new Set(l.clips[0].notes.map((n) => n.midi))) {
            const covered = inst.zones.some((z) => midi >= z.loNote && midi <= z.hiNote);
            expect({ id, midi, covered }).toEqual({ id, midi, covered: true });
          }
        }
      });

      // An envelope whose paramId names nothing is INERT, and inert is exactly
      // what working looks like: the demo loads, plays, and quietly never moves
      // that knob. `landAutomationValue` needs the id to be a destination the
      // session offers, so the two shapes it can take are checked against what
      // actually declares them — the engine's manifest, or the insert plugin's
      // manifest plus a slot of that id on that very lane.
      it('points every clip envelope at a param that exists', () => {
        for (const lane of demo.lanes) {
          for (const env of lane.clips[0].envelopes ?? []) {
            const [scope, ...rest] = env.paramId.split('.');
            expect({ paramId: env.paramId, scope }).toEqual({ paramId: env.paramId, scope: lane.id });
            const slotAt = rest.findIndex((seg) => seg.startsWith('fx:'));
            if (slotAt >= 0) {
              const slotId = rest[slotAt].slice(3);
              const slot = (lane.inserts ?? []).find((i) => i.id === slotId);
              expect({ paramId: env.paramId, slot: !!slot }).toEqual({ paramId: env.paramId, slot: true });
              expect(paramIdsOf(slot.pluginId)).toContain(rest.slice(slotAt + 1).join('.'));
              continue;
            }
            const leaf = rest.join('.');
            // A strip param is the desk, not the patch, and no manifest names one.
            if (leaf.startsWith('bus.')) continue;
            const declared = paramIdsOf(lane.engineId);
            // Only the plugin engines declare their params as data; the three
            // in-tree ones (sampler, audio, drums-machine) have no manifest to
            // read, so there is nothing here to check them against.
            if (!declared) continue;
            expect({ paramId: env.paramId, declared }).toEqual({ paramId: env.paramId, declared: expect.arrayContaining([leaf]) });
          }
        }
      });

      it('launches every lane from one scene', () => {
        expect(demo.scenes).toHaveLength(1);
        expect(Object.keys(demo.scenes[0].clipPerLane).sort())
          .toEqual(demo.lanes.map((l) => l.id).sort());
      });
    });
  }

  it("keeps Zelda's detuned copy on its own lane so the beating survives", () => {
    const demo = buildTune(hapsOf('zeldas-rescue'), TUNE_SPECS['zeldas-rescue']);
    const detuned = demo.lanes.find((l) => l.id === 'lead-2');
    expect(detuned.engineState.params['master.tune']).toBeCloseTo(0.06, 5);
    // Both lanes carry notes: the superimpose doubles every voice.
    expect(demo.lanes[0].clips[0].notes.length).toBeGreaterThan(0);
    expect(detuned.clips[0].notes.length).toBeGreaterThan(0);
  });

  it('refuses a meter that would leave a fractional bar', () => {
    // 51 cycles of 384 ticks do not divide into bars of 480.
    expect(() => buildTune(hapsOf('swimming'), { ...TUNE_SPECS.swimming, meter: { num: 5, den: 4 } }))
      .toThrow(/do not fill whole bars/);
  });

  it('does NOT claim to detect every wrong meter — 4/4 also divides Swimming', () => {
    // Worth pinning, because it is easy to mistake the guard for a proof. Both
    // 3/4 (68 bars) and 4/4 (51 bars) fill whole bars here; what says three is
    // the music — each written seq element is four groups of three beats — not
    // divisibility. The guard catches a lopsided clip, nothing more.
    const asFour = buildTune(hapsOf('swimming'), { ...TUNE_SPECS.swimming, meter: { num: 4, den: 4 } });
    expect(asFour.lanes[0].clips[0].lengthBars).toBe(51);
  });
});
