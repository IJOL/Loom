// Global transport hotkeys: Space = play/pause, R = Rec toggle. A keydown source
// like the computer keyboard — node-safe (types events as Event, target defaults
// to window), testable via an injected target. Space/R aren't musical keys, so
// they never collide with the live computer keyboard (midiForKey returns null).
export interface TransportHotkeyDeps {
  isTextTarget: (t: EventTarget | null) => boolean;
  onTogglePlay: () => void;
  onToggleRec: () => void;
  target?: EventTarget;
}

export function attachTransportHotkeys(deps: TransportHotkeyDeps): () => void {
  const target = deps.target ?? window;
  const onKeyDown = (e: Event) => {
    const ke = e as unknown as {
      key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean;
      target: EventTarget | null; preventDefault(): void;
    };
    if (ke.ctrlKey || ke.metaKey || ke.altKey) return;   // editing shortcuts win
    if (deps.isTextTarget(ke.target)) return;             // never steal text typing
    const k = ke.key.toLowerCase();
    if (k === ' ' || ke.key === 'Spacebar') {
      ke.preventDefault();                                // no page scroll / button click
      deps.onTogglePlay();
    } else if (k === 'r') {
      deps.onToggleRec();
    }
  };
  target.addEventListener('keydown', onKeyDown);
  return () => target.removeEventListener('keydown', onKeyDown);
}
