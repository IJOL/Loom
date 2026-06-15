import { describe, it, expect, beforeEach } from 'vitest';
import { DrumsEngine } from './drums-engine';
import { validateSpec } from './engine-params';
import { OfflineAudioContext } from 'node-web-audio-api';
import { ChannelStrip, FxBus } from '../core/fx';
import { setCurrentLaneForVoice } from '../modulation/active-mods';
import type { ModulatorVoice } from '../modulation/types';
import { loadDrumKits, __resetDrumKitsCache } from '../presets/drum-kits-loader';
import { __seedPresetCache, __resetPresetCache } from '../presets/preset-loader';

describe('DrumsEngine.params', () => {
  const engine = new DrumsEngine();

  it('every spec validates', () => {
    for (const spec of engine.params) {
      expect(() => validateSpec(spec)).not.toThrow();
    }
  });

  it('exposes bus.* AND per-voice specs', () => {
    const ids = engine.params.map(p => p.id);
    expect(ids).toContain('bus.level');
    expect(ids).toContain('kick.tune');
    expect(ids).toContain('kick.decay');
    expect(ids).toContain('kick.rev');
    expect(ids).toContain('snare.snap');
    expect(ids).toContain('closedHat.tune');
    expect(ids).toContain('openHat.tune');
    expect(ids).toContain('ride.decay');
    expect(ids).toContain('kick.eq.low');
  });

  it('discrete specs are kick.wave + every voice chokeGroup; the rest continuous', () => {
    for (const spec of engine.params) {
      if (spec.id === 'kick.wave' || spec.id.endsWith('.chokeGroup')) expect(spec.kind).toBe('discrete');
      else expect(spec.kind).toBe('continuous');
    }
  });
});

describe('DrumsEngine getBaseValue (no instance) returns defaults', () => {
  const engine = new DrumsEngine();

  it('returns default for bus.level', () => {
    expect(engine.getBaseValue('bus.level')).toBe(1);
  });

  it('returns 0 for unknown id', () => {
    expect(engine.getBaseValue('not.real')).toBe(0);
  });

  it('setBaseValue without bus strip is a no-op (no throw)', () => {
    expect(() => engine.setBaseValue('bus.level', 0.8)).not.toThrow();
  });
});

describe('DrumsEngine BPM sync for modulator voices', () => {
  // Drums historically hardcoded `() => 120` when spawning modulator voices, so
  // LFOs never followed runtime tempo changes — distinct from every other
  // engine which uses `() => this.bpm`. This regression test captures the
  // contract.
  it('passes engine.bpm getter (not a constant) to modulators.spawnVoice', () => {
    const engine = new DrumsEngine();
    const ctx = new OfflineAudioContext(1, 128, 44100) as unknown as AudioContext;
    engine.setSharedFx(new FxBus(ctx, ctx.destination));

    let captured: (() => number) | null = null;
    const host = engine.modulators;
    const orig = host.spawnVoice.bind(host);
    host.spawnVoice = (c: AudioContext, bpm: () => number): Map<string, ModulatorVoice> => {
      captured = bpm;
      return orig(c, bpm);
    };

    engine.bpm = 174;
    const voice = engine.createVoice(ctx, ctx.destination);
    expect(captured).not.toBeNull();
    expect(captured!()).toBe(174);

    engine.bpm = 96;
    expect(captured!()).toBe(96);

    voice.dispose();
  });
});

describe('DrumsEngine bus EQ', () => {
  it('exposes bus.eq.low/mid/high AudioParams once setBusStrip is called', async () => {
    const ctx = new OfflineAudioContext(1, 128, 44100) as unknown as AudioContext;
    const fx = new FxBus(ctx, ctx.destination);
    const strip = new ChannelStrip(ctx, ctx.destination, fx);
    const engine = new DrumsEngine();
    engine.setSharedFx(fx);
    engine.setBusStrip(strip);
    const voice = engine.createVoice(ctx, strip.input);
    const params = voice.getAudioParams();
    expect(params.has('bus.eq.low')).toBe(true);
    expect(params.has('bus.eq.mid')).toBe(true);
    expect(params.has('bus.eq.high')).toBe(true);
  });

  it('setBaseValue("bus.eq.low", v) routes to the strip\'s EQ gain', async () => {
    const ctx = new OfflineAudioContext(1, 128, 44100) as unknown as AudioContext;
    const fx = new FxBus(ctx, ctx.destination);
    const strip = new ChannelStrip(ctx, ctx.destination, fx);
    const engine = new DrumsEngine();
    engine.setSharedFx(fx);
    engine.setBusStrip(strip);
    engine.createVoice(ctx, strip.input);
    engine.setBaseValue('bus.eq.low', 9);
    expect(strip.getEqGainParam('low').value).toBeCloseTo(9, 5);
  });
});

describe('DrumsEngine.getSharedAudioParams', () => {
  it('returns the bus EQ + level + sends after setBusStrip', async () => {
    const ctx = new OfflineAudioContext(1, 128, 44100) as unknown as AudioContext;
    const fx = new FxBus(ctx, ctx.destination);
    const strip = new ChannelStrip(ctx, ctx.destination, fx);
    const engine = new DrumsEngine();
    engine.setSharedFx(fx);
    engine.setBusStrip(strip);
    engine.createVoice(ctx, strip.input);
    const shared = engine.getSharedAudioParams?.() ?? new Map();
    expect(shared.has('bus.eq.low')).toBe(true);
    expect(shared.has('bus.level')).toBe(true);
    expect(shared.has('bus.pan')).toBe(true);
  });
});

describe('DrumsEngine modulation routing (LFO → bus.pan regression)', () => {
  // Regression: an LFO routed to bus.pan (or any bus.* shared param) was
  // silently inaudible. The drums engine has no per-note voices — all its
  // modulator destinations are the shared bus strip AudioParams. createVoice
  // used the PER-VOICE binder, which strips shared-scope→shared-bus connections
  // (it assumes an engine binder owns them). Drums never called the engine
  // binder, so every bus.* connection was dropped. The fix routes drums through
  // bindEngineModulators. This test fails on the old path (0 bindings) and
  // passes on the new one (1 live gain bridge into the pan AudioParam).
  it('a shared LFO connected to bus.pan creates a live binding via createVoice', async () => {
    const ctx = new OfflineAudioContext(1, 128, 44100) as unknown as AudioContext;
    const fx = new FxBus(ctx, ctx.destination);
    const strip = new ChannelStrip(ctx, ctx.destination, fx);
    const engine = new DrumsEngine();
    engine.setSharedFx(fx);
    engine.setBusStrip(strip);

    // Wire LFO1 (default scope='shared') to <lane>.bus.pan, as the modulation
    // UI does (full lane-prefixed paramId).
    const lfo = engine.modulators.modulators.find((m) => m.kind === 'lfo')!;
    engine.modulators.setConnection(lfo.id, {
      id: 'cn-pan', paramId: 'drums-1.bus.pan', depth: 0.9,
    });

    setCurrentLaneForVoice('drums-1');
    const voice = engine.createVoice(ctx, strip.input) as unknown as {
      binder?: { activeCount(): number };
    };
    setCurrentLaneForVoice(null);

    expect(voice.binder, 'createVoice must build a modulator binder for the lane').toBeDefined();
    expect(
      voice.binder!.activeCount(),
      'the LFO→bus.pan connection must produce exactly one live gain bridge',
    ).toBe(1);
  });
});

describe('DrumsEngine façade — kitMode + forwarders', () => {
  it('defaults to synth mode', () => {
    const e = new DrumsEngine();
    expect(e.getKitMode()).toBe('synth');
  });

  it('setKitMode flips the mode', () => {
    const e = new DrumsEngine();
    e.setKitMode('sample');
    expect(e.getKitMode()).toBe('sample');
  });

  it('forwards setKeymap/getKeymap/setPadStore/getPadStore to the embedded sampler', () => {
    const e = new DrumsEngine();
    const km = [{ sampleId: 's1', rootNote: 36, loNote: 36, hiNote: 36 }];
    e.setKeymap(km);
    expect(e.getKeymap()).toEqual(km);
    e.setPadStore({ 36: { tune: 3 } });
    expect(e.getPadStore()[36]).toEqual({ tune: 3 });
  });

  it('routes drum-voice mutes to the embedded sampler in sample mode', () => {
    const e = new DrumsEngine();
    e.setKitMode('sample');
    e.setDrumVoiceMutes({ kick: true });
    expect(e.getDrumVoiceMutes()).toEqual({ kick: true });
  });
});

describe('DrumsEngine façade — mode-aware surface', () => {
  it('params forward to the embedded sampler in sample mode', () => {
    const e = new DrumsEngine();
    const synthParamCount = e.params.length;
    e.setKitMode('sample');
    e.setKeymap([{ sampleId: 's', rootNote: 36, loNote: 36, hiNote: 36 }]);
    // Sampler params are dynamic: globals (gain, poly.voices) + one set per pad,
    // keyed by the pad's note (zone<note>), not a GM voice name.
    expect(e.params.some((p) => p.id === 'gain')).toBe(true);
    expect(e.params.some((p) => p.id === 'zone36.tune')).toBe(true);
    expect(e.params.length).not.toBe(synthParamCount);
  });

  it('getRackLayout forwards to the embedded sampler in sample mode', () => {
    const e = new DrumsEngine();
    e.setKitMode('sample');
    expect(e.getRackLayout().curatedSynth).toEqual(['tune', 'cutoff', 'decay']);
  });

  it('createVoice in sample mode triggers the embedded sampler', () => {
    const ctx = new AudioContext();
    const e = new DrumsEngine();
    e.setSharedFx({ reverbInput: ctx.createGain(), delayInput: ctx.createGain() } as unknown as import('../core/fx').FxBus);
    e.setKitMode('sample');
    e.setKeymap([{ sampleId: 'missing', rootNote: 36, loNote: 36, hiNote: 36 }]);
    const v = e.createVoice(ctx, ctx.destination);
    expect(typeof v.trigger).toBe('function');
    expect(() => v.trigger(36, ctx.currentTime, { gateDuration: 0.1, accent: false } as never)).not.toThrow();
  });
});

async function seedDrumKits() {
  __resetDrumKitsCache();
  await loadDrumKits((async () => ({ ok: true, json: async () => ({ presets: [
    { name: 'TR-909', group: 'Synth', kind: 'synth', kitId: '909' },
    { name: 'TR-808 (samples)', group: 'Samples', kind: 'sample', drumkitId: 'tr808' },
  ] }) })) as unknown as typeof fetch);
}

describe('DrumsEngine.applyPreset — unified + back-compat', () => {
  beforeEach(async () => { await seedDrumKits(); });

  it('sets kitMode=sample without an instance (no early-return)', () => {
    const e = new DrumsEngine();              // NO createVoice → lastInstance is null
    e.applyPreset('TR-808 (samples)');
    expect(e.getKitMode()).toBe('sample');
  });

  it('sets kitMode=synth for a unified synth kit', () => {
    const e = new DrumsEngine();
    e.applyPreset('TR-909');
    expect(e.getKitMode()).toBe('synth');
  });

  it('back-compat: a legacy GM-tagged KIT name still resolves to a synth kit', () => {
    __resetPresetCache();
    __seedPresetCache('drums-machine', [
      { name: 'KIT Power', gm: [16], params: { kitId: '909' } } as never,
    ]);
    const e = new DrumsEngine();
    const ctx = new AudioContext();
    e.setSharedFx({ reverbInput: ctx.createGain(), delayInput: ctx.createGain() } as never);
    setCurrentLaneForVoice('drums-1');
    e.createVoice(ctx, ctx.destination);      // builds lastInstance
    setCurrentLaneForVoice(null);
    e.applyPreset('KIT Power');
    expect(e.getKitMode()).toBe('synth');
    expect(e.getInstance()?.kitId).toBe('909');
  });
});
