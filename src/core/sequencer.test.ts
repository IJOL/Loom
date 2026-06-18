import { describe, it, expect, vi } from 'vitest';
import { Sequencer } from './sequencer';

function fakeCtx() {
  return { currentTime: 0, state: 'running', resume: () => Promise.resolve() } as unknown as AudioContext;
}

describe('Sequencer onTickStats seam', () => {
  it('does NOT compute or call stats when onTickStats is unset', () => {
    vi.useFakeTimers();
    const seq = new Sequencer(fakeCtx(), 32);
    const ticks: number[] = [];
    seq.sessionTick = () => ticks.push(1);
    seq.start();
    vi.advanceTimersByTime(80); // ~3 ticks
    seq.stop();
    expect(ticks.length).toBeGreaterThan(0); // sessionTick still runs
    vi.useRealTimers();
  });

  it('calls onTickStats with numeric (lagMs, tickDurMs) each tick when set', () => {
    vi.useFakeTimers();
    const seq = new Sequencer(fakeCtx(), 32);
    seq.sessionTick = () => { /* no-op scheduling */ };
    const calls: Array<[number, number]> = [];
    seq.onTickStats = (lag, dur) => calls.push([lag, dur]);
    seq.start();
    vi.advanceTimersByTime(80); // ~3 ticks
    seq.stop();
    expect(calls.length).toBeGreaterThan(0);
    for (const [lag, dur] of calls) {
      expect(Number.isFinite(lag)).toBe(true);
      expect(dur).toBeGreaterThanOrEqual(0);
    }
  });
});
