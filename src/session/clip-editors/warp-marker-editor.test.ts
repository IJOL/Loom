// @vitest-environment jsdom
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

const markers: WarpMarker[] = [
  { srcSec: 0, beat: 0 }, { srcSec: 8, beat: 32 }, { srcSec: 16, beat: 64 },
];

describe('mountWarpMarkerEditor', () => {
  it('renders one handle per marker', () => {
    const host = makeHost();
    mountWarpMarkerEditor(host, {
      getMarkers: () => markers, durationSec: 16, meter: DEFAULT_METER, bpm: 120,
      clipBars: 16, barsPerMarker: 4, getOnsets: () => [], onMarkersChange: vi.fn(),
    });
    expect(host.querySelectorAll('.warp-marker').length).toBe(3);
  });

  it('right-click on an interior marker deletes it via onMarkersChange', () => {
    const host = makeHost();
    const onChange = vi.fn();
    mountWarpMarkerEditor(host, {
      getMarkers: () => markers, durationSec: 16, meter: DEFAULT_METER, bpm: 120,
      clipBars: 16, barsPerMarker: 4, getOnsets: () => [], onMarkersChange: onChange,
    });
    const interior = host.querySelectorAll('.warp-marker')[1] as HTMLElement;
    interior.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toHaveLength(2); // marker removed
  });

  it('changing density re-seeds and reports the new marker set', () => {
    const host = makeHost();
    const onChange = vi.fn();
    mountWarpMarkerEditor(host, {
      getMarkers: () => markers, durationSec: 16, meter: DEFAULT_METER, bpm: 120,
      clipBars: 16, barsPerMarker: 4,
      getOnsets: () => Array.from({ length: 65 }, (_, i) => i * 0.25), // 64 beats @0.25s
      onMarkersChange: onChange,
    });
    const sel = host.querySelector('.warp-density') as HTMLSelectElement;
    sel.value = '1'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onChange).toHaveBeenCalled();
    // 1 marker/bar over 16 bars → endpoints included, more markers than the 4-bar set
    expect(onChange.mock.calls.at(-1)![0].length).toBeGreaterThan(3);
  });
});
