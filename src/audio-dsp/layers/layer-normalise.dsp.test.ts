// Does levelling a rack actually close the gap? Rendered, not argued.
import { describe, it, expect, beforeAll, vi } from 'vitest';
const { captured } = vi.hoisted(() => {
  const captured = new Map<string, unknown>();
  (globalThis as unknown as { Loom: unknown }).Loom = {
    apiVersion: 1, registerRenderer: (id: string, m: unknown) => { captured.set(id, m); },
    registerModulatorKernel: () => {},
  };
  return { captured };
});
import '../../../plugins/subtractive/dsp';
import '../../../plugins/karplus/dsp';
import subM from '../../../plugins/subtractive/plugin.json';
import kpM from '../../../plugins/karplus/plugin.json';
import subP from '../../../plugins/subtractive/presets.json';
import kpP from '../../../plugins/karplus/presets.json';
import energyTable from '../../../public/presets/preset-energy.json';
import { LayersRenderer } from './layers-renderer';
import { readRack } from './layer-spec';
import { slotNormalisation } from './slot-normalise';
import { registerRenderer } from '../renderer-registry';
import type { NoteSpec, ParamBag } from '@loom/plugin-sdk';

beforeAll(() => { for (const [id, m] of captured) registerRenderer(id, m as never); });

const SR = 48000;
const TABLE = energyTable as { target: number; levels: Record<string, number> };
type Man = { components: { params: { id: string; default: number }[] }[] };
const MAN: Record<string, Man> = { subtractive: subM as never, karplus: kpM as never };
const PRE: Record<string, { name: string; params: Record<string, number> }[]> = {
  subtractive: (subP as never as { presets: never[] }).presets,
  karplus: (kpP as never as { presets: never[] }).presets,
};

/** The two ends of the shipped catalogue: the loudest patch and the quietest. */
const LOUD = { engine: 'subtractive', preset: 'LEAD Acid Squelch' };
const QUIET = { engine: 'karplus', preset: 'GTR Muted Palm' };

const bagFor = (engine: string, preset: string, i: number): ParamBag => {
  const out: ParamBag = {};
  const p = PRE[engine].find((x) => x.name === preset)!;
  for (const c of MAN[engine].components) for (const q of c.params) out[`l${i}.${q.id}`] = q.default;
  for (const [k, v] of Object.entries(p.params)) if (typeof v === 'number') out[`l${i}.${k}`] = v;
  return out;
};

const note: NoteSpec = { midi: 60, beginSec: 0, durationSec: 1.5, velocity: 0.9, accent: false, slide: false };

/** One slot alone, at the trim the host would give it. */
function energyOfSlot(which: { engine: string; preset: string }, normalise: boolean): number {
  const key = `${which.engine}::${which.preset}`;
  const measured = TABLE.levels[key];
  expect(measured, `${key} missing from the table`).toBeTypeOf('number');
  // The host multiplies engine x preset x norm; the table already holds
  // engine x preset, so what this test varies is only the norm.
  const norm = normalise ? slotNormalisation(measured, TABLE.target) : 1;
  const rack = readRack([{ engineId: which.engine, lo: 0, hi: 127, gain: 1, trim: norm }]);
  const lr = new LayersRenderer(note, bagFor(which.engine, which.preset, 0), SR, rack, 0);
  let sum = 0, n = 0;
  for (let i = 0; i < SR * 3; i++) { const s = lr.renderSample(i / SR); if (!Number.isFinite(s)) break; sum += s * s; n++; }
  return Math.sqrt(sum / n);
}

const dB = (a: number, b: number) => 20 * Math.log10(a / b);

describe('levelling a rack', () => {
  it('closes the gap between the loudest and quietest patches we ship', () => {
    const rawLoud = energyOfSlot(LOUD, false), rawQuiet = energyOfSlot(QUIET, false);
    const onLoud = energyOfSlot(LOUD, true), onQuiet = energyOfSlot(QUIET, true);
    const before = dB(rawLoud, rawQuiet), after = dB(onLoud, onQuiet);
    console.log(`gap before = ${before.toFixed(1)} dB, after = ${after.toFixed(1)} dB (closed ${(before - after).toFixed(1)} dB)`);
    // Relative, and by a wide margin: the point is that the quiet slot stops
    // being inaudible, not that the two end up identical — the cap is there
    // precisely so a palm mute keeps being a palm mute.
    expect(before).toBeGreaterThan(35);
    expect(after).toBeLessThan(before - 20);
  });

  it('cuts the loud end by exactly the limit', () => {
    // The cap seen from the audio rather than from the arithmetic. Only the
    // LOUD end is asserted, and that is the finding rather than a shortcut:
    // karplus excites its string with noise, so the quiet patch measured 2.7 dB
    // apart between two renders of ITSELF — bigger than some of the corrections
    // being made. The exact size of a lift is pinned in slot-normalise.test.ts
    // where it is arithmetic and cannot wobble; what belongs here is only what
    // survives a renderer that is not deterministic.
    const cut = dB(energyOfSlot(LOUD, true), energyOfSlot(LOUD, false));
    expect(cut).toBeCloseTo(-12, 0);
  });

  it('covers every preset the app ships, so a new one cannot slip through unmeasured', () => {
    for (const [engine, list] of Object.entries(PRE)) {
      for (const p of list) {
        expect(TABLE.levels[`${engine}::${p.name}`], `${engine} · ${p.name} not measured`).toBeTypeOf('number');
      }
    }
  });
});
