// Session-global "computer-keyboard → notes" (musical typing) mode for the
// piano-roll editor. OPT-IN: OFF by default, so plain typing in the focused
// editor never inserts notes nor shows the green insertion cursor; a toolbar
// toggle turns it on. One flag, reset on reload — like the draw/select tool and
// Follow. (The user explicitly asked for this to be opt-in rather than always on.)

let _kbInputEnabled = false;

export function isKbInputEnabled(): boolean { return _kbInputEnabled; }
export function setKbInputEnabled(on: boolean): void { _kbInputEnabled = on; }
export function toggleKbInput(): boolean { _kbInputEnabled = !_kbInputEnabled; return _kbInputEnabled; }
