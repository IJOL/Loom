import { describe, it, expect, vi } from 'vitest';
import { buildSessionCallbacks } from './session-host-callbacks';
import type { SessionState } from './session';

function makeSelf() {
  const state: SessionState = {
    lanes: [{ id: 'bass', engineId: 'tb303', name: 'BASS', clips: [] }],
    scenes: [{ id: 's0', name: 'Intro', clipPerLane: {} }],
    globalQuantize: '1/1',
  };
  const renderWithMixer = vi.fn();
  // buildSessionCallbacks only destructures these four from deps at the top and,
  // for the rename handlers, reads self.state / self.deps.historyDeps /
  // self.renderWithMixer — so a minimal fake suffices.
  const self = {
    deps: { ctx: {}, seq: {}, playBtn: null, resetAutomationPosition: () => {}, historyDeps: undefined },
    state,
    laneStates: new Map(),
    renderWithMixer,
  } as unknown as import('./session-host').SessionHost;
  return { self, state, renderWithMixer };
}

describe('rename callbacks', () => {
  it('onRenameScene sets the scene name and re-renders', () => {
    const { self, state, renderWithMixer } = makeSelf();
    buildSessionCallbacks(self).onRenameScene!(0, 'Drop');
    expect(state.scenes[0].name).toBe('Drop');
    expect(renderWithMixer).toHaveBeenCalled();
  });

  it('onRenameLane sets the lane name and re-renders', () => {
    const { self, state, renderWithMixer } = makeSelf();
    buildSessionCallbacks(self).onRenameLane!('bass', 'Reese');
    expect(state.lanes[0].name).toBe('Reese');
    expect(renderWithMixer).toHaveBeenCalled();
  });

  it('an empty name clears back to undefined', () => {
    const { self, state } = makeSelf();
    buildSessionCallbacks(self).onRenameLane!('bass', '');
    expect(state.lanes[0].name).toBeUndefined();
  });

  it('an empty scene name clears back to undefined', () => {
    const { self, state } = makeSelf();
    buildSessionCallbacks(self).onRenameScene!(0, '');
    expect(state.scenes[0].name).toBeUndefined();
  });
});
