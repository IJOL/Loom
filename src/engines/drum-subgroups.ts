// src/engines/drum-subgroups.ts
// Presentation-only: names a drum voice for automation destination sub-headings.
// A per-voice param id is `<voice>.<leaf>` (e.g. `kick.tune`, `closedHat.eq.low`);
// the lane bus params (`bus.*`) belong to no voice and get no sub-group.
import { DRUM_LANES, type DrumVoice } from '../core/drums';

/** Title-case display names for the destination dropdown headings (NOT the
 *  terse rack labels in drum-voice-rack.ts's VOICE_LABELS — "CH" reads wrong as
 *  a heading; "Closed Hat" is what the approved mockup shows). */
export const VOICE_DISPLAY_NAMES: Record<DrumVoice, string> = {
  kick: 'Kick', snare: 'Snare', rimshot: 'Rimshot', closedHat: 'Closed Hat',
  openHat: 'Open Hat', clap: 'Clap', cowbell: 'Cowbell', tom: 'Tom',
  ride: 'Ride', crash: 'Crash',
};

const VOICES = new Set<string>(DRUM_LANES);

export function drumSubGroupFor(paramId: string): { key: string; label: string } | undefined {
  const dot = paramId.indexOf('.');
  const seg = dot < 0 ? paramId : paramId.slice(0, dot);
  if (!VOICES.has(seg)) return undefined;
  return { key: seg, label: VOICE_DISPLAY_NAMES[seg as DrumVoice] };
}
