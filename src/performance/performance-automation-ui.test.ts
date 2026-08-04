// @vitest-environment jsdom
// Task 9: the Performance "+ Automation" header reads its options from the
// shared DestinationRegistry instead of calling listAutomationTargets itself,
// and `destinations` is now REQUIRED (the old optional `sessionState` made an
// absent one render the picker silently empty).
import { describe, it, expect, vi } from 'vitest';
// The lane canvas is unreachable in jsdom (getContext is not implemented), so
// the painter is stubbed and the assertion is on what the lane ASKS it to draw.
vi.mock('../automation/automation-painter', () => ({
  drawLane: vi.fn(), attachLanePainter: vi.fn(), formatNum: (n: number) => String(n),
}));
import { buildAutomationHeader, buildAutomationLane } from './performance-automation-ui';
import { drawLane } from '../automation/automation-painter';
import { createDestinationRegistry } from '../automation/destination-registry';
import { DEFAULT_METER, type TimeSignature } from '../core/meter';
import type { SessionState } from '../session/session';
import { registerPluginEngine } from '../../test/plugin-fixtures';

// subtractive ships as a plugin: the equivalent of the old
// side-effect import is that manifest going through the same adoptComponents
// door the plugin loader uses.
registerPluginEngine('subtractive');
// Side-effect import: registers the 'subtractive' engine descriptor so
// listAutomationTargets() can find its continuous engine params. Without
// this, getEngine('subtractive') returns undefined and the picker would
// silently offer zero engine params — a false negative for this test.

describe('performance automation header', () => {
  it('lists destinations from the registry', () => {
    const state = {
      lanes: [{ id: 'poly1', name: 'Sub 1', engineId: 'subtractive', clips: [], inserts: [] }],
      masterInserts: [], sends: [],
    } as unknown as SessionState;
    const header = buildAutomationHeader({
      destinations: createDestinationRegistry({
        getState: () => state, getKnobRegistry: () => new Map(),
      }),
      laneWidthPx: 100, getBrush: () => 'line',
      onAdd: () => {}, onRemove: () => {}, onEdited: () => {},
    } as never);
    const values = [...header.querySelectorAll('option')].map((o) => (o as HTMLOptionElement).value);
    expect(values.some((v) => v.startsWith('poly1.'))).toBe(true);
  });
});

describe('performance automation lane', () => {
  // `meter` is REQUIRED on PerfAutoDeps and the builder has no 4/4 fallback, so
  // the 4/4 side of the comparison below has to be asked for by name. (The deps
  // are cast `as never` to keep these cases to the fields they exercise, which
  // means the compiler will not catch a missing meter here — leaving it out
  // throws inside ticksPerBar instead, which is the intended loud failure.)
  const gridFor = (meter: TimeSignature) => {
    vi.mocked(drawLane).mockClear();
    buildAutomationLane(
      { paramId: 'poly1.cutoff', values: [0.5, 0.5], enabled: true },
      { registry: new Map(), laneWidthPx: 100, getBrush: () => 'line', meter } as never,
    );
    return vi.mocked(drawLane).mock.calls[0][2];
  };

  it('draws its bar lines on the song meter, not on a 4/4 one', () => {
    // Relative: the curve is stored at one bar's worth of steps per bar, so the
    // grid drawn over it has to count the same steps or the lines drift off the
    // ruler above them.
    const three = gridFor({ num: 3, den: 4 });
    const four = gridFor(DEFAULT_METER);
    expect(three.stepsPerBar / four.stepsPerBar).toBeCloseTo(3 / 4, 6);
    expect(three.stepsPerBeat).toBe(four.stepsPerBeat); // same beat unit (/4)
  });
});
