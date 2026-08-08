// plugins/weave/lane-row.ts
var TOPOS = [
  { kind: "ab", label: "A\u2192B", title: "Two loops. Arrive at B and a fresh B is drawn \u2014 the journey never ends." },
  { kind: "queue", label: "Queue", title: "A cursor over an ordered list. Finite, but walkable both ways." },
  { kind: "cloud", label: "Cloud", title: "Four loops at the corners of a square. Best on melodic material." }
];
var el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== void 0) n.textContent = text;
  return n;
};
function picker(cls, label, choices, current, onPick) {
  const sel = document.createElement("select");
  sel.className = cls;
  sel.setAttribute("aria-label", label);
  if (choices.length === 0) {
    sel.appendChild(el("option", void 0, "\u2014"));
    sel.disabled = true;
    return sel;
  }
  if (current === void 0 || !choices.some((c) => c.id === current)) {
    const o = el("option", void 0, "\u2014");
    o.value = "";
    sel.appendChild(o);
  }
  const groups = /* @__PURE__ */ new Map();
  for (const c of choices) {
    const o = el("option", void 0, c.name);
    o.value = c.id;
    if (c.id === current) o.selected = true;
    if (!c.group) {
      sel.appendChild(o);
      continue;
    }
    let g = groups.get(c.group);
    if (!g) {
      g = document.createElement("optgroup");
      g.label = c.group;
      groups.set(c.group, g);
      sel.appendChild(g);
    }
    g.appendChild(o);
  }
  sel.addEventListener("change", () => {
    if (sel.value) onPick(sel.value);
  });
  return sel;
}
function weaveCell(laneId, ctx, loops, onChanged) {
  const cell = el("div", "weave-cell");
  const sel = ctx.laneWeave(laneId);
  if (!sel) {
    cell.appendChild(el("span", "weave-hint", loops.length === 0 ? "No clips on this lane yet" : "Pick a topology to start weaving"));
    return cell;
  }
  const nameOf = (id) => loops.find((l) => l.id === id)?.name ?? id;
  const slot = (i, current, apply) => picker("weave-slot", `Loop ${i + 1} for this lane`, loops, current, (id) => {
    ctx.setLaneWeave(laneId, apply(id));
    onChanged();
  });
  if (sel.kind === "ab") {
    const fader = document.createElement("input");
    fader.type = "range";
    fader.min = "0";
    fader.max = "1";
    fader.step = "0.001";
    fader.value = String(sel.x);
    fader.className = "weave-fader";
    fader.setAttribute("aria-label", `Weave position between ${nameOf(sel.a)} and ${nameOf(sel.b)}`);
    fader.addEventListener("input", () => {
      ctx.setLaneWeave(laneId, { ...sel, x: Number(fader.value) });
    });
    cell.append(
      slot(0, sel.a, (id) => ({ ...sel, a: id })),
      fader,
      slot(1, sel.b, (id) => ({ ...sel, b: id }))
    );
    return cell;
  }
  if (sel.kind === "queue") {
    const between = el("span", "weave-between");
    const q = Loom.controls.queue({
      length: Math.max(1, sel.loops.length),
      value: sel.x,
      label: "Position in the queue",
      onChange: (v) => {
        ctx.setLaneWeave(laneId, { ...sel, x: v });
        paintBetween(v);
      }
    });
    const paintBetween = (x) => {
      const n = sel.loops.length;
      if (n < 2) {
        between.textContent = n === 1 ? nameOf(sel.loops[0]) : "\u2014";
        return;
      }
      const pos = Math.min(n - 2, Math.floor(Math.min(1, Math.max(0, x)) * (n - 1)));
      between.textContent = `${nameOf(sel.loops[pos])} \u2192 ${nameOf(sel.loops[pos + 1])}`;
    };
    paintBetween(sel.x);
    cell.append(q.el, between);
    return cell;
  }
  const corners = el("div", "weave-corners");
  for (let i = 0; i < 4; i++) {
    corners.appendChild(slot(i, sel.corners[i] ?? "", (id) => ({
      ...sel,
      corners: sel.corners.map((c, k) => k === i ? id : c)
    })));
  }
  const pad = Loom.controls.pad2d({
    x: sel.x,
    y: sel.y,
    label: "Weave position between the four loops",
    onChange: (x, y) => {
      ctx.setLaneWeave(laneId, { ...sel, x, y });
    }
  });
  cell.append(corners, pad.el);
  return cell;
}
function buildLaneRow(lane, ctx, engines) {
  const row = el("div", "weave-lane");
  const led = el("span", "weave-led");
  const ring = Loom.controls.loopRing({ label: `Loop position for ${lane.name}` });
  const name = el("span", "weave-lane-name", lane.name);
  const engine = picker(
    "weave-engine",
    `Instrument for ${lane.name}`,
    engines,
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
  const transport = el("div", "weave-transport");
  const tbtn = (cls, text, title, on) => {
    const b = el("button", `weave-tbtn ${cls}`, text);
    b.type = "button";
    b.title = title;
    b.addEventListener("click", on);
    transport.appendChild(b);
    return b;
  };
  const play = tbtn("play", "\u25B6", "Launch this track", () => {
    ctx.setLanePlaying(lane.id, true);
    syncTransport();
  });
  const stop = tbtn("stop", "\u25A0", "Stop this track", () => {
    ctx.setLanePlaying(lane.id, false);
    syncTransport();
  });
  const mute = tbtn("mute", "M", "Silence it without losing its place in the bar", () => {
    ctx.setLaneMuted(lane.id, !ctx.laneTransport(lane.id).muted);
    syncTransport();
  });
  const solo = tbtn("solo", "S", "Solo \u2014 the mixer's own, not a second one", () => {
    ctx.setLaneSoloed(lane.id, !ctx.laneTransport(lane.id).soloed);
    syncTransport();
  });
  const syncTransport = () => {
    const t = ctx.laneTransport(lane.id);
    play.classList.toggle("on", t.playing);
    stop.disabled = !t.playing;
    mute.classList.toggle("on", t.muted);
    solo.classList.toggle("on", t.soloed);
  };
  syncTransport();
  const cellHost = el("div", "weave-cell-host");
  const repaintCell = () => {
    cellHost.replaceChildren(weaveCell(lane.id, ctx, ctx.loops(lane.id), repaintCell));
  };
  const style = picker(
    "weave-style",
    `Loop style for ${lane.name}`,
    ctx.styles(),
    ctx.laneStyle(lane.id),
    (id) => {
      ctx.setLaneStyle(lane.id, id);
      repaintCell();
    }
  );
  const topo = el("div", "weave-topo");
  const buttons = TOPOS.map((t) => {
    const b = el("button", "weave-topo-btn", t.label);
    b.type = "button";
    b.title = t.title;
    b.addEventListener("click", () => {
      ctx.setLaneTopology(lane.id, t.kind);
      paintTopo();
      repaintCell();
    });
    topo.appendChild(b);
    return { kind: t.kind, b };
  });
  const paintTopo = () => {
    const kind = ctx.laneWeave(lane.id)?.kind;
    for (const { kind: k, b } of buttons) {
      b.classList.toggle("on", k === kind);
      b.setAttribute("aria-pressed", String(k === kind));
    }
  };
  paintTopo();
  repaintCell();
  row.append(led, ring.el, name, transport, engine, preset, style, topo, cellHost);
  return { laneId: lane.id, el: row, led, ring, syncTransport };
}

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
var el2 = (tag, cls) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
};
function macroKnob(spec, ctx) {
  const wrap = el2("div", "weave-macro");
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
  const name = el2("span", "mname");
  name.textContent = spec.label;
  const val = el2("span", "mval");
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
  const rack = el2("div", "weave-rack");
  const head = el2("div", "weave-head");
  const logo = el2("span", "weave-logo");
  logo.textContent = "WEAVE";
  const surge = el2("button", "weave-surge");
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
  const print = el2("button", "weave-print");
  print.textContent = "\u25A3 Print to scene";
  print.title = "Freeze what is playing right now into a new scene";
  let printTimer = 0;
  print.addEventListener("click", () => {
    const n = ctx.printScene();
    print.textContent = n > 0 ? `\u25A3 Printed ${n} track${n === 1 ? "" : "s"}` : "\u25A3 Nothing weaving";
    clearTimeout(printTimer);
    printTimer = window.setTimeout(() => {
      print.textContent = "\u25A3 Print to scene";
    }, 1800);
  });
  head.append(logo, surge, print);
  const pulse = el2("div", "weave-pulse");
  const cells = [];
  for (let i = 0; i < 16; i++) {
    const c = el2("i", i % 4 === 0 ? "accent" : "");
    pulse.appendChild(c);
    cells.push(c);
  }
  const flowRow = el2("div", "weave-flow");
  const flowLabel = el2("span", "weave-label");
  flowLabel.textContent = "Flow";
  const flow = document.createElement("input");
  flow.type = "range";
  flow.min = "0";
  flow.max = "1";
  flow.step = "0.01";
  flow.id = "weave-flow";
  flow.setAttribute("aria-label", "Master flow");
  const flowNow = ctx.flow();
  flow.value = String(flowNow.position);
  const flowOut = el2("span", "weave-readout");
  const showFlow = () => {
    flowOut.textContent = Number(flow.value).toFixed(2);
  };
  showFlow();
  const drift = document.createElement("select");
  drift.className = "weave-drift";
  drift.setAttribute("aria-label", "How the lanes drift apart");
  for (const [id, label, hint] of [
    ["together", "Together", "Every lane crosses at the same moment \u2014 a section change."],
    ["offset", "Offset", "Lanes fanned out, so something is always mid-transition."],
    ["free", "Free", "Each lane keeps its own position; the flow only nudges it."]
  ]) {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = label;
    o.title = hint;
    drift.appendChild(o);
  }
  const speed = document.createElement("select");
  speed.className = "weave-speed";
  speed.setAttribute("aria-label", "How long a full journey takes");
  for (const bars of [0, 4, 8, 16, 32, 64]) {
    const o = document.createElement("option");
    o.value = String(bars);
    o.textContent = bars === 0 ? "Off" : `${bars} bars`;
    speed.appendChild(o);
  }
  drift.value = flowNow.drift;
  speed.value = String(flowNow.speedBars);
  const pushFlow = () => {
    ctx.setFlow(Number(flow.value), drift.value, Number(speed.value));
    flow.disabled = Number(speed.value) > 0;
    showFlow();
  };
  flow.disabled = flowNow.speedBars > 0;
  flow.addEventListener("input", pushFlow);
  drift.addEventListener("change", pushFlow);
  speed.addEventListener("change", pushFlow);
  const driftLabel = el2("span", "weave-label");
  driftLabel.textContent = "Drift";
  const speedLabel = el2("span", "weave-label");
  speedLabel.textContent = "Speed";
  flowRow.append(flowLabel, flow, flowOut, driftLabel, drift, speedLabel, speed);
  const lanes = el2("div", "weave-lanes");
  const head2 = el2("div", "weave-lane weave-lane-head");
  for (const label of ["", "", "Lane", "", "Instrument", "Preset", "Style", "Topology", "Loops"]) {
    const c = el2("span", "weave-col");
    c.textContent = label;
    head2.appendChild(c);
  }
  lanes.appendChild(head2);
  const engineChoices = ctx.engines();
  const laneRows = ctx.lanes().map((lane) => buildLaneRow(lane, ctx, engineChoices));
  for (const r of laneRows) lanes.appendChild(r.el);
  if (laneRows.length === 0) {
    head2.remove();
    const empty = el2("p", "weave-empty");
    empty.textContent = "No lanes yet. Add one in Session and it will appear here.";
    lanes.appendChild(empty);
  }
  const macros = el2("div", "weave-macros");
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
    for (const l of laneRows) l.ring.set(ctx.loopPhase(l.laneId));
    if (flow.disabled) {
      const pos = ctx.flow().position;
      if (Math.abs(pos - Number(flow.value)) >= 5e-3) {
        flow.value = String(pos);
        showFlow();
      }
    }
    const step = Math.floor(phase * 16) % 16;
    if (step !== lastStep) {
      lastStep = step;
      cells.forEach((c, i) => c.classList.toggle("on", i === step));
      const onBeat = step % 4 === 0;
      for (const l of laneRows) l.led.classList.toggle("hit", onBeat);
      for (const l of laneRows) l.syncTransport();
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
    clearTimeout(printTimer);
    window.removeEventListener("blur", release);
    host.replaceChildren();
  };
}
Loom.registerPanel("weave", mountWeave);
export {
  mountWeave
};
