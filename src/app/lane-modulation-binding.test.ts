// A modulator routed to a LANE INSERT param must actually move that param.
//
// The modulation panel offers "Lane FX" / "Master FX" destinations for EVERY
// engine (modulation-ui builds them from the insert chain), but only the drums
// and sampler engines ever called a binder. On the six melodic engines the
// destination was selectable and dead — and, because the offline exporter binds
// nothing at all, dead there too.
//
// This asserts the connection is live by rendering audio: a bipolar LFO on a
// lowpass insert's cutoff must change the sound, and a DISABLED modulator must
// not. Relative assertions only — the control is the same graph with the
// modulator off.
import { describe, it, expect } from 'vitest';
import '../engines/subtractive';
import { createLaneAllocator } from './lane-allocator';
import { FxBus } from '../core/fx';
import { SidechainBus } from '../core/sidechain-bus';
import { OfflineAudioContext } from 'node-web-audio-api';
import { createInstance, registerPlugin } from '../plugins/registry';
import { multifilterPlugin } from '../plugins/fx/multifilter';
import type { ModulatorState } from '../modulation/types';

const SR = 44100;
const LANE = 'subtractive-1';

/** Sum of sample-to-sample jumps — a cheap high-frequency proxy. A cutoff that
 *  sweeps changes this over the render; a static cutoff does not. */
function totalVariation(b: Float32Array): number {
  let s = 0;
  for (let i = 1; i < b.length; i++) s += Math.abs(b[i] - b[i - 1]);
  return s;
}

function lfoOnInsertCutoff(enabled: boolean): ModulatorState {
  return {
    id: 'lfo-1', kind: 'lfo', enabled,
    scope: 'shared',
    params: { rate: 6, depth: 1, wave: 'sine' },
    connections: [{ paramId: 'lane-insert-0:freq', depth: 1, enabled: true }],
  } as unknown as ModulatorState;
}

async function renderWithModulator(mod: ModulatorState): Promise<Float32Array> {
  // Register explicitly rather than relying on the side-effect import: another
  // test file calls _resetRegistry(), and module caching means the import will
  // not re-run to repopulate it. Order-independent beats tidy here.
  registerPlugin(multifilterPlugin);
  const ctx = new OfflineAudioContext(1, SR, SR) as unknown as AudioContext;
  const master = ctx.createGain();
  master.connect((ctx as unknown as OfflineAudioContext).destination as unknown as AudioNode);
  const fx = new FxBus(ctx, master);

  const lanes = createLaneAllocator({
    ctx, master, fx, sidechainBus: new SidechainBus(),
    getBpm: () => 120, extraIds: [],
  });
  lanes.ensureLaneResource(LANE, 'subtractive');
  const engine = lanes.getLaneEngineInstance(LANE)!;

  // A lowpass insert in slot 0 — the modulation destination under test.
  const inserts = lanes.resources.get(LANE)!.inserts;
  inserts.insert(createInstance('fx', 'multifilter', ctx)!);
  const slot = inserts.list()[0];
  slot.fx.setBaseValue('type', 0);      // lowpass
  slot.fx.setBaseValue('freq', 900);
  slot.fx.setBaseValue('q', 6);

  // Declare the modulator on the engine's host, then re-bind — the same call
  // the live UI makes when the modulator set changes.
  engine.modulators.deserialize([mod]);
  lanes.bindLaneModulators(LANE);

  // Drive the insert with a harmonically rich source so a moving cutoff shows.
  const osc = (ctx as unknown as OfflineAudioContext).createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = 110;
  (osc as unknown as AudioNode).connect(slot.fx.input);
  osc.start();

  const buf = await (ctx as unknown as OfflineAudioContext).startRendering();
  return new Float32Array(buf.getChannelData(0));
}

describe('a modulator routed to a lane-insert param is actually connected', () => {
  it('an LFO on a melodic lane sweeps the insert cutoff — the sound changes', async () => {
    const off = await renderWithModulator(lfoOnInsertCutoff(false));
    const on  = await renderWithModulator(lfoOnInsertCutoff(true));
    // A swept cutoff passes a different amount of harmonic content than a
    // static one. Equality here means the modulator was never connected.
    expect(totalVariation(on)).not.toBeCloseTo(totalVariation(off), 1);
  });
});
