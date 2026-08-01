import { describe, it, expect } from 'vitest';
import { euclidFitBars, MAX_FIT_BARS } from './euclid-fit';

const BAR = 16;          // 16th-notes per bar in 4/4

describe('the bars a clip needs for its Euclidean cycles to come round', () => {
  it('leaves a bar-length cycle at one bar', () => {
    expect(euclidFitBars([16], BAR, 1)).toBe(1);
  });

  it('leaves a cycle that divides the bar alone', () => {
    expect(euclidFitBars([8], BAR, 1)).toBe(1);
    expect(euclidFitBars([4], BAR, 1)).toBe(1);
  });

  it('grows to 5 bars for a 5-step cycle — where it meets the barline again', () => {
    expect(euclidFitBars([5], BAR, 1)).toBe(5);
  });

  it('grows to 3 bars for a 12-step cycle', () => {
    expect(euclidFitBars([12], BAR, 1)).toBe(3);
  });

  it('takes every voice into account, not just the one you touched', () => {
    expect(euclidFitBars([3, 5], BAR, 1)).toBe(15);      // lcm 15, meets the bar at 240
  });

  it('is unmoved by a voice whose cycle already fits', () => {
    expect(euclidFitBars([5, 16], BAR, 1)).toBe(5);
  });

  it('keeps the clip as it is when nothing is generating', () => {
    expect(euclidFitBars([], BAR, 4)).toBe(4);
  });

  it('never shortens the clip below the length it already had', () => {
    expect(euclidFitBars([4], BAR, 8)).toBe(8);
  });

  it('gives up rather than exploding on coprime cycles', () => {
    expect(euclidFitBars([5, 7, 11, 13], BAR, 2)).toBe(2);
    expect(euclidFitBars([5, 7], BAR, 2)).toBe(2);       // 35 bars > the cap
  });

  it('never returns more than the cap', () => {
    for (let s = 1; s <= 64; s++) expect(euclidFitBars([s], BAR, 1)).toBeLessThanOrEqual(MAX_FIT_BARS);
  });

  it('counts bars in the session meter, not in 4/4', () => {
    expect(euclidFitBars([12], 12, 1)).toBe(1);          // 3/4: a bar IS 12 steps
    expect(euclidFitBars([8], 12, 1)).toBe(2);           // 8 meets 12 at 24 = 2 bars
  });

  it('ignores junk in the fields', () => {
    expect(euclidFitBars([0, -3, NaN, 5], BAR, 1)).toBe(5);
  });
});
