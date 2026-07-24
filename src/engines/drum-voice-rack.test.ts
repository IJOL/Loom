// @vitest-environment jsdom
// Characterisation tests for the per-voice drum rack: column structure, the
// mute/solo toggles, the ▸advanced fold, and the optional sampler extras
// (select / audition / delete / add). Written against the imperative builder
// and kept green across the lit-html migration — the DOM contract (classes,
// titles, click behavior) is what the e2e suite and the SCSS rely on.
import { describe, it, expect, vi } from 'vitest';
import { renderDrumVoiceRack, type DrumRackOpts } from './drum-voice-rack';
import type { SynthEngine, EngineUIContext } from './engine-types';
import type { EngineParamSpec } from './engine-params';
import type { DrumVoice } from '../core/drums';

function stubEngine(params: EngineParamSpec[] = []) {
  const values = new Map(params.map((p) => [p.id, p.default] as const));
  const mutes = new Map<string, boolean>();
  const solos = new Map<string, boolean>();
  return {
    id: 'drums-machine', name: 'Drums', params,
    getBaseValue: (id: string) => values.get(id) ?? 0,
    setBaseValue: (id: string, v: number) => { values.set(id, v); },
    getDrumVoiceMute: (v: DrumVoice) => mutes.get(v) ?? false,
    setDrumVoiceMute: (v: DrumVoice, m: boolean) => { mutes.set(v, m); },
    getDrumVoiceSolo: (v: DrumVoice) => solos.get(v) ?? false,
    toggleDrumVoiceSolo: (v: DrumVoice) => { solos.set(v, !(solos.get(v) ?? false)); },
    getDrumVoiceMutes: () => Object.fromEntries(mutes),
    getRackLayout: () => ({ curatedSynth: ['tune'], curatedMixer: ['level'], advancedMixer: ['pan'] }),
  } as unknown as SynthEngine;
}

function ctx(): EngineUIContext {
  const reg = new Map<string, unknown>();
  return {
    laneId: 'L',
    registerKnob: (k: { meta?: { id?: string } }) => reg.set(k.meta?.id ?? String(reg.size), k),
    registry: reg,
  } as unknown as EngineUIContext;
}

const mount = (engine = stubEngine(), voices = ['kick', 'snare'], opts: DrumRackOpts = {}) => {
  const host = document.createElement('div');
  renderDrumVoiceRack(engine, ctx(), host, voices, opts);
  return host;
};

describe('renderDrumVoiceRack — structure', () => {
  it('appends one .drum-voice-rack with a .dv-col per voice (class + data-voice + label)', () => {
    const host = mount();
    const rack = host.querySelector('.drum-voice-rack')!;
    expect(rack).toBeTruthy();
    const cols = rack.querySelectorAll<HTMLElement>('.dv-col');
    expect(cols.length).toBe(2);
    expect(cols[0].classList.contains('kick')).toBe(true);
    expect(cols[0].dataset.voice).toBe('kick');
    expect(cols[0].querySelector('.dv-name')?.textContent).toBe('KICK');
    expect(cols[1].querySelector('.dv-name')?.textContent).toBe('SNARE');
  });

  it('splits params into curated synth/mix blocks and the advanced fold per the layout', () => {
    const cont = (id: string): EngineParamSpec => ({ id, label: id, kind: 'continuous', min: 0, max: 1, default: 0.5 });
    const host = mount(stubEngine([cont('kick.tune'), cont('kick.level'), cont('kick.pan'), cont('kick.decay')]), ['kick']);
    const col = host.querySelector('.dv-col.kick')!;
    expect(col.querySelectorAll('.dv-synth .knob').length).toBe(1);     // tune (curatedSynth)
    expect(col.querySelectorAll('.dv-mix .knob').length).toBe(1);       // level (curatedMixer)
    expect(col.querySelectorAll('.dv-advanced .knob').length).toBe(2);  // pan + decay (rest)
  });

  it('omits actions/key/add affordances when the opts are absent', () => {
    const host = mount();
    expect(host.querySelector('.dv-actions')).toBeNull();
    expect(host.querySelector('.dv-key')).toBeNull();
    expect(host.querySelector('.dv-add')).toBeNull();
  });
});

describe('renderDrumVoiceRack — mute/solo', () => {
  it('M toggles the engine mute and its own .on class', () => {
    const engine = stubEngine();
    const host = mount(engine);
    const mute = host.querySelector<HTMLButtonElement>('.dv-col.kick .dv-mute')!;
    expect(mute.title).toBe('Mute this voice');
    expect(mute.classList.contains('on')).toBe(false);
    mute.click();
    expect((engine as unknown as { getDrumVoiceMute(v: string): boolean }).getDrumVoiceMute('kick')).toBe(true);
    expect(mute.classList.contains('on')).toBe(true);
    mute.click();
    expect(mute.classList.contains('on')).toBe(false);
  });

  it('S toggles the engine solo and its own .on class', () => {
    const engine = stubEngine();
    const host = mount(engine);
    const solo = host.querySelector<HTMLButtonElement>('.dv-col.snare .dv-solo')!;
    solo.click();
    expect((engine as unknown as { getDrumVoiceSolo(v: string): boolean }).getDrumVoiceSolo('snare')).toBe(true);
    expect(solo.classList.contains('on')).toBe(true);
  });
});

describe('renderDrumVoiceRack — advanced fold', () => {
  it('▸ adv opens the advanced block and flips the arrow', () => {
    const host = mount();
    const toggle = host.querySelector<HTMLButtonElement>('.dv-col.kick .dv-adv-toggle')!;
    const adv = host.querySelector('.dv-col.kick .dv-advanced')!;
    expect(toggle.textContent).toBe('▸ adv');
    toggle.click();
    expect(adv.classList.contains('open')).toBe(true);
    expect(toggle.textContent).toBe('▾ adv');
    toggle.click();
    expect(adv.classList.contains('open')).toBe(false);
    expect(toggle.textContent).toBe('▸ adv');
  });
});

describe('renderDrumVoiceRack — sampler extras', () => {
  it('header click selects the column (exclusively) and fires onSelect', () => {
    const onSelect = vi.fn();
    const host = mount(stubEngine(), ['kick', 'snare'], { onSelect, isSelected: (v) => v === 'kick' });
    const cols = host.querySelectorAll<HTMLElement>('.dv-col');
    expect(cols[0].classList.contains('selected')).toBe(true);   // initial isSelected
    const head = cols[1].querySelector<HTMLElement>('.dv-head')!;
    expect(head.classList.contains('dv-head-sel')).toBe(true);
    head.click();
    expect(onSelect).toHaveBeenCalledWith('snare');
    expect(cols[1].classList.contains('selected')).toBe(true);
    expect(cols[0].classList.contains('selected')).toBe(false);  // exclusive
  });

  it('▶ auditions without selecting; ✕ deletes; ＋ adds', () => {
    const onSelect = vi.fn(); const onAudition = vi.fn(); const onDelete = vi.fn(); const onAdd = vi.fn();
    const host = mount(stubEngine(), ['kick'], { onSelect, onAudition, onDelete, onAdd, keyOf: (v) => v.toUpperCase() });
    expect(host.querySelector('.dv-key')?.textContent).toBe('KICK');
    const play = host.querySelector<HTMLButtonElement>('.dv-play')!;
    expect(play.title).toBe('Play this sample');
    play.click();
    expect(onAudition).toHaveBeenCalledWith('kick');
    expect(onSelect).not.toHaveBeenCalled();                     // button click ≠ header select
    host.querySelector<HTMLButtonElement>('.dv-del')!.click();
    expect(onDelete).toHaveBeenCalledWith('kick');
    const add = host.querySelector<HTMLButtonElement>('.dv-add')!;
    expect(add.title).toBe('Add a pad');
    add.click();
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});
