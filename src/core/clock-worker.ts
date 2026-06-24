// Sequencer look-ahead clock, hosted in a Web Worker so its timer keeps firing
// when the page/window is backgrounded. A main-thread `setTimeout` is clamped
// (to ~1 s) once the tab is hidden/occluded, which starved the AudioWorklet of
// notes → silence. A Web Worker timer is not subject to that clamp, so the
// look-ahead scheduler keeps feeding the worklet in the background. This is the
// "A Tale of Two Clocks" pattern (Chris Wilson).
//
// Protocol: the main thread posts { type: 'start', intervalMs } / { type: 'stop' };
// the worker posts a bare `0` on each interval as the tick signal.
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage: (m: unknown) => void;
};

let timer: ReturnType<typeof setInterval> | undefined;

ctx.onmessage = (e: MessageEvent) => {
  const d = e.data as { type?: string; intervalMs?: number } | undefined;
  if (d?.type === 'start') {
    if (timer === undefined) {
      const ms = typeof d.intervalMs === 'number' && d.intervalMs > 0 ? d.intervalMs : 25;
      timer = setInterval(() => ctx.postMessage(0), ms);
    }
  } else if (d?.type === 'stop') {
    if (timer !== undefined) { clearInterval(timer); timer = undefined; }
  }
};
