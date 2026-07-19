// @vitest-environment jsdom
// Task 9: the Performance "+ Automation" header reads its options from the
// shared DestinationRegistry instead of calling listAutomationTargets itself,
// and `destinations` is now REQUIRED (the old optional `sessionState` made an
// absent one render the picker silently empty).
import { describe, it, expect } from 'vitest';
import { buildAutomationHeader } from './performance-automation-ui';
import { createDestinationRegistry } from '../automation/destination-registry';
import type { SessionState } from '../session/session';
// Side-effect import: registers the 'subtractive' engine descriptor so
// listAutomationTargets() can find its continuous engine params. Without
// this, getEngine('subtractive') returns undefined and the picker would
// silently offer zero engine params — a false negative for this test.
import '../engines/subtractive';

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
      painterDeps: {} as never,
      onAdd: () => {}, onRemove: () => {}, onEdited: () => {},
    } as never);
    const values = [...header.querySelectorAll('option')].map((o) => (o as HTMLOptionElement).value);
    expect(values.some((v) => v.startsWith('poly1.'))).toBe(true);
  });
});
