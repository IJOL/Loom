// plugins/stepseq/main.ts
var STEP_IDS = Array.from({ length: 16 }, (_, i) => `step${i}`);
var MAX_STEPS = 16;
var MIN_STEPS = 2;
Loom.registerModulatorUI("stepseq", (root, api) => {
  root.style.display = "flex";
  root.style.alignItems = "center";
  root.style.gap = "8px";
  const count = () => Math.max(MIN_STEPS, Math.min(MAX_STEPS, Math.round(api.get("steps", 8))));
  const drawn = () => STEP_IDS.slice(0, count()).map((id) => api.get(id, 0));
  if (api.get("step0", -1) < 0) {
    [1, 0, 0.6, 0, 0.8, 0.3, 0.6, 0].forEach((v, i) => api.set(STEP_IDS[i], v));
  }
  const makeBars = () => {
    const b = Loom.controls.steps({
      values: drawn(),
      label: "Pattern",
      onChange: (i, v) => api.set(STEP_IDS[i], Math.max(0, Math.min(1, v)))
    });
    b.el.style.flex = "1 1 160px";
    b.el.style.minWidth = "160px";
    b.el.style.alignSelf = "stretch";
    return b;
  };
  let bars = makeBars();
  const rate = Loom.controls.knob({
    min: 0.5,
    max: 32,
    value: api.get("rate", 8),
    defaultValue: 8,
    label: "Rate",
    format: (v) => `${v.toFixed(1)}Hz`,
    onChange: (v) => api.set("rate", v)
  });
  const len = Loom.controls.knob({
    min: MIN_STEPS,
    max: MAX_STEPS,
    value: count(),
    defaultValue: 8,
    step: 1,
    label: "Steps",
    format: (v) => `${Math.round(v)}`,
    onChange: (v) => {
      api.set("steps", Math.round(v));
      const next = makeBars();
      bars.el.replaceWith(next.el);
      bars = next;
    }
  });
  const glide = Loom.controls.knob({
    min: 0,
    max: 1,
    value: api.get("glide", 0),
    defaultValue: 0,
    label: "Glide",
    onChange: (v) => api.set("glide", v)
  });
  const polarity = document.createElement("button");
  polarity.className = "rnd";
  polarity.title = "Polarity: unipolar (0..1) or bipolar (-1..+1)";
  const paintPolarity = () => {
    polarity.textContent = api.get("bipolar", 0) !== 0 ? "Bi" : "Uni";
  };
  polarity.addEventListener("click", () => {
    api.set("bipolar", api.get("bipolar", 0) !== 0 ? 0 : 1);
    paintPolarity();
  });
  paintPolarity();
  root.append(bars.el, rate.el, len.el, glide.el, polarity);
});
