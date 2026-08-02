import type { Page } from '@playwright/test';

// Shared e2e helpers for the Session view. After the lane-tabs row was folded
// into the grid column headers, adding a lane goes through the header "+" menu
// (no more session-tabs engine-select + add-button), and a lane is opened by
// clicking its column header (a div, not a button).

/** Ids of every lane header currently on the grid, in DOM order. */
async function laneIds(page: Page): Promise<string[]> {
  return page.locator('.session-lane-header').evaluateAll(
    (els) => els.map((e) => (e as HTMLElement).dataset.laneId ?? ''),
  );
}

/** Wait for the async boot demo (minimal-techno.json) to have actually applied.
 *
 *  `page.goto('/')` resolves once the page's load event fires — it says nothing
 *  about `wireSessionLifecycle`'s boot chain (`Promise.all([presetsLoaded,
 *  workletReady]).then(fetch demo).then(sessionHost.replaceSession(...))`),
 *  which is still in flight. Any test that interacts with the session grid
 *  right after `goto` is racing that chain: `replaceSession` swaps in every
 *  boot lane in one shot at some non-deterministic point during the test, not
 *  before it.
 *
 *  This was proven, not assumed: instrumenting `addLane` to log its before/after
 *  lane-id snapshots caught runs where `before` was `[]` (captured before the
 *  demo had landed) while `after` held all four boot lanes PLUS the one the
 *  test had just added — because the demo's `replaceSession` fired in the
 *  middle of the click sequence. `addLane`'s diff then saw multiple "new" ids
 *  and had no way to tell the boot lanes from the one the test asked for, so it
 *  could return e.g. the boot session's own `tb-303-1` for a test that asked to
 *  add `wavetable`. That is the exact, reproduced mechanism behind the flaky
 *  wavetable/westcoast/karplus failures in engine-knobs.spec.ts — they are the
 *  LAST entries in the MELODIC list, so by the time their test runs the most
 *  boot-loading time has had a chance to still be outstanding.
 *
 *  `.session-cell-filled` is the signal because the demo ships clips, not just
 *  lanes: waiting for a filled clip cell is proof `replaceSession` completed,
 *  where waiting for lane headers is not (a lane can exist before its clips are
 *  painted). This mirrors a pattern that had already been hand-copied into 20+
 *  spec files (session-management.spec.ts, lane-ui.spec.ts, undo.spec.ts, …) —
 *  it is centralized here, once, so it can't drift between copies the way the
 *  four independent `addLane`s once did.
 */
export async function waitForBoot(page: Page, timeout = 10_000): Promise<void> {
  await page.waitForFunction(
    () => document.querySelectorAll('.session-cell-filled').length > 0,
    { timeout },
  );
}

/** Add a lane via the grid header "+" engine menu; returns the new lane's id.
 *  (Previously defined independently in four different specs — consolidated
 *  here, same as `openLane`, so there is one place that knows how a lane gets
 *  added and how its id is recovered.)
 *
 *  Callers MUST have awaited `waitForBoot` (or otherwise know the session is
 *  settled) before calling this — see `waitForBoot`'s doc for why an unsettled
 *  boot makes the before/after id diff below unreliable. */
export async function addLane(page: Page, engineId = 'subtractive'): Promise<string> {
  const before = await laneIds(page);
  await page.locator('.session-lane-add').click();
  await page.locator(`.session-add-item[data-engine-id="${engineId}"]`).click();
  // "> before.length", not "=== before.length + 1": a caller that skipped
  // waitForBoot could still have the demo add more than one lane in this
  // window. ">" is a floor, not a fix — waitForBoot is what makes `before`
  // trustworthy; this is just belt-and-braces.
  await page.waitForFunction(
    (n) => document.querySelectorAll('.session-lane-header').length > n,
    before.length,
    { timeout: 10_000 },
  );
  const after = await laneIds(page);
  const newId = after.find((id) => !before.includes(id));
  if (!newId) throw new Error(`addLane(${engineId}): could not find the new lane id`);
  return newId;
}

/** Add an audio channel via the "+" menu's Audio channel entry. */
export async function addAudioChannel(page: Page): Promise<void> {
  await page.locator('.session-lane-add').click();
  await page.locator('.session-lane-add-menu .session-add-item', { hasText: 'Audio channel' }).click();
}

/** Open a lane's editor AND wait until it is really the active one.
 *
 *  The wait is not politeness, it is the difference between testing something
 *  and testing nothing. Clicking a lane header re-renders the session grid,
 *  which replaces the header nodes; a second click issued immediately lands on a
 *  node that is already detached and is simply lost. Verified on `main`, so
 *  the swallowed click is not particular to any one branch — but without this
 *  wait a "switch away and back" sequence never comes back, and the assertion
 *  passes by reading a dropdown nothing had touched.
 *
 *  The active class lands DURING the re-render, not after it, so returning the
 *  moment it appears hands the next click a node that is about to be replaced —
 *  and that click is silently lost too. Measured: with a settle here the switch
 *  always takes; without it, a third switch in a row never does. */
export async function openLane(page: Page, laneId: string): Promise<void> {
  await page.locator(`.session-lane-header[data-lane-id="${laneId}"]`).click();
  await page.waitForFunction(
    (id) => !!document.querySelector(`.session-lane-header-active[data-lane-id="${id}"]`),
    laneId,
    { timeout: 5000 },
  );
  await page.waitForTimeout(250);
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
