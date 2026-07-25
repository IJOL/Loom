import type { Page } from '@playwright/test';

// Shared e2e helpers for the Session view. After the lane-tabs row was folded
// into the grid column headers, adding a lane goes through the header "+" menu
// (no more session-tabs engine-select + add-button), and a lane is opened by
// clicking its column header (a div, not a button).

/** Add a lane via the grid header "+" engine menu. */
export async function addLane(page: Page, engineId: string): Promise<void> {
  await page.locator('.session-lane-add').click();
  await page.locator(`.session-add-item[data-engine-id="${engineId}"]`).click();
}

/** Add an audio channel via the "+" menu's Audio channel entry. */
export async function addAudioChannel(page: Page): Promise<void> {
  await page.locator('.session-lane-add').click();
  await page.locator('.session-lane-add-menu .session-add-item', { hasText: 'Audio channel' }).click();
}

/** Open a lane's instrument editor by clicking its grid column header. */
export async function openLane(page: Page, laneId: string): Promise<void> {
  await page.locator(`.session-lane-header[data-lane-id="${laneId}"]`).click();
}

export interface MasterLevels {
  /** Loudest sample seen across the window. >= 1 means the master clipped. */
  peak: number;
  /** Mean per-frame RMS — the sustained level, not a transient. */
  avgRms: number;
  frames: number;
  /** Frames whose peak was inaudible. Mid-playback these are dropouts. */
  nearSilent: number;
}

/**
 * Routes the master bus through an AnalyserNode so a test can measure what is
 * actually HEARD. Must be called before `page.goto` — it runs as an init script
 * so the wrapper is in place when the app constructs its AudioContext.
 *
 * Counting createOscillator/createBufferSource calls (the older technique in
 * performance-playback.spec.ts) no longer says anything about audibility: every
 * engine renders inside the AudioWorklet now, so no per-note source nodes are
 * created at all. Only a tap on the graph can tell silence from sound.
 */
export async function installMasterTap(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const Orig = window.AudioContext;
    window.AudioContext = class extends Orig {
      constructor(...args: ConstructorParameters<typeof Orig>) {
        super(...args);
        const an = this.createAnalyser();
        an.fftSize = 2048;
        an.connect(this.destination);
        (window as unknown as { __masterTap: AnalyserNode }).__masterTap = an;
        // Anything that connects to `destination` is re-routed through the
        // analyser, so the tap sees the sum of the graph rather than one node.
        const origConnect = AudioNode.prototype.connect;
        const dest = this.destination;
        AudioNode.prototype.connect = function (this: AudioNode, target: AudioNode | AudioParam, ...rest: number[]) {
          if (target === dest) return origConnect.call(this, an, ...rest);
          return (origConnect as (...a: unknown[]) => AudioNode).call(this, target, ...rest);
        } as AudioNode['connect'];
      }
    } as typeof Orig;
  });
}

/** Measures the master tap for `ms`. Requires installMasterTap before goto. */
export async function measureMaster(page: Page, ms: number): Promise<MasterLevels> {
  return page.evaluate(async (windowMs) => {
    const an = (window as unknown as { __masterTap?: AnalyserNode }).__masterTap;
    if (!an) throw new Error('installMasterTap was not called before page.goto');
    const buf = new Float32Array(an.fftSize);
    let peak = 0, rmsSum = 0, frames = 0, nearSilent = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < windowMs) {
      an.getFloatTimeDomainData(buf);
      let framePeak = 0, sq = 0;
      for (const v of buf) { const a = Math.abs(v); if (a > framePeak) framePeak = a; sq += v * v; }
      if (framePeak > peak) peak = framePeak;
      rmsSum += Math.sqrt(sq / buf.length);
      frames++;
      if (framePeak < 0.001) nearSilent++;
      await new Promise((r) => requestAnimationFrame(r));
    }
    return { peak, avgRms: rmsSum / frames, frames, nearSilent };
  }, ms);
}
