// Preferences that belong to this MACHINE, not to the project.
//
// The distinction is the whole reason this file exists rather than another field
// in the session: a project travels — it is saved, loaded, shared — and loading
// someone else's session must not turn your autosave on, any more than it should
// change your master volume. So these live in localStorage and are never written
// into a save file.
//
// Read through `appPrefs()` every time rather than cached: a second tab writing
// localStorage is the ordinary case, not an exotic one.

const KEY = 'loom-app-prefs-v1';

export interface AppPrefs {
  /** Write the recovery copy automatically as you work.
   *
   *  OFF by default, deliberately. Loom's autosave overwrites ONE slot, so an
   *  autosave that ran without being asked would quietly replace the recovery
   *  point a user might be relying on — and the moment you most want that
   *  recovery point is the moment after you did something you regret. Opting in
   *  is the user saying they would rather have the newest state than the last
   *  known-good one. */
  autosave: boolean;
  /** Arrange-view zoom (px per bar). View state is machine-local — a shared
   *  project must not carry someone else's zoom. */
  arrangePxPerBar: number;
  /** Arrange-view horizontal scroll (px). Same reasoning. */
  arrangeScrollLeft: number;
}

export const DEFAULT_APP_PREFS: AppPrefs = {
  autosave: false, arrangePxPerBar: 80, arrangeScrollLeft: 0,
};

export function appPrefs(): AppPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_APP_PREFS };
    const parsed = JSON.parse(raw) as Partial<AppPrefs>;
    return {
      // Field by field, so a stored blob from an older or newer build cannot
      // hand back `undefined` for a flag the code then treats as false-ish by
      // accident. Anything that is not a boolean falls back to the default.
      autosave: typeof parsed.autosave === 'boolean' ? parsed.autosave : DEFAULT_APP_PREFS.autosave,
      arrangePxPerBar: typeof parsed.arrangePxPerBar === 'number' && parsed.arrangePxPerBar >= 16
        ? parsed.arrangePxPerBar : DEFAULT_APP_PREFS.arrangePxPerBar,
      arrangeScrollLeft: typeof parsed.arrangeScrollLeft === 'number' && parsed.arrangeScrollLeft >= 0
        ? parsed.arrangeScrollLeft : DEFAULT_APP_PREFS.arrangeScrollLeft,
    };
  } catch {
    // Private browsing, a full quota, a corrupt value: a preference is never
    // worth failing a boot over.
    return { ...DEFAULT_APP_PREFS };
  }
}

export function setAppPrefs(patch: Partial<AppPrefs>): AppPrefs {
  const next = { ...appPrefs(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Same reasoning: the setting simply does not stick, and the app carries on
    // with it applied for this session.
  }
  return next;
}
