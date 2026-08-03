// src/audio-dsp/declared-params.dsp.test.ts
// Every param a renderer READS LIVE must be one its engine DECLARES.
//
// Reading by slot made a whole class of bug invisible-by-default. A renderer
// resolves `slotOf(index, 'noise.color')`; if the lane never declared that id it
// gets -1, falls back to the frozen trigger value, and stays there for the life
// of every voice — no error, no warning, and no sound difference the parity test
// can see, because that fallback IS the default the reference was rendered from.
// The knob is simply dead, forever, and nothing in the suite noticed.
//
// This test hands each renderer a PROBE index that records every id it asks for,
// and builds the declared set exactly as production does (see
// worklet-lane-engine.ts): the engine's own specs minus the mixer params, plus
// the two the lane adds. A renderer reaching for an id nobody declares fails
// HERE — which is how noise.color surfaced, dead since the worklet cutover.
import { describe, it, expect } from 'vitest';

// Same reason as live-params.dsp.test.ts: a plugin's dsp.ts calls
// Loom.registerRenderer at module scope, so the global has to exist before the
// import graph is evaluated. `test/plugin-dsp` installs it and forwards into the
// renderer registry, so it MUST stay above the plugin imports.
import '../../test/plugin-dsp';
import type { NoteSpec, ParamIndex } from './types';
import { buildParamIndex } from './param-index';
import { createRenderer } from './renderer-registry';
// Every engine is a plugin now, and each brings the pair this test needs: the
// dsp registers the renderer, the manifest declares the params. Six engines,
// one contract, two doors.
import '../../plugins/tb303/dsp';
import '../../plugins/subtractive/dsp';
import '../../plugins/fm/dsp';
import '../../plugins/wavetable/dsp';
import '../../plugins/westcoast/dsp';
import '../../plugins/karplus/dsp';
import tb303Manifest from '../../plugins/tb303/plugin.json';
import subtractiveManifest from '../../plugins/subtractive/plugin.json';
import fmManifest from '../../plugins/fm/plugin.json';
import wavetableManifest from '../../plugins/wavetable/plugin.json';
import westcoastManifest from '../../plugins/westcoast/plugin.json';
import karplusManifest from '../../plugins/karplus/plugin.json';

const SR = 48000;
const note: NoteSpec =
  { midi: 45, beginSec: 0, durationSec: 1, velocity: 0.9, accent: false, slide: false };

/** The two ids a LANE adds on top of its engine's specs (worklet-lane-engine.ts).
 *  `output.trim` is the interesting one: plugins/fm and plugins/karplus read it
 *  live and no engine declares it, so it only has a slot because the lane seeds
 *  it. Keep this list and the seed in step. */
const LANE_EXTRAS = ['poly.voices', 'output.trim'];

/** Every engine is a plugin, so the manifest is the ONE source for what an
 *  engine declares. Mixer params never appear in it: they live on the lane's
 *  ChannelStrip, not in the renderer's bag, so they are not addressable and must
 *  not be. (This used to have a second, descriptor-reading half for the built-in
 *  engines — two doors onto one contract, until the last built-in left.) */
function manifestIds(m: { components: { params?: { id: string }[] }[] }): string[] {
  return [...(m.components[0].params ?? []).map((p) => p.id), ...LANE_EXTRAS];
}

/** An index that answers like the real one but records every id asked for. A
 *  renderer resolves its slots ONCE, in setLiveValues, so one call observes the
 *  whole set it cares about. */
function probeIndex(real: ParamIndex): { index: ParamIndex; asked: string[] } {
  const asked: string[] = [];
  const slot = new Proxy({} as Record<string, number>, {
    get(_t, id) {
      if (typeof id !== 'string') return undefined;
      asked.push(id);
      return real.slot[id];
    },
  });
  return { index: { slot, length: real.length }, asked };
}

const CASES: [string, () => string[]][] = [
  ['tb303', () => manifestIds(tb303Manifest as never)],
  ['subtractive', () => manifestIds(subtractiveManifest as never)],
  ['fm', () => manifestIds(fmManifest as never)],
  ['wavetable', () => manifestIds(wavetableManifest as never)],
  ['westcoast', () => manifestIds(westcoastManifest as never)],
  ['karplus', () => manifestIds(karplusManifest as never)],
];

describe('a renderer only reads params its engine declares', () => {
  it.each(CASES)('%s', (engineId, ids) => {
    const real = buildParamIndex(ids());
    const { index, asked } = probeIndex(real);

    const v = createRenderer(engineId, note, {}, SR);
    expect(typeof v.setLiveValues, `${engineId} has no setLiveValues`).toBe('function');
    v.setLiveValues!(new Float64Array(real.length), index);

    const undeclared = [...new Set(asked)].filter((id) => real.slot[id] === undefined);
    expect(undeclared,
      `${engineId} reads [${undeclared.join(', ')}] live, but neither its engine spec nor the `
      + 'lane extras declare it — those knobs are dead: the renderer falls back to its trigger '
      + 'snapshot forever, silently',
    ).toEqual([]);
  });
});
