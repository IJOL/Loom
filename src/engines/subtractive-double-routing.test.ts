import { describe, it, expect } from 'vitest';
import '../../test/setup';
import { SubtractiveEngine } from './subtractive';
import { PolySynth } from '../polysynth/polysynth';
import { setCurrentLaneForVoice } from '../modulation/active-mods';

describe('SubtractiveEngine — no double routing of shared mods', () => {
  it('a shared LFO connected to filter.cutoff is wired only via the engine binder (modBus), not the voice binder', () => {
    // Setup: a shared LFO with one connection to filter.cutoff.
    const engine = new SubtractiveEngine();
    const ctx = new AudioContext();
    engine.setPolySynth(new PolySynth(ctx, ctx.destination));
    // Default LFO on the host already has scope='shared'. Add a connection
    // targeting filter.cutoff. Disable the default ADSR mods so only the
    // shared LFO is active — keeps activeCount semantics clean.
    const host = engine.modulators;
    for (const m of host.modulators) {
      if (m.kind === 'adsr') m.enabled = false;
    }
    const lfo = host.modulators.find((m) => m.kind === 'lfo');
    expect(lfo).toBeDefined();
    host.setConnection(lfo!.id, {
      id: 'c-cutoff', paramId: 'subtractive-1.filter.cutoff', depth: 0.5,
    });

    setCurrentLaneForVoice('subtractive-1');
    const voice = engine.createVoice(ctx, ctx.destination);
    // Trigger via the polysynth so the per-voice binder is materialised.
    engine.modulators; // keep TS happy if not otherwise used
    voice.trigger(60, 0, { gateDuration: 0.5 } as never);
    setCurrentLaneForVoice(null);

    // After createVoice + trigger, the modulation arrives via TWO possible
    // paths: engine binder (modBus, single connection) and voice binder
    // (per-voice). The voice binder MUST NOT have a binding for the
    // shared-bus param filter.cutoff. We assert this by inspecting voice
    // binder.activeCount(): for a single shared-LFO→filter.cutoff
    // connection, only the engine binder should bind it.
    const voiceBinder = (voice as unknown as { binder: { activeCount(): number } }).binder;
    // The voice binder should have NO active bindings for the cutoff
    // connection (it lives on the engine binder, fanning out via modBus).
    // The expected activeCount on the voice binder for this scenario is 0
    // because the only mod has its only connection targeting filter.cutoff
    // which is in the shared bus.
    expect(voiceBinder.activeCount()).toBe(0);
  });
});
