// plugins/curve/main.ts
var MAX_PTS = 16;
var readPts = (api) => {
  const n = Math.max(2, Math.min(MAX_PTS, Math.round(api.get("pts", 0))));
  return Array.from({ length: n }, (_, i) => ({
    x: api.get(`p${i}x`, 0),
    y: api.get(`p${i}y`, 0),
    c: api.get(`p${i}c`, 0)
  }));
};
var writePts = (api, pts) => {
  api.set("pts", pts.length);
  pts.forEach((p, i) => {
    api.set(`p${i}x`, p.x);
    api.set(`p${i}y`, p.y);
    api.set(`p${i}c`, p.c);
  });
};
var mountEditor = (root, api, extras) => {
  root.style.display = "flex";
  root.style.alignItems = "center";
  root.style.gap = "8px";
  if (api.get("pts", 0) < 2) {
    writePts(api, [{ x: 0, y: 1, c: 0 }, { x: 1, y: 0, c: 0 }]);
  }
  const curve = Loom.controls.curve({
    points: readPts(api),
    label: "Curve",
    grid: { x: 8, y: 4 },
    onChange: (pts) => writePts(api, pts)
  });
  curve.el.style.flex = "1 1 160px";
  root.append(curve.el, ...extras.map((k) => k.el));
};
Loom.registerModulatorUI("curve-lfo", (root, api) => {
  const rate = Loom.controls.knob({
    min: 0.05,
    max: 32,
    value: api.get("rate", 1),
    defaultValue: 1,
    label: "Rate",
    format: (v) => `${v.toFixed(2)}Hz`,
    onChange: (v) => api.set("rate", v)
  });
  const polarity = document.createElement("button");
  polarity.className = "rnd";
  polarity.title = "Polarity: unipolar (0..1) or bipolar (-1..+1)";
  const paint = () => {
    polarity.textContent = api.get("bipolar", 0) !== 0 ? "Bi" : "Uni";
  };
  polarity.addEventListener("click", () => {
    api.set("bipolar", api.get("bipolar", 0) !== 0 ? 0 : 1);
    paint();
  });
  paint();
  mountEditor(root, api, [rate, { el: polarity }]);
});
Loom.registerModulatorUI("curve-env", (root, api) => {
  const dur = Loom.controls.knob({
    min: 0.02,
    max: 20,
    value: api.get("duration", 1),
    defaultValue: 1,
    label: "Time",
    format: (v) => v >= 1 ? `${v.toFixed(1)}s` : `${Math.round(v * 1e3)}ms`,
    onChange: (v) => api.set("duration", v)
  });
  const mode = document.createElement("button");
  mode.className = "rnd";
  mode.title = "One-shot runs the curve once per note; Loop repeats it while the voice sounds";
  const paint = () => {
    mode.textContent = api.get("mode", 0) !== 0 ? "Loop" : "1-shot";
  };
  mode.addEventListener("click", () => {
    api.set("mode", api.get("mode", 0) !== 0 ? 0 : 1);
    paint();
  });
  paint();
  mountEditor(root, api, [dur, { el: mode }]);
});
