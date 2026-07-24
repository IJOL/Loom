// @vitest-environment jsdom
// Characterisation tests for buildMixerColumn (added with the lit-html
// migration): render structure + the main interactions. The ChannelStrip is
// faked — the column only calls serialize()/setters/getMeterAnalyser, none of
// which needs a real audio graph here.
import { describe, it, expect, vi } from 'vitest';
import { buildMixerColumn, type MixerColumnDeps } from './mixer';
import type { ChannelStrip } from './fx';
import type { KnobHandle } from './knob';

// createLevelMeter only reads fftSize and calls getFloatTimeDomainData from
// its RAF loop; neither needs a real audio graph for structural assertions.
function fakeAnalyser(): AnalyserNode {
  return {
    fftSize: 512,
    getFloatTimeDomainData() {},
  } as unknown as AnalyserNode;
}

function fakeStrip() {
  const strip = {
    serialize: () => ({
      level: 1, eqLow: 0, eqMid: 0, eqHigh: 0, sendA: 0, sendB: 0, pan: 0,
    }),
    setEqHigh: vi.fn(), setEqMid: vi.fn(), setEqLow: vi.fn(),
    setSendA: vi.fn(), setSendB: vi.fn(), setPan: vi.fn(),
    setLevel: vi.fn(),
    getMeterAnalyser: () => fakeAnalyser(),
  };
  return strip as unknown as ChannelStrip & typeof strip;
}

function makeDeps(over: Partial<MixerColumnDeps> = {}): MixerColumnDeps & { registered: KnobHandle[] } {
  const registered: KnobHandle[] = [];
  return {
    stripFor: () => fakeStrip(),
    label: (id) => `Label ${id}`,
    muteState: {},
    soloState: {},
    applyMuteSolo: () => {},
    registerKnob: (k) => registered.push(k),
    registered,
    ...over,
  };
}

describe('buildMixerColumn', () => {
  it('returns a .mix-col carrying the track id class, with the track label', () => {
    const el = buildMixerColumn('poly1', makeDeps());
    expect(el).toBeInstanceOf(HTMLElement);
    expect(el.classList.contains('mix-col')).toBe(true);
    expect(el.classList.contains('poly1')).toBe(true);
    expect(el.querySelector('.mix-name')!.textContent).toBe('Label poly1');
  });

  it('has EQ (3 knobs) + SEND (2) + PAN (1) sections — 6 knobs total', () => {
    const el = buildMixerColumn('poly1', makeDeps());
    const labels = [...el.querySelectorAll('.mix-sec-label')].map((l) => l.textContent);
    expect(labels).toEqual(['EQ', 'SEND']);
    expect(el.querySelectorAll('.knob').length).toBe(6);
  });

  it('registers the six knobs under mix.<trackId>.* in build order', () => {
    const deps = makeDeps();
    buildMixerColumn('poly1', deps);
    expect(deps.registered.map((k) => k.meta.id)).toEqual([
      'mix.poly1.eqhi', 'mix.poly1.eqmid', 'mix.poly1.eqlow',
      'mix.poly1.sendA', 'mix.poly1.sendB', 'mix.poly1.pan',
    ]);
  });

  it('mute button toggles muteState, reflects .active and applies', () => {
    const applyMuteSolo = vi.fn();
    const deps = makeDeps({ muteState: {}, applyMuteSolo });
    const el = buildMixerColumn('poly1', deps);
    const m = el.querySelector('.mix-btn.mute') as HTMLButtonElement;
    expect(m.classList.contains('active')).toBe(false);
    m.click();
    expect(deps.muteState['poly1']).toBe(true);
    expect(m.classList.contains('active')).toBe(true);
    expect(applyMuteSolo).toHaveBeenCalledTimes(1);
    m.click();
    expect(deps.muteState['poly1']).toBe(false);
    expect(m.classList.contains('active')).toBe(false);
  });

  it('solo button toggles soloState and applies', () => {
    const applyMuteSolo = vi.fn();
    const deps = makeDeps({ soloState: { poly1: true }, applyMuteSolo });
    const el = buildMixerColumn('poly1', deps);
    const s = el.querySelector('.mix-btn.solo') as HTMLButtonElement;
    expect(s.classList.contains('active')).toBe(true);
    s.click();
    expect(deps.soloState['poly1']).toBe(false);
    expect(applyMuteSolo).toHaveBeenCalledTimes(1);
  });

  it('fader drives strip.setLevel and updates the % readout', () => {
    const strip = fakeStrip();
    const el = buildMixerColumn('poly1', makeDeps({ stripFor: () => strip as unknown as ChannelStrip }));
    const fader = el.querySelector('.mix-fader') as HTMLInputElement;
    expect(fader.value).toBe('1');
    expect(el.querySelector('.mix-fader-val')!.textContent).toBe('100%');
    fader.value = '0.5';
    fader.dispatchEvent(new Event('input'));
    expect(strip.setLevel).toHaveBeenCalledWith(0.5);
    expect(el.querySelector('.mix-fader-val')!.textContent).toBe('50%');
  });

  it('mounts a VU meter and registers its handle via registerDisposable', () => {
    const registerDisposable = vi.fn();
    const el = buildMixerColumn('poly1', makeDeps({ registerDisposable }));
    expect(el.querySelector('.mix-vu-host')).not.toBeNull();
    expect(registerDisposable).toHaveBeenCalledTimes(1);
    expect(typeof registerDisposable.mock.calls[0][0].dispose).toBe('function');
  });
});
