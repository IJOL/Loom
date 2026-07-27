async (page) => {
  const sceneBtn = page.locator('.session-scene-launch', { hasText: 'Scene 2' }).first();

  // Healthy detector cutoff first, THEN launch → is the ducking bounded + pumping?
  await page.evaluate(() => { window.__pr.env.frequency.value = 30; window.__pr.samples.length = 0; });
  await sceneBtn.click();
  await page.waitForTimeout(8000);

  const healthy = await page.evaluate(() => {
    const S = window.__pr.samples.filter((s) => s.t > 0);
    const last = S.slice(-300);                       // ~5 s
    const d = last.map((s) => s.duck);
    const r = last.filter((s) => s.ratio !== null).map((s) => s.ratio);
    return {
      envFc: +window.__pr.env.frequency.value.toFixed(2),
      duckMin: +Math.min(...d).toFixed(3), duckMax: +Math.max(...d).toFixed(3),
      ratioMin: r.length ? +Math.min(...r).toFixed(3) : null,
      ratioMax: r.length ? +Math.max(...r).toFixed(3) : null,
      srcRms: +(last.reduce((a, s) => a + s.srcRms, 0) / last.length).toFixed(4),
      series: last.filter((_, i) => i % 6 === 0).map((s) => s.duck),
    };
  });

  // Now the shipped cutoff, same playing scene, nothing else changed.
  await page.evaluate(() => {
    window.__pr.env.frequency.value = 1 / (2 * Math.PI * 0.25);
    window.__pr.samples.length = 0;
  });
  const walk = [];
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(3000);
    walk.push(await page.evaluate(() => {
      const S = window.__pr.samples.slice(-30);
      const avg = (k) => +(S.reduce((a, s) => a + s[k], 0) / S.length).toFixed(3);
      const rs = S.filter((s) => s.ratio !== null);
      return {
        t: S[S.length - 1].t, duck: avg('duck'), src: avg('srcRms'),
        ratio: rs.length ? +(rs.reduce((a, s) => a + s.ratio, 0) / rs.length).toFixed(3) : null,
      };
    }));
  }
  return { healthy, shippedWalk: walk };
}
