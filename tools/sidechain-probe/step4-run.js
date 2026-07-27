async (page) => {
  const mark = (name) => page.evaluate((n) => {
    window.__pr.marks.push({ name: n, t: +((performance.now() - window.__pr.t0) / 1000).toFixed(3) });
  }, name);

  const sceneBtn = page.locator('.session-scene-launch', { hasText: 'Scene 2' }).first();
  const stopBtn = page.locator('#stop');

  await mark('launch-1');
  await sceneBtn.click();                 // trusted click → resumes ctx + launches scene
  await page.waitForTimeout(16000);

  await mark('stop');
  await stopBtn.click();
  await page.waitForTimeout(5000);

  await mark('launch-2');
  await sceneBtn.click();
  await page.waitForTimeout(16000);
  await mark('end');

  return await page.evaluate(() => {
    const pr = window.__pr;
    const S = pr.samples;
    // 0.5 s buckets: mean/min duck multiplier, mean source + pre/post RMS of the
    // ducked lane, and the measured post/pre ratio (the real, audible ducking).
    const BUCKET = 0.5;
    const out = [];
    let cur = null;
    for (const s of S) {
      const b = Math.floor(s.t / BUCKET) * BUCKET;
      if (!cur || cur.b !== b) { cur = { b, n: 0, duck: 0, duckMin: 9, src: 0, pre: 0, post: 0, rN: 0, r: 0 }; out.push(cur); }
      cur.n++;
      cur.duck += s.duck;
      if (s.duck < cur.duckMin) cur.duckMin = s.duck;
      cur.src += s.srcRms;
      cur.pre += s.preRms;
      cur.post += s.postRms;
      if (s.ratio !== null) { cur.rN++; cur.r += s.ratio; }
    }
    const rows = out.map((c) => ({
      t: c.b,
      duck: +(c.duck / c.n).toFixed(3),
      duckMin: +c.duckMin.toFixed(3),
      src: +(c.src / c.n).toFixed(4),
      pre: +(c.pre / c.n).toFixed(4),
      post: +(c.post / c.n).toFixed(4),
      ratio: c.rN ? +(c.r / c.rN).toFixed(3) : null,
    }));
    return {
      marks: pr.marks,
      frames: S.length,
      rows,
      duckIntrinsicNow: pr.duck.gain.value,
      scaleGainNow: pr.scale.gain.value,
    };
  });
}
