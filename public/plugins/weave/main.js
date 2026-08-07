// plugins/weave/main.ts
var MACROS = [
  { id: "density", label: "Density", color: "var(--knob-cyan)" },
  { id: "energy", label: "Energy", color: "var(--knob-yellow)" },
  { id: "darkness", label: "Darkness", color: "var(--knob-purple)" },
  { id: "space", label: "Space", color: "var(--knob-blue)" },
  { id: "motion", label: "Motion", color: "var(--knob-orange)" },
  { id: "styleMix", label: "Style mix", color: "var(--knob-red)" }
];
var R = 22;
var CX = 29;
var CY = 29;
var SWEEP = 270;
var START = 225;
function polar(deg, radius) {
  const rad = (deg - 90) * Math.PI / 180;
  return [CX + radius * Math.cos(rad), CY + radius * Math.sin(rad)];
}
function arcPath(frac) {
  const [x0, y0] = polar(START, R);
  const [x1, y1] = polar(START + SWEEP * frac, R);
  const large = SWEEP * frac > 180 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${R} ${R} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
var svg = (tag) => document.createElementNS("http://www.w3.org/2000/svg", tag);
var el = (tag, cls) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
};
function macroKnob(spec, ctx) {
  const wrap = el("div", "weave-macro");
  const s = svg("svg");
  s.setAttribute("viewBox", "0 0 58 58");
  s.setAttribute("role", "slider");
  s.setAttribute("tabindex", "0");
  s.setAttribute("aria-label", spec.label);
  s.setAttribute("aria-valuemin", "0");
  s.setAttribute("aria-valuemax", "1");
  const track = svg("path");
  track.setAttribute("class", "knob-track");
  track.setAttribute("d", arcPath(1));
  const arc = svg("path");
  arc.setAttribute("class", "knob-arc");
  arc.setAttribute("style", `stroke:${spec.color}`);
  const hub = svg("circle");
  hub.setAttribute("class", "knob-hub");
  hub.setAttribute("cx", String(CX));
  hub.setAttribute("cy", String(CY));
  hub.setAttribute("r", "11");
  const tick = svg("line");
  tick.setAttribute("class", "knob-tick");
  s.append(track, arc, hub, tick);
  const name = el("span", "mname");
  name.textContent = spec.label;
  const val = el("span", "mval");
  const paint = () => {
    const v = ctx.macro(spec.id);
    arc.setAttribute("d", arcPath(v));
    const [x1, y1] = polar(START + SWEEP * v, 3);
    const [x2, y2] = polar(START + SWEEP * v, 10);
    tick.setAttribute("x1", x1.toFixed(2));
    tick.setAttribute("y1", y1.toFixed(2));
    tick.setAttribute("x2", x2.toFixed(2));
    tick.setAttribute("y2", y2.toFixed(2));
    val.textContent = v.toFixed(2).replace(".", ",");
    s.setAttribute("aria-valuenow", v.toFixed(2));
  };
  paint();
  let lastY = 0;
  s.addEventListener("pointerdown", (e) => {
    lastY = e.clientY;
    const id = e.pointerId;
    if (typeof id === "number" && s.setPointerCapture) {
      try {
        s.setPointerCapture(id);
      } catch {
      }
    }
  });
  s.addEventListener("pointermove", (e) => {
    const ev = e;
    if (!ev.buttons) return;
    ctx.setMacro(spec.id, ctx.macro(spec.id) + (lastY - ev.clientY) / 180);
    lastY = ev.clientY;
    paint();
  });
  s.addEventListener("keydown", (e) => {
    const k = e.key;
    const d = k === "ArrowUp" || k === "ArrowRight" ? 0.05 : k === "ArrowDown" || k === "ArrowLeft" ? -0.05 : 0;
    if (!d) return;
    e.preventDefault();
    ctx.setMacro(spec.id, ctx.macro(spec.id) + d);
    paint();
  });
  wrap.append(s, name, val);
  return { el: wrap, paint };
}
function mountWeave(host, ctx) {
  const rack = el("div", "weave-rack");
  const head = el("div", "weave-head");
  const logo = el("span", "weave-logo");
  logo.textContent = "WEAVE";
  const surge = el("button", "weave-surge");
  surge.textContent = "SURGE";
  surge.title = "Hold: everything at full. Release: exactly as it was.";
  const held = /* @__PURE__ */ new Map();
  const SURGE_TARGETS = [
    { id: "density", value: 1 },
    { id: "energy", value: 1 },
    { id: "motion", value: 1 }
  ];
  const repaintMacros = [];
  const press = () => {
    if (held.size) return;
    for (const t of SURGE_TARGETS) held.set(t.id, ctx.macro(t.id));
    for (const t of SURGE_TARGETS) ctx.setMacro(t.id, t.value);
    surge.classList.add("held");
    for (const p of repaintMacros) p();
  };
  const release = () => {
    if (!held.size) return;
    for (const [id, v] of held) ctx.setMacro(id, v);
    held.clear();
    surge.classList.remove("held");
    for (const p of repaintMacros) p();
  };
  surge.addEventListener("pointerdown", press);
  surge.addEventListener("pointerup", release);
  surge.addEventListener("pointercancel", release);
  surge.addEventListener("pointerleave", release);
  window.addEventListener("blur", release);
  const print = el("button", "weave-print");
  print.textContent = "\u25A3 Print to scene";
  head.append(logo, surge, print);
  const pulse = el("div", "weave-pulse");
  const cells = [];
  for (let i = 0; i < 16; i++) {
    const c = el("i", i % 4 === 0 ? "accent" : "");
    pulse.appendChild(c);
    cells.push(c);
  }
  const flowRow = el("div", "weave-flow");
  const flowLabel = el("span", "weave-label");
  flowLabel.textContent = "Flow";
  const flow = document.createElement("input");
  flow.type = "range";
  flow.min = "0";
  flow.max = "1";
  flow.step = "0.01";
  flow.id = "weave-flow";
  flow.setAttribute("aria-label", "Master flow");
  flow.value = String(ctx.macro("flow"));
  const flowOut = el("span", "weave-readout");
  const showFlow = () => {
    flowOut.textContent = Number(flow.value).toFixed(2).replace(".", ",");
  };
  showFlow();
  flow.addEventListener("input", () => {
    ctx.setMacro("flow", Number(flow.value));
    showFlow();
  });
  flowRow.append(flowLabel, flow, flowOut);
  const picker = (cls, label, choices, current, onPick) => {
    const sel = document.createElement("select");
    sel.className = cls;
    sel.setAttribute("aria-label", label);
    if (choices.length === 0) {
      const o = document.createElement("option");
      o.textContent = "\u2014";
      sel.appendChild(o);
      sel.disabled = true;
      return sel;
    }
    const known = current !== void 0 && choices.some((c) => c.id === current);
    if (!known) {
      const o = document.createElement("option");
      o.value = "";
      o.textContent = "\u2014";
      sel.appendChild(o);
    }
    for (const c of choices) {
      const o = document.createElement("option");
      o.value = c.id;
      o.textContent = c.name;
      if (c.id === current) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener("change", () => {
      if (sel.value) onPick(sel.value);
    });
    return sel;
  };
  const lanes = el("div", "weave-lanes");
  const laneRows = [];
  const engineChoices = ctx.engines();
  for (const lane of ctx.lanes()) {
    const row = el("div", "weave-lane");
    const led = el("span", "weave-led");
    const name = el("span", "weave-lane-name");
    name.textContent = lane.name;
    const engine = picker(
      "weave-engine",
      `Instrument for ${lane.name}`,
      engineChoices,
      lane.engineId,
      (id) => ctx.setEngine(lane.id, id)
    );
    const preset = picker(
      "weave-preset",
      `Preset for ${lane.name}`,
      ctx.presets(lane.engineId),
      lane.presetId,
      (id) => ctx.setPreset(lane.id, id)
    );
    const pad = Loom.controls.pad2d({
      x: 0.5,
      y: 0.5,
      label: `Weave position for ${lane.name}`,
      onChange: () => {
      }
    });
    const ring = Loom.controls.loopRing({ label: `Loop position for ${lane.name}` });
    row.append(led, ring.el, name, engine, preset, pad.el);
    lanes.appendChild(row);
    laneRows.push({ id: lane.id, row, led, ring });
  }
  if (laneRows.length === 0) {
    const empty = el("p", "weave-empty");
    empty.textContent = "No lanes yet. Add one in Session and it will appear here.";
    lanes.appendChild(empty);
  }
  const macros = el("div", "weave-macros");
  for (const m of MACROS) {
    const knob = macroKnob(m, ctx);
    macros.appendChild(knob.el);
    repaintMacros.push(knob.paint);
  }
  rack.append(head, pulse, flowRow, lanes, macros);
  host.appendChild(rack);
  let raf = 0;
  let lastStep = -1;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  const SILENT = { state: "silent", frac: 0, bars: 0, centerText: "" };
  const frame = () => {
    raf = requestAnimationFrame(frame);
    const phase = ctx.barPhase();
    if (phase < 0) {
      if (lastStep !== -1) {
        lastStep = -1;
        for (const c of cells) c.classList.remove("on");
        for (const l of laneRows) {
          l.led.classList.remove("hit");
          l.ring.set(SILENT);
        }
        rack.style.removeProperty("--weave-pulse");
      }
      return;
    }
    for (const l of laneRows) l.ring.set(ctx.loopPhase(l.id));
    const step = Math.floor(phase * 16) % 16;
    if (step !== lastStep) {
      lastStep = step;
      cells.forEach((c, i) => c.classList.toggle("on", i === step));
      const onBeat = step % 4 === 0;
      for (const l of laneRows) l.led.classList.toggle("hit", onBeat);
    }
    if (!reduced) {
      const beat = phase * 4 % 1;
      const decay = (1 - beat) * (1 - beat);
      rack.style.setProperty("--weave-pulse", decay.toFixed(3));
    }
  };
  frame();
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("blur", release);
    host.replaceChildren();
  };
}
Loom.registerPanel("weave", mountWeave);
export {
  mountWeave
};
