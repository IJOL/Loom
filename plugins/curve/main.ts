// plugins/curve/main.ts
// Both components mount the SAME curve control plus their own knobs, all from
// the host catalogue. Points live in the numeric bag as pts + p{i}x/y/c —
// exactly what dsp.ts evalCurve reads.

interface Pt { x: number; y: number; c: number }
const MAX_PTS = 16;

const readPts = (api: { get(k: string, d: number): number }): Pt[] => {
  const n = Math.max(2, Math.min(MAX_PTS, Math.round(api.get('pts', 0))));
  return Array.from({ length: n }, (_, i) => ({
    x: api.get(`p${i}x`, 0), y: api.get(`p${i}y`, 0), c: api.get(`p${i}c`, 0),
  }));
};

const writePts = (api: { set(k: string, v: number): void }, pts: Pt[]): void => {
  api.set('pts', pts.length);
  pts.forEach((p, i) => { api.set(`p${i}x`, p.x); api.set(`p${i}y`, p.y); api.set(`p${i}c`, p.c); });
};

const mountEditor = (
  root: HTMLElement,
  api: { get(k: string, d: number): number; set(k: string, v: number): void },
  extras: Array<{ el: HTMLElement }>,
): void => {
  root.style.display = 'flex';
  root.style.alignItems = 'center';
  root.style.gap = '8px';
  // Seed on a bag never drawn (sentinel: pts absent). A modulator that
  // arrives silent-until-you-draw reads as broken — same rule as stepseq.
  if (api.get('pts', 0) < 2) {
    writePts(api, [{ x: 0, y: 1, c: 0 }, { x: 1, y: 0, c: 0 }]);
  }
  const curve = Loom.controls.curve({
    points: readPts(api),
    label: 'Curve',
    grid: { x: 8, y: 4 },
    onChange: (pts) => writePts(api, pts),
  });
  curve.el.style.flex = '1 1 160px';
  root.append(curve.el, ...extras.map((k) => k.el));
};

Loom.registerModulatorUI('curve-lfo', (root, api) => {
  const rate = Loom.controls.knob({
    min: 0.05, max: 32, value: api.get('rate', 1), defaultValue: 1, label: 'Rate',
    format: (v: number) => `${v.toFixed(2)}Hz`,
    onChange: (v: number) => api.set('rate', v),
  });
  const polarity = document.createElement('button');
  polarity.className = 'rnd';
  polarity.title = 'Polarity: unipolar (0..1) or bipolar (-1..+1)';
  const paint = (): void => { polarity.textContent = api.get('bipolar', 0) !== 0 ? 'Bi' : 'Uni'; };
  polarity.addEventListener('click', () => { api.set('bipolar', api.get('bipolar', 0) !== 0 ? 0 : 1); paint(); });
  paint();
  mountEditor(root, api, [rate, { el: polarity }]);
});

Loom.registerModulatorUI('curve-env', (root, api) => {
  const dur = Loom.controls.knob({
    min: 0.02, max: 20, value: api.get('duration', 1), defaultValue: 1, label: 'Time',
    format: (v: number) => v >= 1 ? `${v.toFixed(1)}s` : `${Math.round(v * 1000)}ms`,
    onChange: (v: number) => api.set('duration', v),
  });
  const mode = document.createElement('button');
  mode.className = 'rnd';
  mode.title = 'One-shot runs the curve once per note; Loop repeats it while the voice sounds';
  const paint = (): void => { mode.textContent = api.get('mode', 0) !== 0 ? 'Loop' : '1-shot'; };
  mode.addEventListener('click', () => { api.set('mode', api.get('mode', 0) !== 0 ? 0 : 1); paint(); });
  paint();
  mountEditor(root, api, [dur, { el: mode }]);
});

// A module, not a global script.
export {};
