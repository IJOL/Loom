// A lane's engine must route the seven strip params to the lane's ChannelStrip.
//
// The catalogue lists them for every lane now, but listing a destination whose
// write goes nowhere is worse than not listing it: the menu opens, the envelope
// draws, and the sound never changes. So the write path gets its own test per
// engine class that owns a strip.
//
// Single source of truth, deliberately: a strip param is NOT mirrored into the
// engine's ParamBag. The strip's own nodes hold the value and the session
// persists them as `lane.mixer` (session-host-persistence calls
// strip.serialize()). A second copy in engineState.params would be a second
// owner of one number, and the two would disagree the moment either path wrote
// alone.
import { describe, it, expect } from 'vitest';
import '../../test/setup';
import { ChannelStrip, FxBus } from '../core/fx';
import { WorkletLaneEngine, type WorkletEngineConfig } from './worklet-lane-engine';
import { SUB_PARAM_SPECS } from './subtractive-params';
import { STRIP_PARAM_SPECS } from '../core/channel-strip-params';

function fixture() {
  const ctx = new OfflineAudioContext(2, 4410, 44100) as unknown as AudioContext;
  const fx = new FxBus(ctx, ctx.destination);
  const strip = new ChannelStrip(ctx, ctx.destination, fx);
  const cfg: WorkletEngineConfig = {
    engineId: 'subtractive', name: 'Sub', params: [...SUB_PARAM_SPECS, ...STRIP_PARAM_SPECS],
    presetsKey: 'subtractive', polyphony: 'poly',
  };
  const engine = new WorkletLaneEngine(ctx, strip.input, cfg);
  return { ctx, strip, engine };
}

describe('WorkletLaneEngine strip params', () => {
  it('writes bus.* onto the attached strip', () => {
    const { strip, engine } = fixture();
    engine.setBusStrip(strip);

    engine.setBaseValue('bus.level', 0.4);
    engine.setBaseValue('bus.delaySend', 0.65);
    engine.setBaseValue('bus.reverbSend', 0.2);
    engine.setBaseValue('bus.eq.low', -7.5);
    engine.setBaseValue('bus.eq.mid', 4);
    engine.setBaseValue('bus.eq.high', 11);

    expect(strip.level.gain.value).toBeCloseTo(0.4, 4);
    expect(strip.sendA.gain.value).toBeCloseTo(0.65, 4);
    expect(strip.sendB.gain.value).toBeCloseTo(0.2, 4);
    expect(strip.getEqGainParam('low').value).toBeCloseTo(-7.5, 4);
    expect(strip.getEqGainParam('mid').value).toBeCloseTo(4, 4);
    expect(strip.getEqGainParam('high').value).toBeCloseTo(11, 4);
  });

  it('reads bus.* back off the strip, not off a private copy', () => {
    const { strip, engine } = fixture();
    engine.setBusStrip(strip);
    // Moved on the strip directly — which is what the mixer column's own
    // onChange does. The engine must report the CURRENT gain, or a knob rebuilt
    // from getBaseValue would snap the fader back to a stale value.
    strip.setLevel(1.25);
    strip.setEqMid(-3);
    expect(engine.getBaseValue('bus.level')).toBeCloseTo(1.25, 4);
    expect(engine.getBaseValue('bus.eq.mid')).toBeCloseTo(-3, 4);
  });

  it('keeps bus.* out of the ParamBag the offline kernel renders from', () => {
    const { strip, engine } = fixture();
    engine.setBusStrip(strip);
    engine.setBaseValue('bus.level', 0.3);
    // The bag is the synth renderer's input. A `bus.level` key in it would be a
    // second owner of the fader AND a param the renderer does not have.
    expect(Object.keys(engine.getParamBag())).not.toContain('bus.level');
  });

  it('still routes its own synth params to the bag', () => {
    const { strip, engine } = fixture();
    engine.setBusStrip(strip);
    engine.setBaseValue('filter.cutoff', 0.42);
    expect(engine.getParamBag()['filter.cutoff']).toBeCloseTo(0.42, 4);
  });

  it('falls back to the declared default when no strip is attached yet', () => {
    // Engines are constructed before the allocator hands them a strip; a read in
    // that window must not throw or report 0 for LEVEL.
    const { engine } = fixture();
    expect(engine.getBaseValue('bus.level')).toBe(1);
    expect(() => engine.setBaseValue('bus.level', 0.5)).not.toThrow();
  });

  it('exposes the strip AudioParams for modulation', () => {
    const { strip, engine } = fixture();
    engine.setBusStrip(strip);
    const shared = engine.getSharedAudioParams();
    expect([...shared.keys()].sort()).toEqual(STRIP_PARAM_SPECS.map((s) => s.id).sort());
  });
});
