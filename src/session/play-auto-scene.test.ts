// Pressing the global ▶ with nothing launched should sound something — the
// first scene. But it must NOT fight the two other ways audio starts: launching
// a scene, or launching a clip, both of which also start the transport. Those
// already have a scene active (or a lane playing), so the guard below leaves
// them alone. This is the pure decision; the host wires it into seq.onStart.

import { describe, it, expect } from 'vitest';
import { sceneToAutoLaunchOnPlay } from './session-host-util';

describe('sceneToAutoLaunchOnPlay', () => {
  it('launches scene 0 when the transport starts with nothing playing', () => {
    // activeSceneIdx -1 (none launched), no lane playing, 3 scenes exist.
    expect(sceneToAutoLaunchOnPlay(-1, false, 3)).toBe(0);
  });

  it('does nothing when a scene is already active (a resume / scene launch)', () => {
    expect(sceneToAutoLaunchOnPlay(2, false, 3)).toBeNull();
  });

  it('does nothing when a lane is already playing (a clip launch started it)', () => {
    // launchClipAt sets a lane queued/playing and starts the transport; the
    // scene index is still -1 there, so the lane flag is what stops a double.
    expect(sceneToAutoLaunchOnPlay(-1, true, 3)).toBeNull();
  });

  it('does nothing in an empty session — there is no scene to launch', () => {
    expect(sceneToAutoLaunchOnPlay(-1, false, 0)).toBeNull();
  });
});
