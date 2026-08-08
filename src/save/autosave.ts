// The autosave loop: opt-in, debounced, and writing only the recovery slot.
//
// Everything here is about NOT doing it too often. Building the state means
// serialising the whole session, and the events worth reacting to arrive in
// bursts — a drag ends, a knob settles, a weave fader stops. So a request only
// arms a timer, and a request while one is armed replaces it. The user pays for
// one write per quiet moment rather than one per event.
//
// It writes the recovery copy ALONE. An autosave that also created a named entry
// would fill the save list with a row every few seconds.

export interface AutosaveDeps {
  /** Whether the user asked for this. Read at fire time, not captured, so
   *  switching it off mid-timer means the pending write simply does not happen
   *  rather than needing to be cancelled from the settings UI. */
  enabled: () => boolean;
  /** The full state, including everything save/load persists — the weave and the
   *  Performance take included. Built at FIRE time: building it per request
   *  would serialise the session on every keystroke and throw it away. */
  buildState: () => unknown;
  write: (state: unknown) => Promise<void>;
  /** Reported rather than thrown: an autosave that cannot land is worth knowing
   *  about, and it must not take down whatever triggered it. */
  onError?: (err: unknown) => void;
  /** How long the app has to go quiet before a write. */
  delayMs?: number;
}

export interface Autosave {
  /** Something changed. Cheap, and safe to call on every event. */
  request(): void;
  /** Write now if enabled, skipping the wait. For the seams that know the moment
   *  matters — a session being replaced, a tab going away. */
  flush(): Promise<void>;
  /** Drop a pending write. */
  cancel(): void;
}

/** Long enough that a burst of edits collapses into one write, short enough that
 *  a crash costs seconds of work rather than minutes. */
const DEFAULT_DELAY_MS = 4000;

export function createAutosave(deps: AutosaveDeps): Autosave {
  const delay = deps.delayMs ?? DEFAULT_DELAY_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Guards the overlap: an autosave is async, and a second one starting while
  // the first is still writing would race for the one slot they share.
  let writing = false;
  let again = false;

  const run = async (): Promise<void> => {
    if (!deps.enabled()) return;
    if (writing) { again = true; return; }
    writing = true;
    try {
      await deps.write(deps.buildState());
    } catch (err) {
      deps.onError?.(err);
    } finally {
      writing = false;
      // Something asked while we were busy: honour it, so the recovery copy
      // ends up holding the LATEST state rather than the one mid-write.
      if (again) { again = false; void run(); }
    }
  };

  const cancel = () => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
  };

  return {
    request() {
      // Checked here too, so a disabled autosave costs one boolean per event
      // instead of arming a timer that will decline to fire.
      if (!deps.enabled()) return;
      cancel();
      timer = setTimeout(() => { timer = null; void run(); }, delay);
    },
    flush() {
      cancel();
      return run();
    },
    cancel,
  };
}
