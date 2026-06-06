// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { buildMasterStrip, type MasterStripDeps } from './master-strip';

// A minimal AnalyserNode stand-in. createLevelMeter only reads `fftSize`
// (to size its buffer) and calls `getFloatTimeDomainData` from its RAF loop;
// neither needs a real audio graph for these structural assertions.
function fakeAnalyser(): AnalyserNode {
  return {
    fftSize: 512,
    getFloatTimeDomainData() {},
  } as unknown as AnalyserNode;
}

function makeVolInput(value = '0.5'): HTMLInputElement {
  const el = document.createElement('input');
  el.type = 'range';
  el.min = '0';
  el.max = '1';
  el.step = '0.01';
  el.value = value;
  return el;
}

function makeDeps(over: Partial<MasterStripDeps> = {}): MasterStripDeps {
  return {
    volInput: makeVolInput(),
    masterMeterAnalyser: fakeAnalyser(),
    isFxOpen: () => false,
    onToggleFx: () => {},
    ...over,
  };
}

describe('buildMasterStrip', () => {
  it('returns an HTMLElement with classes mix-col master-strip', () => {
    const el = buildMasterStrip(makeDeps());
    expect(el).toBeInstanceOf(HTMLElement);
    expect(el.classList.contains('mix-col')).toBe(true);
    expect(el.classList.contains('master-strip')).toBe(true);
  });

  it('contains a .mix-name reading MASTER', () => {
    const el = buildMasterStrip(makeDeps());
    const name = el.querySelector('.mix-name');
    expect(name).not.toBeNull();
    expect(name!.textContent).toBe('MASTER');
  });

  it('fader range is 0..1', () => {
    const el = buildMasterStrip(makeDeps());
    const fader = el.querySelector('input[type="range"]') as HTMLInputElement;
    expect(fader).not.toBeNull();
    expect(fader.min).toBe('0');
    expect(fader.max).toBe('1');
  });

  it('proxies volInput: writing the fader sets volInput.value and dispatches its input event', () => {
    const volInput = makeVolInput('0.2');
    const spy = vi.fn();
    volInput.addEventListener('input', spy);
    const el = buildMasterStrip(makeDeps({ volInput }));
    const fader = el.querySelector('input[type="range"]') as HTMLInputElement;

    fader.value = '0.5';
    fader.dispatchEvent(new Event('input'));

    expect(volInput.value).toBe('0.5');
    expect(spy).toHaveBeenCalled();
  });

  it('FX button invokes onToggleFx on click', () => {
    const onToggleFx = vi.fn();
    const el = buildMasterStrip(makeDeps({ onToggleFx }));
    const btn = el.querySelector('.master-fx-toggle') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    btn.click();
    expect(onToggleFx).toHaveBeenCalledTimes(1);
  });

  it('reflects isFxOpen() in the FX button .active class — true', () => {
    const el = buildMasterStrip(makeDeps({ isFxOpen: () => true }));
    const btn = el.querySelector('.master-fx-toggle') as HTMLButtonElement;
    expect(btn.classList.contains('active')).toBe(true);
  });

  it('reflects isFxOpen() in the FX button .active class — false', () => {
    const el = buildMasterStrip(makeDeps({ isFxOpen: () => false }));
    const btn = el.querySelector('.master-fx-toggle') as HTMLButtonElement;
    expect(btn.classList.contains('active')).toBe(false);
  });

  it('registers the VU meter handle via registerDisposable', () => {
    const registerDisposable = vi.fn();
    buildMasterStrip(makeDeps({ registerDisposable }));
    expect(registerDisposable).toHaveBeenCalled();
    const arg = registerDisposable.mock.calls[0][0];
    expect(typeof arg.dispose).toBe('function');
  });
});
