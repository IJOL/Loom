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
}

const MIN_OCTAVE_BASE = 24; // C1
const MAX_OCTAVE_BASE = 96; // C7 (clampOctaveBase keeps an octave of headroom)

export function attachComputerKeyboard(deps: ComputerKeyboardDeps): () => void {
  const target = deps.target ?? document;
  let octaveBase = deps.initialOctaveBase ?? 60; // C4
  // physical key (lowercased) → the note we triggered, so keyup releases exactly
  // what keydown played even if the octave/active-lane changed meanwhile.
  const held = new Map<string, { laneId: string; midi: number }>();

  const onKeyDown = (e: Event) => {
    const ke = e as unknown as { key: string; repeat: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; target: EventTarget | null; preventDefault(): void };
    if (ke.ctrlKey || ke.metaKey || ke.altKey) return; // editing shortcuts win
    // HTMLElement doesn't exist under the node test env; isTextEditTarget only
    // matters in the browser, where the guard is a no-op (HTMLElement exists).
    if (typeof HTMLElement !== 'undefined' && isTextEditTarget(ke.target)) return;
    if (!deps.isEnabled()) return;
    const k = ke.key.toLowerCase();
    if (k === 'z' || k === 'x') {
      octaveBase = clampOctaveBase(octaveBase + (k === 'x' ? 12 : -12), MIN_OCTAVE_BASE, MAX_OCTAVE_BASE);
      ke.preventDefault();
      return;
    }
    const midi = midiForKey(k, octaveBase);
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

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  return () => {
    target.removeEventListener('keydown', onKeyDown);
    target.removeEventListener('keyup', onKeyUp);
  };
}
