async (page) => {
  await page.addInitScript(() => {
    const w = window;
    w.__probe = { edges: [], nodes: new Map(), samples: [], sampling: false };
    let seq = 0;
    const tag = (n, kind) => {
      try {
        n.__id = kind + '#' + (++seq);
        n.__kind = kind;
        w.__probe.nodes.set(n.__id, n);
        for (const p of ['gain', 'offset', 'frequency', 'pan', 'detune', 'Q']) {
          const par = n[p];
          if (par && typeof par.value === 'number' && typeof par.setValueAtTime === 'function') {
            par.__owner = n.__id; par.__pname = p;
          }
        }
      } catch (e) { /* ignore */ }
      return n;
    };
    const Proto = (typeof BaseAudioContext !== 'undefined' ? BaseAudioContext : AudioContext).prototype;
    const wrap = (name, kind) => {
      const orig = Proto[name];
      if (!orig) return;
      Proto[name] = function (...a) { return tag(orig.apply(this, a), kind); };
    };
    wrap('createGain', 'Gain');
    wrap('createConstantSource', 'Const');
    wrap('createWaveShaper', 'Shaper');
    wrap('createBiquadFilter', 'Biquad');
    wrap('createStereoPanner', 'Panner');
    wrap('createDynamicsCompressor', 'Comp');

    const origConnect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (dst, ...rest) {
      try {
        w.__probe.edges.push({
          from: this.__id || ('?' + this.constructor.name),
          fromKind: this.__kind || this.constructor.name,
          to: (dst && dst.__id) || null,
          toKind: (dst && (dst.__kind || (dst.constructor && dst.constructor.name))) || null,
          paramOwner: (dst && dst.__owner) || null,
          pname: (dst && dst.__pname) || null,
        });
      } catch (e) { /* ignore */ }
      return origConnect.call(this, dst, ...rest);
    };

    const OA = w.AudioContext || w.webkitAudioContext;
    class PatchedAC extends OA {
      constructor(...a) { super(...a); w.__ctx = this; }
    }
    w.AudioContext = PatchedAC;
    w.webkitAudioContext = PatchedAC;
  });

  await page.goto('http://localhost:5173/');
  await page.waitForTimeout(7000);

  return await page.evaluate(() => {
    const w = window;
    return {
      hasCtx: !!w.__ctx,
      ctxState: w.__ctx && w.__ctx.state,
      sampleRate: w.__ctx && w.__ctx.sampleRate,
      edges: w.__probe.edges.length,
      nodes: w.__probe.nodes.size,
      pages: [...document.querySelectorAll('[data-page]')].map((e) => e.getAttribute('data-page')),
      scSelects: [...document.querySelectorAll('.lane-fx-sc-src')].map((s) => ({
        page: s.closest('[data-page]') && s.closest('[data-page]').getAttribute('data-page'),
        opts: [...s.options].map((o) => o.value + '|' + o.textContent),
        value: s.value,
        visible: !!(s.offsetParent),
      })),
      laneTabs: [...document.querySelectorAll('[data-page]')].length,
    };
  });
}
