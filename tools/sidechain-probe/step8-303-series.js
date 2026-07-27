async (page) => {
  return await page.evaluate(() => {
    const S = window.__m.samples;
    if (!S || S.length < 200) return { error: 'no samples', n: S && S.length };
    const DT = 0.05;
    const last = S.filter((s) => s.t > S[S.length - 1].t - 24);   // last 24 s
    const t0 = last[0].t;
    const n = Math.floor((last[last.length - 1].t - t0) / DT);
    const rms = new Float64Array(n), cen = new Float64Array(n);
    let j = 0;
    for (let i = 0; i < n; i++) {
      const t = t0 + i * DT;
      while (j < last.length - 1 && last[j + 1].t < t) j++;
      rms[i] = last[j].pre; cen[i] = last[j].cen;
    }
    const acf = (x) => {
      const m = x.reduce((a, v) => a + v, 0) / x.length;
      const d = Array.from(x, (v) => v - m);
      const c0 = d.reduce((a, v) => a + v * v, 0);
      const out = [];
      for (let lag = 2; lag < Math.floor(x.length / 2); lag++) {
        let s = 0;
        for (let i = 0; i + lag < d.length; i++) s += d[i] * d[i + lag];
        out.push(+(s / c0).toFixed(3));
      }
      return out;                                   // index i → lag (i+2)*DT
    };
    const a = acf(rms);
    const topN = a.map((r, i) => ({ lag: +((i + 2) * DT).toFixed(2), r }))
      .filter((p, i) => i > 0 && i < a.length - 1 && p.r > a[i - 1] && p.r > a[i + 1])
      .sort((x, y) => y.r - x.r).slice(0, 12);
    return {
      transportPlaying: !!document.querySelector('#play.on, #play[aria-pressed=true]'),
      windowSec: +(n * DT).toFixed(1),
      rms50ms: Array.from(rms.slice(0, 300), (v) => +v.toFixed(3)),   // first 15 s
      cen50ms: Array.from(cen.slice(0, 300), (v) => Math.round(v / 10) * 10),
      acfRms: a.filter((_, i) => i % 2 === 0),      // every 100 ms of lag
      acfTop: topN,
    };
  });
}
