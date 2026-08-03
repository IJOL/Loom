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
import { getEngineDescriptor } from '../engines/registry';
import { isStripParamId } from '../core/channel-strip-params';
// Side-effect imports: the LFO and ADSR plugin modulators. Asking an engine for
// its descriptor serialises its modulator host, which resolves every modulator
// kind — without these, getEngineDescriptor throws "unknown modulator kind: lfo"
// before a single param id is read.
import '../plugins/modulators/lfo';
import '../plugins/modulators/adsr';
// Side-effect imports: the two built-in descriptors (for their declared params)
// and their renderers (for what those actually read).
import '../engines/tb303';
import '../engines/subtractive';
import './tb303-renderer';
import './subtractive-renderer';
// The plugin half of the same pair: the dsp registers the renderer, the manifest
// declares the params. Four engines, one contract, two doors.
import '../../plugins/fm/dsp';
import '../../plugins/wavetable/dsp';
import '../../plugins/westcoast/dsp';
import '../../plugins/karplus/dsp';
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

/** Built-in engines: the descriptor registry is the source. */
function builtinIds(engineId: string): string[] {
  const d = getEngineDescriptor(engineId);
  if (!d) throw new Error(`no descriptor for '${engineId}' — its module did not register`);
  // Mixer params are excluded on purpose: they live on the lane's ChannelStrip,
  // not in the renderer's bag, so they are not addressable and must not be.
  return [...d.params.filter((s) => !isStripParamId(s.id)).map((s) => s.id), ...LANE_EXTRAS];
}

/** Plugin engines: the manifest is the source — same contract, different door. */
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
  ['tb303', () => builtinIds('tb303')],
  ['subtractive', () => builtinIds('subtractive')],
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
