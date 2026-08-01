import { test, expect, type Page } from '@playwright/test';
import { openLane } from './helpers';

// The sidechain's regression net, and it MUST live in a real browser: the bug it
// guards was a float32 BiquadFilterNode at 0.64 Hz turning into an integrator, and
// node-web-audio-api (where the unit/DSP suites run) does not reproduce it. The
// duck multiplier used to walk 0.99 → 0 → −3.0, i.e. the ducked lane went silent,
// then came back phase-inverted and LOUDER — and stopping the transport did not
// reset it, so "stop and relaunch" sounded nothing like a steady run.
//
// What we measure: the duck-detector worklet's OUTPUT, which by contract *is* the
// gain multiplier applied to the ducked lane. Invariant: it stays inside [0, 1].

/** Taps the duck-detector worklet node's output. Must run before page.goto. */
async function installDuckTap(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const Orig = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends Orig {
      constructor(ctx: BaseAudioContext, name: string, opts?: AudioWorkletNodeOptions) {
        super(ctx, name, opts);
        if (name !== 'duck-detector') return;
        const an = ctx.createAnalyser();
        an.fftSize = 2048;
        an.smoothingTimeConstant = 0;
        this.connect(an);
        (window as unknown as { __duckTap: AnalyserNode }).__duckTap = an;
      }
    } as typeof Orig;
  });
}

interface DuckStats { frames: number; min: number; max: number; mean: number }

/** Mean/min/max of the multiplier over `ms`, sampled once per animation frame. */
async function measureDuck(page: Page, ms: number): Promise<DuckStats> {
  return page.evaluate(async (windowMs) => {
    const an = (window as unknown as { __duckTap?: AnalyserNode }).__duckTap;
    if (!an) throw new Error('no duck-detector node was created — is the sidechain armed?');
    const buf = new Float32Array(an.fftSize);
    let min = Infinity, max = -Infinity, sum = 0, frames = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < windowMs) {
      an.getFloatTimeDomainData(buf);
      let m = 0;
      for (const v of buf) { m += v; if (v < min) min = v; if (v > max) max = v; }
      sum += m / buf.length;
      frames++;
      await new Promise((r) => requestAnimationFrame(r));
    }
    return { frames, min, max, mean: sum / frames };
  }, ms);
}

async function armSidechain(page: Page): Promise<void> {
  await openLane(page, 'tb-303-1');
  // The bass is edited on the poly page like every other melodic lane; the
  // `data-page="303"` this used to read no longer exists.
  await page.locator('[data-page="poly"] .lane-fx-sc-src').selectOption('drums-1');
}

/** Launch scene 2 and let the analyser fill with REAL data. Without the settle the
 *  first frames still read the tap's initial zeros, and a zero-filled buffer would
 *  satisfy "it ducks" all by itself — the artifact that made `min: 0` meaningless. */
async function launchScene2(page: Page): Promise<void> {
  await page.locator('.session-scene-launch', { hasText: 'Scene 2' }).first().click();
  await page.waitForTimeout(700);
}

test.describe('sidechain ducking', () => {
  test('the duck multiplier stays in [0,1] and survives stop + relaunch', async ({ page }) => {
    await installDuckTap(page);
    await page.goto('/');
    // The boot demo (Minimal Techno) needs its presets + worklet module.
    await expect(page.locator('.session-lane-header[data-lane-id="drums-1"]')).toBeVisible({ timeout: 20000 });
    await armSidechain(page);

    await launchScene2(page);
    const first = await measureDuck(page, 6000);
    console.log('[sidechain] first pass', JSON.stringify(first));

    // The invariant the old biquad follower broke.
    expect(first.min).toBeGreaterThanOrEqual(-0.01);
    expect(first.max).toBeLessThanOrEqual(1.01);
    // And it must actually duck — a multiplier pinned at 1 is a dead sidechain.
    expect(first.min).toBeLessThan(0.95);

    // The reported repro: stop, wait, relaunch. The detector must come back to the
    // same place, not to a drifted one.
    await page.locator('#stop').click();
    await page.waitForTimeout(2500);
    const idle = await measureDuck(page, 1000);
    expect(idle.mean).toBeGreaterThan(0.98);   // released back to unity

    await launchScene2(page);
    const second = await measureDuck(page, 6000);
    console.log('[sidechain] idle', JSON.stringify(idle), 'second pass', JSON.stringify(second));
    expect(second.min).toBeGreaterThanOrEqual(-0.01);
    expect(second.max).toBeLessThanOrEqual(1.01);
    expect(second.min).toBeLessThan(0.95);
    // Same source, same settings → same average ducking (within 15 %).
    expect(Math.abs(second.mean - first.mean)).toBeLessThan(0.15);
  });
});
