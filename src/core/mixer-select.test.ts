// @vitest-environment jsdom
//
// Clicking a mixer column's dead zone selects its lane; clicking a live control
// does only that control's job. The user chose the conservative rule so that
// moving a fader never pulls them out of the clip they are editing.

import { describe, it, expect, vi } from 'vitest';
import { buildMixerColumn, type MixerColumnDeps } from './mixer';
import type { ChannelStrip } from './fx';

// Same fakes mixer.test.ts uses: createLevelMeter only reads fftSize and calls
// getFloatTimeDomainData from its RAF loop.
function fakeAnalyser(): AnalyserNode {
  return { fftSize: 512, getFloatTimeDomainData() {} } as unknown as AnalyserNode;
}

function fakeStrip(): ChannelStrip {
  return {
    serialize: () => ({ eqHigh: 0, eqMid: 0, eqLow: 0, sendA: 0, sendB: 0, pan: 0, level: 0.8 }),
    getMeterAnalyser: () => fakeAnalyser(),
    setLevel: () => {}, setEqHigh: () => {}, setEqMid: () => {}, setEqLow: () => {},
    setSendA: () => {}, setSendB: () => {}, setPan: () => {},
  } as unknown as ChannelStrip;
}

function makeDeps(over: Partial<MixerColumnDeps> = {}): MixerColumnDeps {
  return {
    stripFor: () => fakeStrip(),
    label: (id) => id,
    muteState: {},
    soloState: {},
    applyMuteSolo: () => {},
    registerKnob: () => {},
    ...over,
  };
}

describe('mixer column selection', () => {
  it('selects the lane when the dead zone is clicked', () => {
    const onSelect = vi.fn();
    const col = buildMixerColumn('tb-303-1', makeDeps({ onSelect }));
    document.body.appendChild(col);

    (col.querySelector('.mix-name') as HTMLElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }));

    expect(onSelect).toHaveBeenCalledWith('tb-303-1');
  });

  it('does not select when the mute button is clicked', () => {
    const onSelect = vi.fn();
    const applyMuteSolo = vi.fn();
    const col = buildMixerColumn('tb-303-1', makeDeps({ onSelect, applyMuteSolo }));
    document.body.appendChild(col);

    (col.querySelector('.mix-btn.mute') as HTMLElement).click();

    expect(applyMuteSolo, 'mute still does its own job').toHaveBeenCalled();
    expect(onSelect, 'but the lane is not selected').not.toHaveBeenCalled();
  });

  it('does not select when the fader is clicked', () => {
    const onSelect = vi.fn();
    const col = buildMixerColumn('tb-303-1', makeDeps({ onSelect }));
    document.body.appendChild(col);

    (col.querySelector('.mix-fader') as HTMLElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }));

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('builds a working column when no onSelect is supplied', () => {
    const col = buildMixerColumn('tb-303-1', makeDeps());
    document.body.appendChild(col);
    expect(() => (col.querySelector('.mix-name') as HTMLElement)
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))).not.toThrow();
  });
});
