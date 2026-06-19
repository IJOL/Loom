// BPM-sync division types and the Hz converter used by the arp processor
// and the delay plugin's sync calculation.

export type SyncDiv =
  | 'off'
  | '4/1' | '3/1' | '2/1' | '1/1'   // multi-bar / whole-note cycles
  | '1/2' | '1/4' | '1/8' | '1/8.' | '1/8t'
  | '1/16' | '1/16t' | '1/32';

const SYNC_BEATS: Record<SyncDiv, number> = {
  'off':   0,
  '4/1':   16,    // 4 whole notes = 4 bars in 4/4
  '3/1':   12,    // 3 whole notes = 3 bars
  '2/1':    8,    // 2 whole notes = 2 bars
  '1/1':    4,    // 1 whole note  = 1 bar
  '1/2':    2,
  '1/4':    1,
  '1/8':    0.5,
  '1/8.':   0.75,
  '1/8t':   1/3,
  '1/16':   0.25,
  '1/16t':  1/6,
  '1/32':   0.125,
};

/** LFO cycles per second given BPM + division. E.g. '1/4' at 120 BPM = 2 cycles/sec. */
export function syncDivToHz(bpm: number, div: SyncDiv): number {
  const beats = SYNC_BEATS[div];
  if (beats <= 0) return 0;
  const beatsPerSec = bpm / 60;
  return beatsPerSec / beats;
}
