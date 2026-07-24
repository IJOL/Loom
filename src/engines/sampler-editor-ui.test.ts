// @vitest-environment jsdom
// Characterisation tests for the Sampler lane editor DOM (buildParamUI +
// keyboard map + sample viewer), added with the lit-html migration. They pin
// the structure the e2e suite and the SCSS query (classes, headings, hidden
// pickers) and the main interactions (pad badge toggle, zoom, zone-range edit,
// import buttons clicking the hidden file inputs).
import { describe, it, expect, vi } from 'vitest';
import type { EngineUIContext } from './engine-types';
import type { KeymapEntry } from '../samples/types';

vi.mock('../audio-worklet/sampler-node', () => ({
  loadSamplerWorklet: vi.fn().mockResolvedValue(undefined),
  SamplerWorkletNode: class {
    loadSample() {}
    hasSample() { return false; }
    spawn() {}
    silenceAll() {}
    connectDry() {}
    connectSend() {}
    disconnect() {}
    dispose() {}
  },
}));

import { SamplerWorkletEngine } from './sampler-worklet-engine';

const drumkit = (): KeymapEntry[] => [
  { sampleId: 'ui-kick', rootNote: 36, loNote: 36, hiNote: 36 },
  { sampleId: 'ui-ch', rootNote: 42, loNote: 42, hiNote: 42 },
  { sampleId: 'ui-oh', rootNote: 46, loNote: 46, hiNote: 46 },
];

const uiCtx = (registered: string[] = [], sessionState?: unknown): EngineUIContext => ({
  laneId: 'sampler-1',
  registerKnob: (k: { meta?: { id?: string } }) => { if (k.meta?.id) registered.push(k.meta.id); },
  registry: new Map(),
  lookupLaneDisplayName: () => undefined,
  sessionState,
} as unknown as EngineUIContext);

function build(keymap: KeymapEntry[], registered: string[] = [], sessionState?: unknown): HTMLElement {
  const eng = new SamplerWorkletEngine();
  eng.setKeymap(keymap);
  const container = document.createElement('div');
  eng.buildParamUI(container, uiCtx(registered, sessionState));
  return container;
}

describe('sampler editor — empty keymap', () => {
  it('renders the Keymap heading, empty message, import controls and mod panel', () => {
    const c = build([]);
    expect(c.querySelector('.sampler-keymap .label')!.textContent).toBe('Keymap');
    expect(c.querySelector('.sampler-keymap-empty')!.textContent).toBe('No samples loaded yet.');
    expect(c.querySelector('.sampler-import-loop-btn')!.textContent).toBe('Import loop…');
    expect(c.querySelector('.sampler-import-btn')!.textContent).toBe('Import samples…');
    // Hidden pickers stay in the DOM (the buttons click them).
    expect(c.querySelector<HTMLElement>('.sampler-load-loop')!.style.display).toBe('none');
    expect(c.querySelector<HTMLElement>('.sampler-load')!.style.display).toBe('none');
    // The zone hint is visible only when there is no channel view.
    expect(c.querySelector<HTMLElement>('.sampler-import-hint')!.style.display).not.toBe('none');
    expect(c.querySelector('.mod-panel')).toBeTruthy();
    expect(c.querySelector('.sampler-keymap-viz')).toBeNull();
  });

  it('the import buttons click their hidden file inputs', () => {
    const c = build([]);
    const loopInput = c.querySelector<HTMLInputElement>('.sampler-load-loop')!;
    const fileInput = c.querySelector<HTMLInputElement>('.sampler-load')!;
    const loopClick = vi.spyOn(loopInput, 'click').mockImplementation(() => {});
    const fileClick = vi.spyOn(fileInput, 'click').mockImplementation(() => {});
    (c.querySelector('.sampler-import-loop-btn') as HTMLButtonElement).click();
    (c.querySelector('.sampler-import-btn') as HTMLButtonElement).click();
    expect(loopClick).toHaveBeenCalledTimes(1);
    expect(fileClick).toHaveBeenCalledTimes(1);
  });
});

describe('sampler editor — drumkit channel view', () => {
  it('renders keyboard map (tinted pads), connectors, rack and viewer', () => {
    const registered: string[] = [];
    const c = build(drumkit(), registered);
    expect(c.querySelector('.sampler-keymap .label')!.textContent).toBe('Load kit');
    expect(c.querySelectorAll('.sampler-keymap-viz .smk-key.pad')).toHaveLength(3);
    expect(c.querySelector('.smk-key[data-note="36"]')).toBeTruthy();
    expect(c.querySelector('.sampler-keyboard-conn canvas.smk-connectors')).toBeTruthy();
    expect(c.querySelector('.drum-voice-rack .dv-col[data-voice="zone36"]')).toBeTruthy();
    expect(c.querySelector('.sampler-viewer-label')!.textContent).toBe('Selected sample');
    expect(c.querySelector('.sampler-sample-viewer .ssv-wrap')).toBeTruthy();
    // The zone hint is hidden in channel view; the lane gain knob registered.
    expect(c.querySelector<HTMLElement>('.sampler-import-hint')!.style.display).toBe('none');
    expect(registered).toContain('sampler-1.gain');
  });

  it('badge click toggles the selected pad loop flag (one-shot ↔ loop)', () => {
    const eng = new SamplerWorkletEngine();
    eng.setKeymap(drumkit());
    const c = document.createElement('div');
    eng.buildParamUI(c, uiCtx());
    const badge = c.querySelector<HTMLElement>('.ssv-badge')!;
    expect(badge.textContent).toBe('one-shot');
    badge.click();
    expect(eng.getBaseValue('zone36.loop')).toBe(1);   // first pad is selected by default
    expect(badge.textContent).toBe('⟳ loop');
    expect(badge.classList.contains('loop')).toBe(true);
  });

  it('zoom in then out restores the zoom level label', () => {
    const c = build(drumkit());
    const zLvl = c.querySelector<HTMLElement>('.ssv-zlvl')!;
    const initial = zLvl.textContent;
    const [zoomOut, zoomIn] = [...c.querySelectorAll<HTMLButtonElement>('.ssv-zbtn')];
    zoomIn.click();
    expect(zLvl.textContent).not.toBe(initial);
    zoomOut.click();
    expect(zLvl.textContent).toBe(initial);
  });
});

describe('sampler editor — melodic view', () => {
  const melodic = (): KeymapEntry[] => [{ sampleId: 'ui-piano', rootNote: 60, loNote: 0, hiNote: 127 }];

  it('renders the zone band and the viewer root/lo/hi inputs', () => {
    const c = build(melodic());
    expect(c.querySelector('.sampler-keymap .label')!.textContent).toBe('Load instrument');
    const zone = c.querySelector<HTMLElement>('.smk-band .smk-zone')!;
    expect(zone.title).toContain('root C4');
    const nums = [...c.querySelectorAll<HTMLInputElement>('.ssv-zone .ssv-znum input')];
    expect(nums.map((i) => i.value)).toEqual(['60', '0', '127']);
  });

  it('committing a new root re-roots the zone through setEntryRoot', () => {
    const eng = new SamplerWorkletEngine();
    eng.setKeymap(melodic());
    const c = document.createElement('div');
    eng.buildParamUI(c, uiCtx());
    const root = c.querySelector<HTMLInputElement>('.ssv-zone .ssv-znum input')!;
    root.value = '62';
    root.dispatchEvent(new Event('change', { bubbles: true }));
    expect(eng.getKeymap()[0].rootNote).toBe(62);
  });
});

describe('sampler editor — loop view', () => {
  it('renders the loop overview canvas and the slice hint', () => {
    const sessionState = {
      lanes: [{ id: 'sampler-1', engineState: { sampler: { instrumentId: 'loop-x' } } }],
    };
    const c = build(drumkit(), [], sessionState);
    expect(c.querySelector('.sampler-loop-overview canvas.slo-canvas')).toBeTruthy();
    expect(c.querySelector('.sampler-loop-hint')!.textContent)
      .toBe("Loop: each note is a slice. The notes are edited in the clip's piano-roll.");
    expect(c.querySelector('.sampler-keymap .label')!.textContent).toBe('Keymap');
  });
});
