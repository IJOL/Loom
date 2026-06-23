import { describe, it, expect } from 'vitest';
import { SchedulerQueue } from './scheduler-queue';

describe('SchedulerQueue', () => {
  it('fires items in frame order regardless of insertion order', () => {
    const q = new SchedulerQueue<string>();
    q.push(300, 'c'); q.push(100, 'a'); q.push(200, 'b');
    const fired: string[] = [];
    q.drainDue(250, (x) => fired.push(x));
    expect(fired).toEqual(['a', 'b']);     // 300 not yet due
    q.drainDue(300, (x) => fired.push(x));
    expect(fired).toEqual(['a', 'b', 'c']);
  });

  it('does not fire anything before its frame', () => {
    const q = new SchedulerQueue<number>();
    q.push(500, 42);
    const fired: number[] = [];
    q.drainDue(499, (x) => fired.push(x));
    expect(fired).toEqual([]);
  });
});
