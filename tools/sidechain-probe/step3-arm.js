async (page) => {
  // 1) Make the 303 lane active so its FX panel (with the SIDECHAIN section) mounts.
  await page.locator('.session-lane-name', { hasText: '303 1' }).first().click();
  await page.waitForTimeout(500);

  // 2) Set SIDECHAIN SRC = Drums 1 through the real UI select (fires @change).
  const sel = page.locator('[data-page="303"] .lane-fx-sc-src');
  await sel.selectOption('drums-1');
  await page.waitForTimeout(400);

  // 3) Find the ducker subgraph in the recorded graph and attach probes.
  const found = await page.evaluate(() => {
    const w = window;
    const P = w.__probe;
    const E = P.edges;

    // duckGain = the gain param fed by BOTH a ConstantSource and a Gain (the
    // ducker's `scale`), where that Gain is itself fed by a Biquad (the detector).
    const paramFeeds = new Map();
    for (const e of E) {
      if (!e.paramOwner || e.pname !== 'gain') continue;
      if (!paramFeeds.has(e.paramOwner)) paramFeeds.set(e.paramOwner, []);
      paramFeeds.get(e.paramOwner).push(e);
    }
    let duckId = null, scaleId = null, constId = null;
    for (const [owner, feeds] of paramFeeds) {
      const c = feeds.find((f) => f.fromKind === 'Const');
      const g = feeds.find((f) => f.fromKind === 'Gain');
      if (!c || !g) continue;
      const fedByBiquad = E.some((e) => e.to === g.from && e.fromKind === 'Biquad');
      if (!fedByBiquad) continue;
      duckId = owner; scaleId = g.from; constId = c.from;
      break;
    }
    if (!duckId) return { ok: false, reason: 'ducker not found', paramFeeds: paramFeeds.size };

    // detector chain: sourceTap(Gain) → Shaper → Biquad(env) → Biquad(smooth) → scale
    const smoothEdge = E.find((e) => e.to === scaleId && e.fromKind === 'Biquad');
    const envEdge = smoothEdge ? E.find((e) => e.to === smoothEdge.from && e.fromKind === 'Biquad') : null;
    const shaperEdge = envEdge ? E.find((e) => e.to === envEdge.from && e.fromKind === 'Shaper') : null;
    const tapEdge = shaperEdge ? E.find((e) => e.to === shaperEdge.from) : null;
    const tapId = tapEdge ? tapEdge.from : null;

    // duckGain's audio input (muteGain) — pre-duck signal of the ducked lane.
    const preEdge = E.find((e) => e.to === duckId && !e.paramOwner);
    const preId = preEdge ? preEdge.from : null;

    const node = (id) => (id ? P.nodes.get(id) : null);
    const duck = node(duckId), scale = node(scaleId), tap = node(tapId), pre = node(preId);
    if (!duck || !scale) return { ok: false, reason: 'nodes missing', duckId, scaleId };

    const ctx = w.__ctx;
    const mkAn = (src) => {
      if (!src) return null;
      const an = ctx.createAnalyser();
      an.fftSize = 2048;
      an.smoothingTimeConstant = 0;
      src.connect(an);
      return an;
    };
    w.__pr = {
      ids: { duckId, scaleId, constId, tapId, preId },
      duck, scale,
      anScale: mkAn(scale),   // = -depth * env  → duckGain multiplier is 1 + this
      anTap: mkAn(tap),       // drums pre-duck signal (detector input)
      anPre: mkAn(pre),       // 303 signal entering duckGain
      anPost: mkAn(duck),     // 303 signal leaving duckGain
      samples: [],
      marks: [],
      t0: performance.now(),
      buf: new Float32Array(2048),
    };

    const stat = (an) => {
      if (!an) return { rms: 0, mean: 0, peak: 0 };
      const b = w.__pr.buf;
      an.getFloatTimeDomainData(b);
      let s = 0, m = 0, p = 0;
      for (let i = 0; i < b.length; i++) { s += b[i] * b[i]; m += b[i]; const a = Math.abs(b[i]); if (a > p) p = a; }
      return { rms: Math.sqrt(s / b.length), mean: m / b.length, peak: p };
    };

    const loop = () => {
      const pr = w.__pr;
      const sc = stat(pr.anScale);
      const tp = stat(pr.anTap);
      const pre2 = stat(pr.anPre);
      const post = stat(pr.anPost);
      pr.samples.push({
        t: +((performance.now() - pr.t0) / 1000).toFixed(3),
        duck: +(1 + sc.mean).toFixed(4),          // effective duck multiplier
        duckMin: +(1 + (sc.mean - 0)).toFixed(4),
        srcRms: +tp.rms.toFixed(5),
        preRms: +pre2.rms.toFixed(5),
        postRms: +post.rms.toFixed(5),
        ratio: pre2.rms > 1e-4 ? +(post.rms / pre2.rms).toFixed(4) : null,
        duckIntrinsic: +pr.duck.gain.value.toFixed(4),
      });
      pr.raf = requestAnimationFrame(loop);
    };
    loop();

    return {
      ok: true,
      ids: w.__pr.ids,
      hasTap: !!tap, hasPre: !!pre,
      duckIntrinsic: duck.gain.value,
      scaleGain: scale.gain.value,
      ctxState: ctx.state,
    };
  });

  return found;
}
