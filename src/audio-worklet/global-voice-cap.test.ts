import { describe, it, expect, vi } from 'vitest';
import { GlobalVoiceCap } from './global-voice-cap';

function fakeNode() {
  let cb: (n: number) => void = () => {};
  return { steal: vi.fn(), onVoiceCount: (f: (n: number) => void) => { cb = f; }, report: (n: number) => cb(n) };
}

describe('GlobalVoiceCap', () => {
  it('sums reported counts across lanes', () => {
    const cap = new GlobalVoiceCap(100);
    const a = fakeNode(); const b = fakeNode();
    cap.register('a', a); cap.register('b', b);
    a.report(10); b.report(15);
    expect(cap.total).toBe(25);
  });

  it('tells the busiest lane to steal the overflow when over budget', () => {
    const cap = new GlobalVoiceCap(20);
    const a = fakeNode(); const b = fakeNode();
    cap.register('a', a); cap.register('b', b);
    a.report(16); b.report(8);    // total 24, over by 4; 'a' is busiest
    expect(a.steal).toHaveBeenCalledWith(4);
    expect(b.steal).not.toHaveBeenCalled();
  });

  it('does not steal when under budget', () => {
    const cap = new GlobalVoiceCap(50);
    const a = fakeNode(); cap.register('a', a);
    a.report(10);
    expect(a.steal).not.toHaveBeenCalled();
  });

  it('unregister stops counting a lane', () => {
    const cap = new GlobalVoiceCap(100);
    const a = fakeNode(); const b = fakeNode();
    cap.register('a', a); cap.register('b', b);
    a.report(10); b.report(10); cap.unregister('b');
    expect(cap.total).toBe(10);
  });

  it('ignores stale reports from an unregistered node', () => {
    const cap = new GlobalVoiceCap(100);
    const a = fakeNode();
    cap.register('a', a);
    cap.unregister('a');
    a.report(99);                 // node fires after unregister
    expect(cap.total).toBe(0);    // not resurrected
  });

  it('a re-registered lane (engine swap) ignores the old node and counts the new one', () => {
    const cap = new GlobalVoiceCap(100);
    const oldN = fakeNode(); const newN = fakeNode();
    cap.register('a', oldN);
    cap.register('a', newN);      // swap: same laneId, new node
    oldN.report(40);             // stale → ignored
    newN.report(7);
    expect(cap.total).toBe(7);
  });

  it('setBudget re-enforces against the new budget on the next report', () => {
    const cap = new GlobalVoiceCap(100);
    const a = fakeNode(); cap.register('a', a);
    a.report(30);
    expect(a.steal).not.toHaveBeenCalled();
    cap.setBudget(20);
    a.report(30);                 // now 30 > 20 → steal 10
    expect(a.steal).toHaveBeenCalledWith(10);
  });
});
