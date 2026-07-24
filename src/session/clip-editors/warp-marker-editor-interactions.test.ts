// @vitest-environment jsdom
// Characterisation for the interactions the lit-html migration rewired to
// template bindings and which the pre-existing warp-marker-editor.test.ts does
// not cover: redraw() patching, marker drag, and click-to-add on the layer.
// (Render structure, right-click delete and density re-seed live in
// warp-marker-editor.test.ts.)
import { describe, it, expect, vi } from 'vitest';
import { mountWarpMarkerEditor } from './warp-marker-editor';
import { DEFAULT_METER } from '../../core/meter';
import type { WarpMarker } from '../session';

function makeHost(): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: 800, configurable: true });
  document.body.appendChild(el);
  return el;
}

const base = (): WarpMarker[] => [
  { srcSec: 0, beat: 0 }, { srcSec: 8, beat: 32 }, { srcSec: 16, beat: 64 },
];

function mount(host: HTMLElement, markers: () => WarpMarker[]) {
  const onChange = vi.fn();
  const handle = mountWarpMarkerEditor(host, {
    getMarkers: markers, durationSec: 16, downbeatSec: 0, meter: DEFAULT_METER, bpm: 120,
    clipBars: 16, barsPerMarker: 4, getOnsets: () => [], onMarkersChange: onChange,
  });
  return { handle, onChange };
}

describe('warp marker editor interactions', () => {
  it('redraw() patches the overlay to the current marker set', () => {
    const host = makeHost();
    let markers = base();
    const { handle } = mount(host, () => markers);
    expect(host.querySelectorAll('.warp-marker').length).toBe(3);
    markers = [...base(), { srcSec: 12, beat: 48 }].sort((a, b) => a.srcSec - b.srcSec);
    handle.redraw();
    expect(host.querySelectorAll('.warp-marker').length).toBe(4);
    expect(host.querySelector('.warp-count')!.textContent).toContain('4 markers');
  });

  it('dragging an interior marker reports the moved srcSec, beat untouched', () => {
    const host = makeHost();
    const { onChange } = mount(host, base);
    const mk = host.querySelectorAll('.warp-marker')[1] as HTMLElement;
    // jsdom has no PointerEvent; the listeners only need type + clientX.
    mk.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 400 }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 300 }));
    window.dispatchEvent(new MouseEvent('pointerup', {}));
    expect(onChange).toHaveBeenCalled();
    const moved = onChange.mock.calls.at(-1)![0] as WarpMarker[];
    expect(moved[1].srcSec).toBeCloseTo(6, 5);  // 300px of 800 → 6s of 16
    expect(moved[1].beat).toBe(32);             // drag moves source time only
  });

  it('pointerdown on empty layer adds a marker at the clicked source time', () => {
    const host = makeHost();
    const { onChange } = mount(host, base);
    const layer = host.querySelector('.warp-layer') as HTMLElement;
    layer.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 200 }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as WarpMarker[];
    expect(next).toHaveLength(4);
    expect(next.map((m) => m.srcSec)).toContain(4); // 200px of 800 → 4s of 16
  });

  it('a drag on a marker does NOT also add a marker through the layer handler', () => {
    const host = makeHost();
    const { onChange } = mount(host, base);
    const mk = host.querySelectorAll('.warp-marker')[1] as HTMLElement;
    mk.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 400 }));
    // No move yet: nothing may have been reported (the old add-on-drag bubble
    // would have fired onMarkersChange immediately).
    expect(onChange).not.toHaveBeenCalled();
    window.dispatchEvent(new MouseEvent('pointerup', {}));
  });
});
