async (page) => {
  // Hypothesis: the detector biquad (Q=0.707) sitting at 0.64 Hz does not just
  // integrate — it RINGS at its own corner frequency, i.e. a ~1.57 s tremolo
  // superposed on the drift. That would be heard as "a slow LFO nobody asked for".
  await page.reload();
  await page.waitForTimeout(8000);

  await page.locator('.session-lane-name', { hasText: '303 1' }).first().click();
  await page.waitForTimeout(500);
  await page.locator('[data-page="303"] .lane-fx-sc-src').selectOption('drums-1');
  await page.waitForTimeout(300);

  const armed = await page.evaluate(() => {
    const w = window; const E = w.__probe.edges; const N = w.__probe.nodes;
    const feeds = new Map();
    for (const e of E) {
      if (!e.paramOwner || e.pname !== 'gain') continue;
      if (!feeds.has(e.paramOwner)) feeds.set(e.paramOwner, []);
      feeds.get(e.paramOwner).push(e);
    }
    for (const [owner, fs] of feeds) {
      const c = fs.find((f) => f.fromKind === 'Const');
      const g = fs.find((f) => f.fromKind === 'Gain');
      if (!c || !g) continue;
      const envSmooth = E.find((e) => e.to === g.from && e.fromKind === 'Biquad');
      if (!envSmooth) continue;
      const ctx = w.__ctx;
      const an = ctx.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = 0;
      N.get(g.from).connect(an);
      w.__d = { scale: N.get(g.from), an, buf: new Float32Array(2048), samples: [], t0: performance.now() };
      const loop = () => {
        w.__d.an.getFloatTimeDomainData(w.__d.buf);
        let m = 0; for (let i = 0; i < 2048; i++) m += w.__d.buf[i];
        w.__d.samples.push({ t: (performance.now() - w.__d.t0) / 1000, duck: 1 + m / 2048 });
        w.__d.raf = requestAnimationFrame(loop);
      };
      loop();
      return { ok: true, scaleId: g.from };
    }
    return { ok: false };
  });

  await page.locator('.session-scene-launch', { hasText: 'Scene 2' }).first().click();
  await page.waitForTimeout(14000);

  const res = await page.evaluate(() => {
    const S = window.__d.samples.filter((s) => s.t > 1.5);
    const DT = 0.05;
    const t0 = S[0].t;
    const n = Math.floor((S[S.length - 1].t - t0) / DT);
    const x = new Float64Array(n);
    let j = 0;
    for (let i = 0; i < n; i++) {
      const t = t0 + i * DT;
      while (j < S.length - 1 && S[j + 1].t < t) j++;
      x[i] = S[j].duck;
    }
    // Remove the linear drift (least squares) → what's left is the oscillation.
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) { sx += i; sy += x[i]; sxx += i * i; sxy += i * x[i]; }
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    const icept = (sy - slope * sx) / n;
    const res = Array.from(x, (v, i) => v - (icept + slope * i));
    const c0 = res.reduce((a, v) => a + v * v, 0);
    const acf = [];
    for (let lag = 2; lag < Math.floor(n / 2); lag++) {
      let s = 0;
      for (let i = 0; i + lag < n; i++) s += res[i] * res[i + lag];
      acf.push({ lag: +(lag * DT).toFixed(2), r: +(s / c0).toFixed(3) });
    }
    const peaks = acf.filter((p, i) => i > 0 && i < acf.length - 1 && p.r > acf[i - 1].r && p.r > acf[i + 1].r && p.r > 0.05)
      .sort((a, b) => b.r - a.r).slice(0, 6);
    return {
      driftPerSec: +(slope / DT).toFixed(4),
      duckStart: +x[0].toFixed(3),
      duckEnd: +x[n - 1].toFixed(3),
      oscPeakToPeak: +(Math.max(...res) - Math.min(...res)).toFixed(3),
      oscRms: +Math.sqrt(c0 / n).toFixed(4),
      acfPeaks: peaks,
      detrended: res.filter((_, i) => i % 2 === 0).map((v) => +v.toFixed(3)).slice(0, 120),
      raw: Array.from(x.slice(0, 240), (v) => +v.toFixed(3)),
    };
  });
  return { armed, res };
}
