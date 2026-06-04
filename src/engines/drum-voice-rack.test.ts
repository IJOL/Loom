/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { renderDrumVoiceRack } from './drum-voice-rack';
import { DrumsEngine } from './drums-engine';
import { ChannelStrip, FxBus } from '../core/fx';
import type { EngineUIContext } from './engine-types';

function makeCtx(registered: string[]): EngineUIContext {
  return {
    laneId: 'drums-1',
    registerKnob: (k: { meta?: { id?: string } }) => { if (k.meta?.id) registered.push(k.meta.id); },
    registry: new Map<string, unknown>(),
  } as unknown as EngineUIContext;
}

function makeLiveEngine(): DrumsEngine {
  const ctx = new OfflineAudioContext(1, 1024, 44100) as unknown as AudioContext;
  const fx = new FxBus(ctx, ctx.destination);
  const strip = new ChannelStrip(ctx, ctx.destination, fx);
  const engine = new DrumsEngine();
  engine.setSharedFx(fx);
  engine.setBusStrip(strip);
  engine.createVoice(ctx, strip.input);
  return engine;
}

describe('renderDrumVoiceRack', () => {
  it('renders 8 voice columns', () => {
    const host = document.createElement('div');
    renderDrumVoiceRack(new DrumsEngine(), makeCtx([]), host);
    expect(host.querySelectorAll('.dv-col').length).toBe(8);
  });

  it('registers curated + mixer knob ids per voice under the lane prefix', () => {
    const host = document.createElement('div');
    const ids: string[] = [];
    renderDrumVoiceRack(new DrumsEngine(), makeCtx(ids), host);
    expect(ids).toContain('drums-1.kick.tune');
    expect(ids).toContain('drums-1.kick.rev');
    expect(ids).toContain('drums-1.snare.snap');
    // advanced ids are rendered too (collapsed, but registered):
    expect(ids).toContain('drums-1.kick.startFreq');
    expect(ids).toContain('drums-1.kick.wave');
  });

  it('advanced block is collapsed by default and toggles on click', () => {
    const host = document.createElement('div');
    renderDrumVoiceRack(new DrumsEngine(), makeCtx([]), host);
    const adv = host.querySelector('.dv-advanced') as HTMLElement;
    const btn = host.querySelector('.dv-adv-toggle') as HTMLButtonElement;
    expect(adv.classList.contains('open')).toBe(false);
    btn.click();
    expect(adv.classList.contains('open')).toBe(true);
  });

  it('renders an M and S button per voice column', () => {
    const host = document.createElement('div');
    renderDrumVoiceRack(new DrumsEngine(), makeCtx([]), host);
    expect(host.querySelectorAll('.dv-mute').length).toBe(8);
    expect(host.querySelectorAll('.dv-solo').length).toBe(8);
  });

  it('M button mutes that voice strip; S button solos within the kit', () => {
    const engine = makeLiveEngine();
    const dm = engine.getInstance()!;
    const host = document.createElement('div');
    renderDrumVoiceRack(engine, makeCtx([]), host);

    const kickMute = host.querySelector('.dv-col.kick .dv-mute') as HTMLButtonElement;
    const snareSolo = host.querySelector('.dv-col.snare .dv-solo') as HTMLButtonElement;

    kickMute.click();
    expect(dm.channels.kick.isMuted()).toBe(true);
    expect(kickMute.classList.contains('on')).toBe(true);

    snareSolo.click();
    expect(dm.channels.snare.isMuted()).toBe(false);     // soloed → audible
    expect(dm.channels.kick.isMuted()).toBe(true);        // muted (explicit + not soloed)
    expect(dm.channels.closedHat.isMuted()).toBe(true);   // silenced by the solo
    expect(snareSolo.classList.contains('on')).toBe(true);
  });

  it('uses the engine getRackLayout for curated/advanced ids when present', () => {
    const host = document.createElement('div');
    const ids: string[] = [];
    const fakeEngine = {
      params: [
        { id: 'kick.tune', label: 'TUNE', kind: 'continuous', min: 0, max: 1, default: 0 },
        { id: 'kick.weird', label: 'W', kind: 'continuous', min: 0, max: 1, default: 0 },
        { id: 'kick.level', label: 'L', kind: 'continuous', min: 0, max: 1, default: 0 },
      ],
      getBaseValue: () => 0, setBaseValue: () => {},
      getRackLayout: () => ({ curatedSynth: ['tune'], curatedMixer: ['level'], advancedMixer: [] }),
      getDrumVoiceMute: () => false, setDrumVoiceMute: () => {},
      getDrumVoiceSolo: () => false, toggleDrumVoiceSolo: () => {}, getDrumVoiceMutes: () => ({}),
    } as unknown as import('./engine-types').SynthEngine;
    renderDrumVoiceRack(fakeEngine, makeCtx(ids), host, ['kick']);
    expect(ids).toContain('drums-1.kick.tune');   // curated synth
    expect(ids).toContain('drums-1.kick.level');  // curated mixer
    expect(ids).toContain('drums-1.kick.weird');  // falls into advanced
  });
});
