// Computer keyboard as a live MIDI-style instrument. When enabled (the global
// ⌨ Keys toggle), musical keys play the ACTIVE lane via the facade — the same
// path a hardware MIDI keydown takes — so chord note-FX and ● Rec loop-record
// apply. No clip mutation, no DSP. z/x shift the octave. Fixed velocity.
import { midiForKey, clampOctaveBase } from '../core/piano-roll-editing';
import { isTextEditTarget } from '../save/history-wiring';
import { DEFAULT_VELOCITY } from '../core/velocity-gain';
import type { LoomControlFacade } from './controller-profile';

export interface ComputerKeyboardDeps {
  facade: Pick<LoomControlFacade, 'playLiveNote' | 'releaseLiveNote'>;
  getActiveLane: () => string | null;
  isEnabled: () => boolean;
  target?: EventTarget;
  initialOctaveBase?: number;
  /** When a piano-roll editor is open, read its octave base so z/x step from —
   *  and live notes play at — the octave you SEE. Returns null when no editor is
   *  open (then our own module-local base is used). Connects the keyboard octave
   *  to the editor's octave display (a single shared octave). */
  getOctaveBase?: () => number | null;
  /** Push the new octave to the open editor's display when z/x shift it. */
  onOctaveChange?: (base: number) => void;
}

const MIN_OCTAVE_BASE = 24; // C1
const MAX_OCTAVE_BASE = 96; // clampOctaveBase caps the effective base at maxMidi-12 = 84 (C6)

export function attachComputerKeyboard(deps: ComputerKeyboardDeps): () => void {
  // Default to `window`: it receives keydown/keyup via bubbling AND the `blur`
  // (focus-loss) event we use to release held notes. Tests inject a bare
  // EventTarget, so `window` (undefined under the node test env) is never touched.
  const target = deps.target ?? window;
  let octaveBase = deps.initialOctaveBase ?? 60; // C4
  // physical key (lowercased) → the note we triggered, so keyup releases exactly
  // what keydown played even if the octave/active-lane changed meanwhile.
  const held = new Map<string, { laneId: string; midi: number }>();

  // Release every held note and forget them. Called on window blur / focus loss:
  // otherwise a key held while Alt-Tabbing never gets its keyup, leaving a note
  // sounding AND a stale `held` entry that blocks the key from ever retriggering.
  const releaseAll = () => {
    for (const h of held.values()) deps.facade.releaseLiveNote(h.laneId, h.midi);
    held.clear();
  };

  const onKeyDown = (e: Event) => {
    const ke = e as unknown as { key: string; repeat: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; target: EventTarget | null; preventDefault(): void };
    if (ke.ctrlKey || ke.metaKey || ke.altKey) return; // editing shortcuts win
    // HTMLElement doesn't exist under the node test env; isTextEditTarget only
    // matters in the browser, where the guard is a no-op (HTMLElement exists).
    if (typeof HTMLElement !== 'undefined' && isTextEditTarget(ke.target)) return;
    if (!deps.isEnabled()) return;
    const k = ke.key.toLowerCase();
    // When a piano-roll editor is open, step from and play at the octave shown
    // there (one shared octave); otherwise use our own module-local base.
    const effectiveBase = deps.getOctaveBase?.() ?? octaveBase;
    if (k === 'z' || k === 'x') {
      octaveBase = clampOctaveBase(effectiveBase + (k === 'x' ? 12 : -12), MIN_OCTAVE_BASE, MAX_OCTAVE_BASE);
      deps.onOctaveChange?.(octaveBase);
      ke.preventDefault();
      return;
    }
    const midi = midiForKey(k, effectiveBase);
    if (midi === null) return; // non-note key → leave it for other handlers
    ke.preventDefault();
    if (ke.repeat || held.has(k)) return; // no auto-repeat retrigger
    const laneId = deps.getActiveLane();
    if (!laneId) return;
    held.set(k, { laneId, midi });
    deps.facade.playLiveNote(laneId, midi, DEFAULT_VELOCITY);
  };

  const onKeyUp = (e: Event) => {
    const ke = e as unknown as { key: string };
    const k = ke.key.toLowerCase();
    const h = held.get(k);
    if (!h) return; // release regardless of the enable flag now
    held.delete(k);
    deps.facade.releaseLiveNote(h.laneId, h.midi);
  };

  const onBlur = () => releaseAll();

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  target.addEventListener('blur', onBlur);
  return () => {
    target.removeEventListener('keydown', onKeyDown);
    target.removeEventListener('keyup', onKeyUp);
    target.removeEventListener('blur', onBlur);
  };
}
