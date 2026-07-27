async (page) => {
  // Fresh page: wipes any poisoned ducker state from earlier runs.
  await page.reload();
  await page.waitForTimeout(8000);

  // Arm the sidechain only to LOCATE the 303 lane's pre-duck node, then disarm it
  // so the measurement runs on a clean signal path (ducker torn down).
  await page.locator('.session-lane-name', { hasText: '303 1' }).first().click();
  await page.waitForTimeout(500);
  const sel = page.locator('[data-page="303"] .lane-fx-sc-src');
  await sel.selectOption('drums-1');
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
      if (!E.some((e) => e.to === g.from && e.fromKind === 'Biquad')) continue;
      const preEdge = E.find((e) => e.to === owner && !e.paramOwner);
      w.__m = { duck: N.get(owner), pre: N.get(preEdge && preEdge.from) };
      return { ok: true, duckId: owner, preId: preEdge && preEdge.from };
    }
    return { ok: false };
  });

  await sel.selectOption('');            // sidechain OFF → ducker disposed
  await page.waitForTimeout(300);

  const ready = await page.evaluate(() => {
    const w = window; const ctx = w.__ctx;
    const mk = (src) => { const a = ctx.createAnalyser(); a.fftSize = 2048; a.smoothingTimeConstant = 0; src.connect(a); return a; };
    w.__m.anPre = mk(w.__m.pre);
    w.__m.anPost = mk(w.__m.duck);
    w.__m.td = new Float32Array(2048);
    w.__m.fd = new Float32Array(1024);
    w.__m.samples = [];
    const stat = (an) => {
      an.getFloatTimeDomainData(w.__m.td);
      let s = 0, p = 0;
      for (let i = 0; i < 2048; i++) { const v = w.__m.td[i]; s += v * v; const a = Math.abs(v); if (a > p) p = a; }
      return { rms: Math.sqrt(s / 2048), peak: p };
    };
    const centroid = (an) => {
      an.getFloatFrequencyData(w.__m.fd);
      const nyq = ctx.sampleRate / 2;
      let num = 0, den = 0;
      for (let i = 1; i < 1024; i++) {
        const mag = Math.pow(10, w.__m.fd[i] / 20);
        num += mag * (i * nyq / 1024);
        den += mag;
      }
      return den > 1e-9 ? num / den : 0;
    };
    const t0 = performance.now();
    const loop = () => {
      const pre = stat(w.__m.anPre), post = stat(w.__m.anPost);
      w.__m.samples.push({
        t: (performance.now() - t0) / 1000,
        pre: pre.rms, post: post.rms, peak: pre.peak,
        cen: centroid(w.__m.anPre),
        ratio: pre.rms > 1e-4 ? post.rms / pre.rms : null,
        duckIntrinsic: w.__m.duck.gain.value,
      });
      w.__m.raf = requestAnimationFrame(loop);
    };
    loop();
    return { duckIntrinsic: w.__m.duck.gain.value };
  });

  await page.locator('.session-scene-launch', { hasText: 'Scene 2' }).first().click();
  await page.waitForTimeout(42000);

  return await page.evaluate(() => {
    const S = window.__m.samples.filter((s) => s.t > 2 && s.pre > 1e-5);
    if (S.length < 100) return { error: 'no signal', n: S.length };
    // Resample to a uniform 50 ms grid.
    const DT = 0.05;
    const tMin = S[0].t, tMax = S[S.length - 1].t;
    const n = Math.floor((tMax - tMin) / DT);
    const grid = { rms: new Float64Array(n), cen: new Float64Array(n) };
    let j = 0;
    for (let i = 0; i < n; i++) {
      const t = tMin + i * DT;
      while (j < S.length - 1 && S[j + 1].t < t) j++;
      grid.rms[i] = S[j].pre;
      grid.cen[i] = S[j].cen;
    }
    const acf = (x) => {
      const m = x.reduce((a, v) => a + v, 0) / x.length;
      const d = Array.from(x, (v) => v - m);
      const c0 = d.reduce((a, v) => a + v * v, 0);
      const out = [];
      const maxLag = Math.min(Math.floor(9 / DT), Math.floor(x.length / 2));
      for (let lag = Math.floor(0.15 / DT); lag < maxLag; lag++) {
        let s = 0;
        for (let i = 0; i + lag < d.length; i++) s += d[i] * d[i + lag];
        out.push({ lagSec: +(lag * DT).toFixed(2), r: +(s / c0).toFixed(3) });
      }
      // local maxima, strongest first
      const peaks = out.filter((p, i) => i > 0 && i < out.length - 1 && p.r > out[i - 1].r && p.r > out[i + 1].r && p.r > 0.1);
      peaks.sort((a, b) => b.r - a.r);
      return peaks.slice(0, 8);
    };
    const bar = 4 * 60 / 130;   // demo is 130 BPM → 1 bar = 1.846 s
    const stats = (x) => {
      const a = Array.from(x);
      const m = a.reduce((p, v) => p + v, 0) / a.length;
      return { mean: +m.toFixed(4), min: +Math.min(...a).toFixed(4), max: +Math.max(...a).toFixed(4) };
    };
    const ratios = S.map((s) => s.ratio).filter((r) => r !== null);
    return {
      durationSec: +(tMax - tMin).toFixed(1),
      barSec: +bar.toFixed(3),
      rms: stats(grid.rms),
      cen: stats(grid.cen),
      rmsPeaks: acf(grid.rms),
      cenPeaks: acf(grid.cen),
      ratioMin: +Math.min(...ratios).toFixed(4),
      ratioMax: +Math.max(...ratios).toFixed(4),
      duckIntrinsic: window.__m.duck.gain.value,
      // ~1 s resolution eyeball series of the 303's own level and brightness
      rmsSeries: Array.from({ length: Math.floor(grid.rms.length / 20) }, (_, i) => +grid.rms[i * 20].toFixed(4)),
      cenSeries: Array.from({ length: Math.floor(grid.cen.length / 20) }, (_, i) => Math.round(grid.cen[i * 20])),
    };
  });
}
