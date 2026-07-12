// A count-in metronome: N bars of click blips before recording starts, so the
// performer can get in tempo. Pure timing (tested) + a Web-Audio scheduler.
import type { TimeSignature } from '../core/meter';

export function countInClickTimes(
  startSec: number, bpm: number, meter: TimeSignature, bars: number,
): { times: number[]; accents: boolean[]; endSec: number } {
  const beatSec = 60 / bpm;
  const beatsPerBar = meter.num;
  const total = bars * beatsPerBar;
  const times: number[] = [];
  const accents: boolean[] = [];
  for (let i = 0; i < total; i++) {
    times.push(startSec + i * beatSec);
    accents.push(i % beatsPerBar === 0);
  }
  return { times, accents, endSec: startSec + total * beatSec };
}

/** Web-Audio count-in: schedules a short blip per beat (accent = beat 1) and a
 *  timer that fires `onComplete` at the end of the count-in. Returns a cancel fn
 *  that clears the timer (so stopping mid-count-in never starts recording). */
export function createCountIn(ctx: AudioContext, out: AudioNode) {
  return (bars: number, bpm: number, meter: TimeSignature, onComplete: () => void): (() => void) => {
    const { times, accents, endSec } = countInClickTimes(ctx.currentTime, bpm, meter, bars);
    for (let i = 0; i < times.length; i++) {
      const t = times[i];
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = accents[i] ? 1500 : 1000;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(accents[i] ? 0.5 : 0.3, t + 0.001);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
      osc.connect(g).connect(out);
      osc.start(t);
      osc.stop(t + 0.05);
    }
    const ms = Math.max(0, (endSec - ctx.currentTime) * 1000);
    const timer = setTimeout(onComplete, ms) as unknown as number;
    return () => clearTimeout(timer);
  };
}
