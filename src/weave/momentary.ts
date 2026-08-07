// Hold it and something happens; let go and it undoes itself.
//
// This is the primitive Loom did not have. Every performance gesture in the app
// is a state change — launch a clip, move a knob — and something has to put it
// back. The MC-707 puts Scatter and Step Loop on HELD buttons for exactly that
// reason: a momentary gesture needs no "return to previous" state machine, no
// undo entry and no memory of what the user meant, because the release IS the
// restore. See docs/research/2026-08-07-roland-mc-performance-modes.md §9.

export interface MomentaryTarget {
  id: string;
  /** Where the value goes while the gesture is held. */
  value: number;
}

export interface Momentary {
  /** Snapshot the current values and jump to the targets. */
  press(targets: MomentaryTarget[]): void;
  /** Put back exactly what was there before the press. */
  release(): void;
  /** True between a press and its release. */
  isHeld(): boolean;
}

export interface MomentaryDeps {
  read(id: string): number;
  write(id: string, value: number): void;
}

export function createMomentary(deps: MomentaryDeps): Momentary {
  let held: Map<string, number> | null = null;

  return {
    press(targets) {
      // A second press without a release would overwrite the snapshot with the
      // gesture's OWN values, and the release would restore the gesture rather
      // than what came before it — the control would slowly eat the patch.
      if (held) return;
      held = new Map(targets.map((t) => [t.id, deps.read(t.id)]));
      for (const t of targets) deps.write(t.id, t.value);
    },

    release() {
      if (!held) return;
      for (const [id, v] of held) deps.write(id, v);
      held = null;
    },

    isHeld() {
      return held !== null;
    },
  };
}
