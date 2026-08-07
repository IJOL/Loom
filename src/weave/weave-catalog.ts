// The six macros, as data.
//
// Each carries the value at which it does NOTHING. With all six at their
// neutral the live layer is the identity: what you hear is exactly the material
// that is there. That property is what makes the whole panel non-destructive by
// default, and every macro implementation is tested against it as a negative
// control.

export interface MacroSpec {
  id: string;
  label: string;
  /** The value at which this macro changes nothing. */
  neutral: number;
  color: string;
}

export const WEAVE_MACROS: readonly MacroSpec[] = [
  // Bipolar: these three cut as readily as they add, so doing nothing is the
  // middle of the range.
  { id: 'density', label: 'Density', neutral: 0.5, color: 'var(--knob-cyan)' },
  { id: 'energy', label: 'Energy', neutral: 0.5, color: 'var(--knob-yellow)' },
  { id: 'darkness', label: 'Darkness', neutral: 0.5, color: 'var(--knob-purple)' },
  // Additive: these three only ever add, so doing nothing is the floor.
  { id: 'space', label: 'Space', neutral: 0, color: 'var(--knob-blue)' },
  { id: 'motion', label: 'Motion', neutral: 0, color: 'var(--knob-orange)' },
  { id: 'styleMix', label: 'Style mix', neutral: 0, color: 'var(--knob-red)' },
] as const;

export const WEAVE_SCOPE = 'session.weave';

/** A destination id with an EXPLICIT marker.
 *
 *  parseAutomationParamId splits on dots and falls back to "engine param of a
 *  lane" whenever it finds no marker, so a bare `weave.density` would read as
 *  the `density` param of a lane called `weave` — a lane that does not exist.
 *  It would not throw. It would sit inert, which looks exactly like working,
 *  and that is the worst failure mode available here. */
export function macroDestinationId(id: string): string {
  return `${WEAVE_SCOPE}:${id}`;
}

/** The do-nothing value for a macro. Falls back to 0 for an unknown id: a save
 *  from a later version could name a macro this build has never heard of, and
 *  reading undefined out of the table would poison the arithmetic downstream
 *  with NaN. */
export function macroNeutral(id: string): number {
  return WEAVE_MACROS.find((m) => m.id === id)?.neutral ?? 0;
}
