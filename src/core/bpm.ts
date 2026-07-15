// Transport BPM helpers. The session tempo is a FLOAT — a stems/loop import
// detects e.g. 127.63 BPM, and rounding that to 128 makes native-played audio
// drift against the grid within a few bars. Keep the fractional value; only the
// on-screen field is formatted for readability.

export const BPM_MIN = 40;
// 240 shut out whole genres that Loom otherwise plays fine — drum & bass sits at
// 160-180 but its half-time feel is written at 320+, and speedcore/gabber live
// well past that. The scheduler is tempo-agnostic (step = 60/bpm/4), so the cap
// is a UI choice, not a DSP limit. Keep index.html's `max` in step with this.
export const BPM_MAX = 400;

/** Clamp to the valid transport range WITHOUT rounding, so a detected fractional
 *  tempo survives and the scheduler grid matches the recorded audio. */
export function clampBpm(bpm: number): number {
  return Math.max(BPM_MIN, Math.min(BPM_MAX, bpm));
}

/** Display form for the BPM field: integers as-is, fractional tempos to 2 dp. */
export function formatBpm(bpm: number): string {
  return Number.isInteger(bpm) ? String(bpm) : bpm.toFixed(2);
}
