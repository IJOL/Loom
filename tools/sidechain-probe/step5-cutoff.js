async (page) => {
  // Discriminating test: the detector's first stage is a BiquadFilter whose
  // cutoff comes from `release` (0.25 s → 0.64 Hz @ 48 kHz). If the runaway is
  // caused by that sub-Hz cutoff degenerating, then raising the cutoff to a
  // healthy value must stop the runaway *without touching anything else*.
  const setup = await page.evaluate(() => {
    const w = window;
    const E = w.__probe.edges;
    const P = w.__probe.nodes;
    const scaleId = w.__pr.ids.scaleId;
    const smoothEdge = E.find((e) => e.to === scaleId && e.fromKind === 'Biquad');
    const envEdge = smoothEdge ? E.find((e) => e.to === smoothEdge.from && e.fromKind === 'Biquad') : null;
    const smooth = P.get(smoothEdge && smoothEdge.from);
    const env = P.get(envEdge && envEdge.from);
    if (!env || !smooth) return { ok: false };
    const an = w.__ctx.createAnalyser();
    an.fftSize = 2048; an.smoothingTimeConstant = 0;
    env.connect(an);
    w.__pr.anEnv = an;
    w.__pr.env = env;
    w.__pr.smooth = smooth;
    // Extend the sampler to log the env-filter output too.
    w.__pr.envMean = () => {
      const b = w.__pr.buf; an.getFloatTimeDomainData(b);
      let m = 0; for (let i = 0; i < b.length; i++) m += b[i];
      return m / b.length;
    };
    w.__pr.phase = 'A: env fc as shipped';
    return { ok: true, envFc: env.frequency.value, envQ: env.Q.value, smoothFc: smooth.frequency.value, sr: w.__ctx.sampleRate, playing: true };
  });

  const snap = (label) => page.evaluate((l) => {
    const pr = window.__pr;
    const S = pr.samples.slice(-40);           // last ~0.7 s of frames
    const avg = (k) => +(S.reduce((a, s) => a + s[k], 0) / S.length).toFixed(4);
    const rs = S.filter((s) => s.ratio !== null);
    return {
      label: l,
      t: S[S.length - 1].t,
      duck: avg('duck'),
      envMean: +pr.envMean().toFixed(5),
      src: avg('srcRms'),
      ratio: rs.length ? +(rs.reduce((a, s) => a + s.ratio, 0) / rs.length).toFixed(3) : null,
      envFc: +pr.env.frequency.value.toFixed(3),
    };
  }, label);

  const out = [];
  out.push(await snap('A t0 (fc as shipped)'));
  await page.waitForTimeout(4000);
  out.push(await snap('A t+4s (fc as shipped)'));

  // Raise ONLY the env-detector cutoff to 30 Hz (≈5 ms time constant).
  await page.evaluate(() => { window.__pr.env.frequency.value = 30; });
  await page.waitForTimeout(1500);
  out.push(await snap('B t+1.5s (fc=30Hz)'));
  await page.waitForTimeout(4000);
  out.push(await snap('B t+5.5s (fc=30Hz)'));
  await page.waitForTimeout(4000);
  out.push(await snap('B t+9.5s (fc=30Hz)'));

  // Per-frame detail while fc is healthy: is there real per-kick pumping?
  const pump = await page.evaluate(() => {
    const S = window.__pr.samples.slice(-180);   // ~3 s
    const d = S.map((s) => s.duck);
    return {
      min: +Math.min(...d).toFixed(3), max: +Math.max(...d).toFixed(3),
      series: S.filter((_, i) => i % 3 === 0).map((s) => s.duck),
    };
  });

  // Back to the shipped cutoff — does the runaway come back?
  await page.evaluate(() => { window.__pr.env.frequency.value = 1 / (2 * Math.PI * 0.25); });
  await page.waitForTimeout(4000);
  out.push(await snap('C t+4s (fc back to 0.64Hz)'));
  await page.waitForTimeout(5000);
  out.push(await snap('C t+9s (fc back to 0.64Hz)'));

  return { setup, out, pump };
}
