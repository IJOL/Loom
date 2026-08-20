// packages/loom-plugin-sdk/src/manifest.ts
var CLOUD_PATHS = [
  { id: "rim", label: "RIM", title: "Travel the four sides of the square" },
  {
    id: "cross",
    label: "CROSS",
    title: "Side, diagonal, side, diagonal \u2014 every corner, through the middle twice"
  }
];

// packages/loom-plugin-sdk/src/dsp/mod-env-host.ts
var EMPTY = new Float64Array(0);

// packages/loom-plugin-sdk/src/dsp/ladder.ts
var TWO_PI = Math.PI * 2;

// packages/loom-plugin-sdk/src/dsp/unison.ts
var TWO_PI2 = Math.PI * 2;

// packages/loom-plugin-sdk/src/dsp/filter-kinds.ts
var FILTER_MODES = [
  { value: "dig", label: "DIG", taps: ["lp", "hp", "bp", "notch"] },
  { value: "mog", label: "MOG", taps: ["lp", "hp", "bp"] },
  { value: "acid", label: "303", taps: ["lp", "hp", "bp"] },
  { value: "comb", label: "COMB", taps: ["comb+", "comb-", "combff"] }
];
var TAP_LABELS = {
  lp: "LP",
  hp: "HP",
  bp: "BP",
  notch: "NOTCH",
  "comb+": "POS",
  "comb-": "NEG",
  combff: "FF"
};
var clampIdx = (v, n) => Math.max(0, Math.min(n - 1, Math.round(v)));
function typeOptionsFor(model) {
  const m = FILTER_MODES[clampIdx(model, FILTER_MODES.length)];
  return m.taps.map((t) => ({ value: t, label: TAP_LABELS[t] }));
}
var TYPE_OPTIONS_BY_MODE = Object.fromEntries(FILTER_MODES.map((_m, i) => [String(i), typeOptionsFor(i)]));
var FILTER_MODE_OPTIONS = FILTER_MODES.map((m) => ({ value: m.value, label: m.label }));

// plugins/weave/endless-dial.ts
var SWEEP = 360;
var START = 0;
var svgEl = (tag) => document.createElementNS("http://www.w3.org/2000/svg", tag);
function polar(deg, radius, cx, cy) {
  const rad = (deg - 90) * Math.PI / 180;
  return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)];
}
function endlessDial(o) {
  const size = o.size ?? 58;
  const cx = size / 2, cy = size / 2;
  const r = size * 0.38;
  const hubR = size * 0.19;
  const wrap = document.createElement("div");
  wrap.className = "weave-dial";
  const s = svgEl("svg");
  s.setAttribute("viewBox", `0 0 ${size} ${size}`);
  s.setAttribute("width", String(size));
  s.setAttribute("height", String(size));
  s.setAttribute("role", "slider");
  s.setAttribute("tabindex", "0");
  s.setAttribute("aria-label", o.label);
  s.setAttribute("aria-valuemin", "0");
  s.setAttribute("aria-valuemax", "1");
  const circumference = 2 * Math.PI * r;
  const track = svgEl("circle");
  track.setAttribute("class", "knob-track");
  track.setAttribute("cx", String(cx));
  track.setAttribute("cy", String(cy));
  track.setAttribute("r", r.toFixed(2));
  track.setAttribute("fill", "none");
  const arc = svgEl("circle");
  arc.setAttribute("class", "knob-arc");
  arc.setAttribute("cx", String(cx));
  arc.setAttribute("cy", String(cy));
  arc.setAttribute("r", r.toFixed(2));
  arc.setAttribute("fill", "none");
  arc.setAttribute("stroke-dasharray", circumference.toFixed(3));
  arc.setAttribute("transform", `rotate(-90 ${cx} ${cy})`);
  const hub = svgEl("circle");
  hub.setAttribute("class", "knob-hub");
  hub.setAttribute("cx", String(cx));
  hub.setAttribute("cy", String(cy));
  hub.setAttribute("r", hubR.toFixed(2));
  const tick = svgEl("line");
  tick.setAttribute("class", "knob-tick");
  s.append(track, arc, hub, tick);
  wrap.append(s);
  let wound = Math.min(1, Math.max(0, o.value));
  const shown = () => (wound % 1 + 1) % 1;
  const paint = () => {
    const value = shown();
    arc.setAttribute("stroke-dashoffset", (circumference * (1 - value)).toFixed(3));
    const [x1, y1] = polar(START + SWEEP * value, hubR * 0.3, cx, cy);
    const [x2, y2] = polar(START + SWEEP * value, hubR * 0.92, cx, cy);
    tick.setAttribute("x1", x1.toFixed(2));
    tick.setAttribute("y1", y1.toFixed(2));
    tick.setAttribute("x2", x2.toFixed(2));
    tick.setAttribute("y2", y2.toFixed(2));
    s.setAttribute("aria-valuenow", value.toFixed(3));
  };
  paint();
  const move = (delta) => {
    wound += delta;
    paint();
    o.onChange(wound);
  };
  let lastY = 0;
  let holding = false;
  s.addEventListener("pointerdown", (e) => {
    const ev = e;
    holding = true;
    lastY = ev.clientY;
    if (typeof ev.pointerId === "number" && s.setPointerCapture) {
      try {
        s.setPointerCapture(ev.pointerId);
      } catch {
      }
    }
  });
  const letGo = () => {
    holding = false;
  };
  s.addEventListener("pointerup", letGo);
  s.addEventListener("pointercancel", letGo);
  s.addEventListener("lostpointercapture", letGo);
  s.addEventListener("pointermove", (e) => {
    const ev = e;
    if (!ev.buttons) {
      holding = false;
      return;
    }
    move((lastY - ev.clientY) / 180);
    lastY = ev.clientY;
  });
  s.addEventListener("keydown", (e) => {
    const k = e.key;
    const d = k === "ArrowUp" || k === "ArrowRight" ? 0.02 : k === "ArrowDown" || k === "ArrowLeft" ? -0.02 : 0;
    if (!d) return;
    e.preventDefault();
    move(d);
  });
  return {
    el: wrap,
    set(v) {
      if (holding) return;
      const laps = Math.floor(wound);
      const next = laps + Math.min(1, Math.max(0, v));
      if (Math.abs(next - wound) < 5e-4) return;
      wound = next;
      paint();
    },
    shown,
    held: () => holding
  };
}

// plugins/weave/lane-row.ts
var TOPOS = [
  { kind: "ab", label: "A\u2192B", title: "Two loops. Arrive at B and a fresh B is drawn \u2014 the journey never ends." },
  { kind: "cloud", label: "Cloud", title: "Four loops at the corners of a square. Best on melodic material." }
];
var TOPO_NAME = {
  ab: "A\u2192B",
  queue: "Queue",
  cloud: "Cloud"
};
var OFF = "";
var OFF_LABEL = "\u2014 off \u2014";
var el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== void 0) n.textContent = text;
  return n;
};
function offShelfLabel(id) {
  if (id.startsWith("clip:")) return "Another clip";
  if (!id.startsWith("lib:")) return void 0;
  const parts = id.split(":");
  const index = parts[parts.length - 1];
  const kind = parts[parts.length - 2];
  const style = parts.slice(1, -2).join(":");
  return `${style} ${kind} #${Number(index) + 1}`;
}
function picker(cls, label, choices, current, onPick) {
  const sel = document.createElement("select");
  sel.className = cls;
  sel.setAttribute("aria-label", label);
  if (choices.length === 0) {
    sel.appendChild(el("option", void 0, "\u2014"));
    sel.disabled = true;
    return sel;
  }
  const offered = current !== void 0 && choices.some((c) => c.id === current);
  if (!offered) {
    const named = current ? offShelfLabel(current) : void 0;
    const o = el("option", void 0, named ?? "\u2014");
    o.value = named ? current : "";
    o.selected = true;
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
    return { el: cell };
  }
  const nameOf = (id) => loops.find((l) => l.id === id)?.name ?? id;
  const SLOT_LABEL = ["Loop this lane travels FROM", "Loop this lane travels TO"];
  const slot = (i, current, apply) => picker("weave-slot", SLOT_LABEL[i] ?? `Loop ${i + 1}`, loops, current, (id) => {
    ctx.setLaneWeave(laneId, apply(id));
    onChanged();
  });
  if (sel.kind === "ab") {
    const fader = endlessDial({
      value: sel.x,
      label: `Weave position between ${nameOf(sel.a)} and ${nameOf(sel.b)}`,
      onChange: (v) => {
        ctx.setLaneWeave(laneId, { ...sel, x: (v % 1 + 1) % 1 });
      },
      size: 40
    });
    cell.append(
      slot(1, sel.b, (id) => ({ ...sel, b: id })),
      fader.el,
      slot(0, sel.a, (id) => ({ ...sel, a: id }))
    );
    return {
      el: cell,
      follow: () => {
        const now = ctx.laneWeave(laneId);
        if (!now || fader.held()) return;
        if (now.kind === "ab" && (now.a !== sel.a || now.b !== sel.b)) {
          onChanged();
          return;
        }
        fader.set(now.x);
      }
    };
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
    let shown = sel.x;
    return {
      el: cell,
      follow: () => {
        const now = ctx.laneWeave(laneId);
        if (!now || Math.abs(now.x - shown) < 2e-3) return;
        shown = now.x;
        q.set(now.x);
        paintBetween(now.x);
      }
    };
  }
  const AT = ["cn-tl", "cn-tr", "cn-bl", "cn-br"];
  const cloud = el("div", "weave-cloud");
  const pickers = Array.from({ length: 4 }, (_, i) => {
    const p = slot(i, sel.corners[i] ?? "", (id) => ({
      ...sel,
      corners: sel.corners.map((c, k) => k === i ? id : c)
    }));
    p.classList.add(AT[i]);
    return p;
  });
  const pad = Loom.controls.pad2d({
    x: sel.x,
    y: sel.y,
    label: "Drag: how much of each of the four loops is playing",
    onChange: (x, y) => {
      ctx.setLaneWeave(laneId, { ...sel, x, y });
    }
  });
  const path = el("div", "weave-path");
  const pathBtns = CLOUD_PATHS.map((p) => {
    const b = el("button", "weave-topo-btn", p.label);
    b.type = "button";
    b.title = p.title;
    b.addEventListener("click", () => {
      ctx.setLaneWeave(laneId, { ...sel, path: p.id });
      paintPath(p.id);
    });
    path.appendChild(b);
    return { id: p.id, b };
  });
  const paintPath = (cur) => {
    for (const { id, b } of pathBtns) {
      b.classList.toggle("on", id === cur);
      b.setAttribute("aria-pressed", String(id === cur));
    }
  };
  paintPath(sel.path ?? "rim");
  const padWrap = el("div", "cn-pad");
  padWrap.append(pad.el, path);
  cloud.append(pickers[0], padWrap, pickers[1], pickers[2], pickers[3]);
  cell.appendChild(cloud);
  let at = { x: sel.x, y: sel.y };
  return {
    el: cell,
    follow: () => {
      const now = ctx.laneWeave(laneId);
      if (!now || now.kind !== "cloud") return;
      if (Math.abs(now.x - at.x) < 2e-3 && Math.abs(now.y - at.y) < 2e-3) return;
      at = { x: now.x, y: now.y };
      pad.set(now.x, now.y);
    }
  };
}
function noteStrip(laneId, ctx) {
  const cv = document.createElement("canvas");
  cv.className = "weave-bar";
  cv.setAttribute("aria-label", "The bar this track is about to play");
  let sig = "";
  const draw = (phase) => {
    const notes = ctx.laneNotes(laneId);
    const head = phase < 0 ? -1 : Math.round(phase * 100);
    const next = `${head}|` + notes.map((n) => `${n.at.toFixed(3)}:${n.midi}:${n.from ?? "-"}`).join(",");
    const w = cv.clientWidth, h = cv.clientHeight;
    if (next === sig && cv.width === Math.round(w * devicePixelRatio)) return;
    sig = next;
    if (w === 0 || h === 0) return;
    cv.width = Math.round(w * devicePixelRatio);
    cv.height = Math.round(h * devicePixelRatio);
    const g = cv.getContext("2d");
    if (!g) return;
    g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    g.clearRect(0, 0, w, h);
    g.strokeStyle = "rgba(255,255,255,0.07)";
    g.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const x = Math.round(i / 4 * w) + 0.5;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
    }
    if (phase >= 0) {
      g.fillStyle = "rgba(255,255,255,0.10)";
      g.fillRect(0, 0, phase * w, h);
      g.strokeStyle = "var(--amber)";
      g.strokeStyle = "#ffb02e";
      g.beginPath();
      g.moveTo(Math.round(phase * w) + 0.5, 0);
      g.lineTo(Math.round(phase * w) + 0.5, h);
      g.stroke();
    }
    if (notes.length === 0) return;
    let lo = Infinity, hi = -Infinity;
    for (const n of notes) {
      if (n.midi < lo) lo = n.midi;
      if (n.midi > hi) hi = n.midi;
    }
    const span = Math.max(12, hi - lo);
    const mid = (lo + hi) / 2;
    const top = mid + span / 2;
    const PAD = Math.max(2, Math.round(h * 0.1));
    const NOTE_H = Math.max(2, Math.round(h * 0.09));
    for (const n of notes) {
      const x = n.at * w;
      const wdt = Math.max(2, n.length * w - 1);
      const y = PAD + (top - n.midi) / span * (h - PAD * 2 - NOTE_H);
      const hue = n.from === void 0 ? 40 : [40, 205, 300, 120][n.from % 4];
      const a = 0.35 + 0.65 * Math.min(1, n.velocity / 110);
      g.fillStyle = `hsla(${hue}, 85%, 60%, ${a})`;
      g.fillRect(x, y, wdt, NOTE_H);
    }
  };
  return { el: cv, draw };
}
var openSlot = /* @__PURE__ */ new Map();
function buildLaneRow(lane, ctx, engines) {
  const row = el("div", "weave-lane");
  const meter = Loom.controls.levelMeter();
  meter.el.classList.add("weave-vu");
  const ring = Loom.controls.loopRing({ label: `Loop position for ${lane.name}` });
  const name = el("span", "weave-lane-name", lane.name);
  const slotOf = () => openSlot.get(lane.id) ?? 0;
  const setSlot = (i) => {
    openSlot.set(lane.id, i);
  };
  const engineHost = el("div", "weave-pick-host");
  const presetHost = el("div", "weave-pick-host");
  const slots = el("div", "weave-slotpick");
  const paintPickers = () => {
    const rack = ctx.laneSlots(lane.id);
    const inRack = rack.length > 1;
    if (slotOf() >= rack.length) setSlot(0);
    const slot = slotOf();
    slots.replaceChildren();
    slots.classList.toggle("off", !inRack);
    if (inRack) {
      rack.forEach((_, i) => {
        const b = el("button", `weave-slot-btn${i === slot ? " on" : ""}`, String(i + 1));
        b.type = "button";
        b.title = `Instrument ${i + 1} of this lane's rack \u2014 the ${i === 0 ? "near" : "far"} end of its sound fader`;
        b.addEventListener("click", () => {
          setSlot(i);
          paintPickers();
        });
        slots.appendChild(b);
      });
    }
    const held = inRack ? rack[slot].engineId : lane.engineId;
    engineHost.replaceChildren(picker(
      "weave-engine",
      inRack ? `Instrument ${slot + 1} for ${lane.name}` : `Instrument for ${lane.name}`,
      inRack ? ctx.slotEngines() : engines,
      held,
      (id) => {
        if (inRack) {
          ctx.setLaneSlotEngine(lane.id, slot, id);
          paintPickers();
        } else ctx.setEngine(lane.id, id);
      }
    ));
    const chosen = inRack ? rack[slot].presetName ? `engine:${rack[slot].presetName}` : void 0 : lane.presetId;
    engineHost.classList.toggle("in-rack", inRack);
    presetHost.replaceChildren(picker(
      "weave-preset",
      inRack ? `Preset for instrument ${slot + 1} of ${lane.name}` : `Preset for ${lane.name}`,
      ctx.presets(held),
      chosen,
      (id) => {
        const bare = id.startsWith("engine:") ? id.slice("engine:".length) : id;
        if (inRack) {
          ctx.setLaneSlotPreset(lane.id, slot, bare);
          paintPickers();
        } else ctx.setPreset(lane.id, id);
      }
    ));
  };
  paintPickers();
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
  const lock = tbtn("lock", "\u{1F512}", "Hold this track where it is \u2014 the flow moves everything else", () => {
    ctx.setLaneLocked(lane.id, !ctx.laneLocked(lane.id));
    syncTransport();
  });
  const syncTransport = () => {
    const t = ctx.laneTransport(lane.id);
    play.classList.toggle("on", t.playing);
    stop.disabled = !t.playing;
    mute.classList.toggle("on", t.muted);
    solo.classList.toggle("on", t.soloed);
    lock.classList.toggle("on", ctx.laneLocked(lane.id));
  };
  syncTransport();
  const range = ctx.laneLevelRange();
  const levelWrap = el("div", "weave-level");
  const level = document.createElement("input");
  level.type = "range";
  level.className = "weave-level-fader";
  level.min = String(range.min);
  level.max = String(range.max);
  level.step = "0.01";
  level.value = String(ctx.laneLevel(lane.id));
  level.setAttribute("aria-label", "Level for this track");
  const levelOut = el("span", "weave-level-out");
  const showLevel = (v) => {
    levelOut.textContent = `${Math.round(v * 100)}%`;
  };
  showLevel(Number(level.value));
  level.addEventListener("input", () => {
    const v = Number(level.value);
    ctx.setLaneLevel(lane.id, v);
    showLevel(v);
  });
  levelWrap.append(level, levelOut);
  const soundWrap = el("div", "weave-sound");
  const soundOn = el("button", "weave-sound-btn", "\u25D0");
  soundOn.type = "button";
  const soundHost = el("div", "weave-sound-host");
  const paintSound = () => {
    const at = ctx.laneSound(lane.id);
    const on = at !== null;
    soundOn.classList.toggle("on", on);
    soundOn.title = on ? "Sound on \u2014 every note reaches every instrument in the rack" : "Sound off \u2014 each note plays on the instrument of the loop it came from";
    soundOn.setAttribute("aria-pressed", String(on));
    soundWrap.classList.toggle("off", !on);
    soundHost.replaceChildren();
    if (!at) return;
    if (ctx.laneWeave(lane.id)?.kind === "cloud") {
      const p = Loom.controls.pad2d({
        x: at.x,
        y: at.y,
        label: "Drag: how much of each of the four instruments this lane is played on",
        onChange: (x, y) => {
          ctx.setLaneSound(lane.id, x, y);
        }
      });
      p.el.classList.add("weave-sound-pad");
      soundHost.appendChild(p.el);
      return;
    }
    const fader = document.createElement("input");
    fader.type = "range";
    fader.className = "weave-sound-fader";
    fader.min = "0";
    fader.max = "1";
    fader.step = "0.01";
    fader.value = String(at.x);
    fader.setAttribute("aria-label", "Which instrument this lane is played on");
    fader.addEventListener("input", () => {
      ctx.setLaneSound(lane.id, Number(fader.value));
    });
    soundHost.appendChild(fader);
  };
  soundOn.addEventListener("click", () => {
    ctx.setLaneSound(lane.id, ctx.laneSound(lane.id) === null ? 0 : null, 0);
    paintSound();
    paintPickers();
  });
  soundWrap.append(soundOn, soundHost);
  const cellHost = el("div", "weave-cell-host");
  let cell = { el: cellHost };
  const repaintCell = () => {
    cell = weaveCell(lane.id, ctx, ctx.loops(lane.id), repaintCell);
    cellHost.replaceChildren(cell.el);
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
  const roleChoices = ctx.roleChoices(lane.id);
  const role = picker(
    "weave-role",
    `Part played by ${lane.name}`,
    roleChoices,
    ctx.laneRole(lane.id) ?? "",
    (id) => {
      ctx.setLaneRole(lane.id, id || null);
      repaintCell();
    }
  );
  if (roleChoices.length === 0) role.title = "A drum lane plays percussion, whatever part anything says";
  const followChoices = ctx.followChoices(lane.id);
  const follow = followChoices.length > 0 ? picker(
    "weave-follow",
    `Lane accompanied by ${lane.name}`,
    followChoices,
    ctx.laneFollow(lane.id) ?? "",
    (id) => {
      ctx.setLaneFollow(lane.id, id || null);
      repaintCell();
    }
  ) : null;
  const topo = document.createElement("select");
  topo.className = "weave-topo";
  topo.setAttribute("aria-label", `How ${lane.name} weaves`);
  const off = el("option", void 0, OFF_LABEL);
  off.value = OFF;
  off.title = "Stop weaving \u2014 the lane plays its clip untouched";
  topo.appendChild(off);
  for (const t of TOPOS) {
    const o = el("option", void 0, t.label);
    o.value = t.kind;
    o.title = t.title;
    topo.appendChild(o);
  }
  topo.addEventListener("change", () => {
    if (topo.value === OFF) ctx.setLaneWeave(lane.id, null);
    else ctx.setLaneTopology(lane.id, topo.value);
    paintTopo();
    repaintCell();
    paintSound();
    paintPickers();
  });
  const length = el("div", "weave-len");
  for (const [label, factor, title] of [
    ["\xF72", 0.5, "Double time: this lane plays its phrase twice as fast"],
    ["\xD72", 2, "Half time: this lane stretches its phrase over twice the room"]
  ]) {
    const b = el("button", "weave-len-btn", label);
    b.type = "button";
    b.title = title;
    b.addEventListener("click", () => {
      ctx.setLaneTime(lane.id, factor);
      repaintCell();
    });
    length.appendChild(b);
  }
  const octave = el("div", "weave-oct");
  const octOut = el("span", "weave-oct-out");
  const paintOct = () => {
    const v = ctx.laneOctave(lane.id);
    octOut.textContent = v === 0 ? "0" : v > 0 ? `+${v}` : String(v);
    octave.classList.toggle("off", v === 0);
  };
  for (const [label, delta, title] of [
    ["\u2212", -1, "Down an octave"],
    ["+", 1, "Up an octave"]
  ]) {
    const b = el("button", "weave-oct-btn", label);
    b.type = "button";
    b.title = `${title} \u2014 the lane's register, never its notes`;
    b.addEventListener("click", () => {
      ctx.setLaneOctave(lane.id, delta);
      paintOct();
      repaintCell();
    });
    if (delta > 0) octave.appendChild(octOut);
    octave.appendChild(b);
  }
  paintOct();
  const paintTopo = () => {
    const kind = ctx.laneWeave(lane.id)?.kind;
    if (kind && !TOPOS.some((t) => t.kind === kind) && !topo.querySelector(`option[value="${kind}"]`)) {
      const o = el("option", void 0, TOPO_NAME[kind]);
      o.value = kind;
      o.title = "Retired: still plays, no longer offered";
      topo.appendChild(o);
    }
    topo.value = kind ?? OFF;
  };
  paintTopo();
  repaintCell();
  paintSound();
  row.append(meter.el, ring.el, name, transport, levelWrap, topo, cellHost, soundWrap);
  const strip = noteStrip(lane.id, ctx);
  const setup = el("div", "weave-lane-setup");
  const followCell = el("div", "weave-follow-cell");
  if (follow) followCell.append(follow);
  setup.append(
    strip.el,
    slots,
    engineHost,
    presetHost,
    role,
    followCell,
    style,
    length,
    octave
  );
  const wrap = el("div", "weave-lane-wrap");
  wrap.append(row, setup);
  return {
    laneId: lane.id,
    el: wrap,
    meter,
    ring,
    syncTransport,
    // Called from the panel's rAF while the master flow is travelling: the host
    // owns the position then, and the row FOLLOWS it. Without this the lanes sat
    // at whatever they were built with while the music crossed away underneath.
    followWeave: (phase) => {
      cell.follow?.();
      strip.draw(phase);
    }
  };
}

// plugins/weave/step-rack.ts
var el2 = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== void 0) n.textContent = text;
  return n;
};
var placeOf = (c) => c.group || "Other";
function option(value, text) {
  const o = document.createElement("option");
  o.value = value;
  o.textContent = text;
  return o;
}
function buildRow(ctx, row, choices, rebuild) {
  const st = ctx.stepRows()[row];
  const wrap = el2("div", "weave-step-row");
  const places = [...new Set(choices.map(placeOf))];
  const current = choices.find((c) => c.id === st.destId);
  const place = current ? placeOf(current) : places[0] ?? "";
  const placePick = el2("select", "weave-step-place");
  placePick.setAttribute("aria-label", "Which track this row moves");
  for (const p of places) placePick.appendChild(option(p, p));
  placePick.value = place;
  const destPick = el2("select", "weave-step-dest");
  destPick.setAttribute("aria-label", "What the step row moves");
  const fillDests = (forPlace) => {
    destPick.replaceChildren(option("", "\u2014 nothing yet \u2014"));
    for (const c of choices) {
      if (placeOf(c) !== forPlace) continue;
      destPick.appendChild(option(c.id, c.name));
    }
    destPick.value = [...destPick.options].some((o) => o.value === st.destId) ? st.destId : "";
  };
  fillDests(place);
  placePick.addEventListener("change", () => {
    fillDests(placePick.value);
    ctx.setStepsDest(row, destPick.value);
  });
  destPick.addEventListener("change", () => ctx.setStepsDest(row, destPick.value));
  const modePick = el2("select", "weave-step-mode");
  modePick.setAttribute("aria-label", "How a step reaches the next");
  for (const [v, label] of [["hold", "Step"], ["ramp", "Glide"]]) {
    modePick.appendChild(option(v, label));
  }
  modePick.value = st.mode;
  modePick.addEventListener("change", () => {
    ctx.setStepsMode(row, modePick.value === "ramp" ? "ramp" : "hold");
  });
  const on = el2("button", "weave-step-on");
  const paintOn = () => {
    const running = ctx.stepRows()[row]?.on ?? false;
    on.textContent = running ? "\u25CF RUNNING" : "\u25CB OFF";
    on.classList.toggle("on", running);
    on.setAttribute("aria-pressed", String(running));
  };
  on.addEventListener("click", () => {
    ctx.setStepsOn(row, !(ctx.stepRows()[row]?.on ?? false));
    paintOn();
  });
  paintOn();
  const grid = Loom.controls.steps({
    values: st.values,
    label: "The step row",
    onChange: (i, v) => ctx.setStep(row, i, v)
  });
  grid.el.classList.add("weave-step-grid");
  const tools = el2("div", "weave-step-tools");
  for (const [kind, label] of [["up", "\u2197"], ["down", "\u2198"], ["invert", "\u21C5"], ["random", "\u2684"]]) {
    const b = el2("button", "weave-step-tool", label);
    b.title = { up: "Ramp up", down: "Ramp down", invert: "Invert", random: "Randomise" }[kind];
    b.addEventListener("click", () => {
      ctx.stepsTool(row, kind);
      grid.set(ctx.stepRows()[row]?.values ?? []);
    });
    tools.appendChild(b);
  }
  const drop = el2("button", "weave-step-drop", "\xD7");
  drop.title = "Remove this row";
  drop.addEventListener("click", () => {
    ctx.removeStepRow(row);
    rebuild();
  });
  const head = el2("div", "weave-step-head");
  head.append(placePick, destPick, modePick, on, tools, drop);
  wrap.append(head, grid.el);
  return wrap;
}
function buildStepRack(ctx) {
  const rack = el2("div", "weave-steps");
  const paint = () => {
    const choices = ctx.destinations();
    const rows = ctx.stepRows();
    const label = el2("span", "weave-label", "Steps");
    const add = el2("button", "weave-step-add", "+ ROW");
    add.title = "Another row, for another parameter";
    add.addEventListener("click", () => {
      ctx.addStepRow();
      paint();
    });
    const bar = el2("div", "weave-step-bar");
    bar.append(label, add);
    rack.replaceChildren(bar, ...rows.map((_, i) => buildRow(ctx, i, choices, paint)));
  };
  paint();
  return rack;
}

// plugins/weave/main.ts
var MACROS = [
  { id: "density", label: "Density", color: "var(--knob-cyan)" },
  { id: "energy", label: "Energy", color: "var(--knob-yellow)" },
  // 'Mood' on the outside, `darkness` in the data — see weave-catalog for why.
  { id: "darkness", label: "Mood", color: "var(--knob-purple)" },
  // Space and Motion sat here and are gone. They were the only two that wrote
  // PARAMS instead of notes, and every one that survives changes the music
  // itself — which is the difference the user reported between a knob that
  // keeps giving and one that is spent after the first sweep.
  { id: "styleMix", label: "Style mix", color: "var(--knob-red)" }
];
var R = 22;
var CX = 29;
var CY = 29;
var SWEEP2 = 270;
var START2 = 225;
function polar2(deg, radius) {
  const rad = (deg - 90) * Math.PI / 180;
  return [CX + radius * Math.cos(rad), CY + radius * Math.sin(rad)];
}
function arcPath(frac) {
  const [x0, y0] = polar2(START2, R);
  const [x1, y1] = polar2(START2 + SWEEP2 * frac, R);
  const large = SWEEP2 * frac > 180 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${R} ${R} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
var CUSTOM = "__custom";
var HOLD_MS = 450;
var svg = (tag) => document.createElementNS("http://www.w3.org/2000/svg", tag);
var el3 = (tag, cls) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
};
function macroKnob(spec, ctx) {
  const wrap = el3("div", "weave-macro");
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
  const name = el3("span", "mname");
  name.textContent = spec.label;
  const val = el3("span", "mval");
  const paint = () => {
    const v = ctx.macro(spec.id);
    arc.setAttribute("d", arcPath(v));
    const [x1, y1] = polar2(START2 + SWEEP2 * v, 3);
    const [x2, y2] = polar2(START2 + SWEEP2 * v, 10);
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
  const rack = el3("div", "weave-rack");
  const head = el3("div", "weave-head");
  const logo = el3("span", "weave-logo");
  logo.textContent = "WEAVE";
  const surge = el3("button", "weave-surge");
  surge.textContent = "SURGE";
  surge.title = "Hold: everything at full. Release: exactly as it was.";
  const held = /* @__PURE__ */ new Map();
  const SURGE_TARGETS = [
    { id: "density", value: 1 },
    { id: "energy", value: 1 }
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
  const print = el3("button", "weave-print");
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
  const field = (label, ...controls) => {
    const f = el3("span", "weave-field");
    const l = el3("span", "weave-label");
    l.textContent = label;
    f.append(l, ...controls);
    return f;
  };
  const pick = (cls, choices, value) => {
    const s = document.createElement("select");
    s.className = cls;
    for (const c of choices) {
      const o = document.createElement("option");
      o.value = c.id;
      o.textContent = c.name;
      s.appendChild(o);
    }
    s.value = value;
    return s;
  };
  const mus = ctx.musicality();
  const keySel = pick("weave-key", ctx.keys(), String(mus.key));
  const scaleSel = pick("weave-scale", ctx.scales(), mus.scale);
  const styleSel = pick("weave-style", ctx.styles(), mus.style);
  const pushMus = () => ctx.setMusicality(Number(keySel.value), scaleSel.value, styleSel.value);
  for (const s of [keySel, scaleSel, styleSel]) s.addEventListener("change", pushMus);
  const progSel = pick("weave-prog", ctx.progressions(), ctx.progression());
  for (const c of ctx.progressions()) {
    const o = [...progSel.options].find((x) => x.value === c.id);
    if (o && c.group) o.title = `${c.id.replace(/-/g, " \xB7 ")} \u2014 ${c.group}`;
  }
  const customOpt = document.createElement("option");
  customOpt.value = CUSTOM;
  customOpt.textContent = "Custom";
  customOpt.disabled = true;
  customOpt.title = "Written by hand below. Pick an entry above to go back to the catalogue.";
  progSel.appendChild(customOpt);
  progSel.addEventListener("change", () => {
    if (progSel.value === CUSTOM) return;
    ctx.setProgression(progSel.value);
    paintChords();
  });
  const reseed = el3("button", "weave-reseed");
  reseed.textContent = "\u27F3 Reshuffle";
  reseed.title = "Tap: deal the loop you are NOT hearing \xB7 Hold: deal them all";
  reseed.style.setProperty("--weave-hold", `${HOLD_MS}ms`);
  let holdFired = false;
  let holdTimer = 0;
  const disarm = () => {
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = 0;
    }
    reseed.classList.remove("arming");
  };
  reseed.addEventListener("pointerdown", () => {
    holdFired = false;
    reseed.classList.add("arming");
    holdTimer = window.setTimeout(() => {
      holdFired = true;
      disarm();
      ctx.reseed("all");
    }, HOLD_MS);
  });
  reseed.addEventListener("pointerup", disarm);
  reseed.addEventListener("pointerleave", disarm);
  reseed.addEventListener("pointercancel", () => {
    disarm();
    holdFired = false;
  });
  reseed.addEventListener("click", () => {
    if (holdFired) {
      holdFired = false;
      return;
    }
    ctx.reseed("quiet");
  });
  const bars = el3("button", "weave-bars-toggle");
  const paintBars = () => {
    const open = rack.classList.contains("bars-open");
    bars.textContent = open ? "\u25A4 Notes" : "\u25A4 Notes";
    bars.classList.toggle("on", open);
    bars.title = open ? "Shrink the note bars" : "Enlarge the note bars";
    bars.setAttribute("aria-pressed", String(open));
  };
  bars.addEventListener("click", () => {
    rack.classList.toggle("bars-open");
    paintBars();
  });
  const hold = el3("button", "weave-hold");
  const paintHold = () => {
    const on = ctx.locked();
    hold.textContent = on ? "\u{1F512} HELD" : "\u{1F513} HOLD";
    hold.classList.toggle("on", on);
    hold.title = on ? "Let the weave travel again" : "Keep these loops \u2014 the chords keep walking, the macros keep working";
    hold.setAttribute("aria-pressed", String(on));
  };
  hold.addEventListener("click", () => {
    ctx.setLocked(!ctx.locked());
    paintHold();
  });
  const halt = el3("button", "weave-halt");
  const paintHalt = () => {
    const off = ctx.bypassed();
    halt.textContent = off ? "\u23FB WEAVE OFF" : "\u23FB WEAVE ON";
    halt.classList.toggle("on", off);
    halt.title = off ? "Connect the weave back to the clock" : "Disconnect the weave from the clock \u2014 the rest of Loom carries on as normal";
    halt.setAttribute("aria-pressed", String(off));
  };
  halt.addEventListener("click", () => {
    ctx.setBypassed(!ctx.bypassed());
    paintHalt();
  });
  const spacer = el3("span", "weave-head-spacer");
  head.append(
    logo,
    field("Key", keySel, scaleSel),
    field("Style", styleSel),
    field("Chords", progSel),
    spacer,
    bars,
    reseed,
    hold,
    halt,
    surge,
    print
  );
  paintBars();
  paintHold();
  paintHalt();
  const pulse = el3("div", "weave-pulse");
  const cells = [];
  for (let i = 0; i < 16; i++) {
    const c = el3("i", i % 4 === 0 ? "accent" : "");
    pulse.appendChild(c);
    cells.push(c);
  }
  const flowRow = el3("div", "weave-flow");
  const flowLabel = el3("span", "weave-label");
  flowLabel.textContent = "Flow";
  const flowNow = ctx.flow();
  const flowOut = el3("span", "weave-readout");
  let flowWound = flowNow.position;
  const showFlow = () => {
    flowOut.textContent = flowDial.shown().toFixed(2);
  };
  const flowDial = endlessDial({
    value: flowNow.position,
    label: "Master flow",
    onChange: (v) => {
      flowWound = v;
      pushFlow(v);
    },
    size: 46
  });
  flowDial.el.id = "weave-flow";
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
  for (const bars2 of [0, 4, 8, 16, 32, 64]) {
    const o = document.createElement("option");
    o.value = String(bars2);
    o.textContent = bars2 === 0 ? "Off" : `${bars2} bars`;
    speed.appendChild(o);
  }
  const pingPong = document.createElement("select");
  pingPong.className = "weave-pingpong";
  pingPong.setAttribute("aria-label", "Laps out before the journey turns round");
  for (const laps of [0, 2, 4, 8]) {
    const o = document.createElement("option");
    o.value = String(laps);
    o.textContent = laps === 0 ? "One way" : `\u21C4 ${laps} laps`;
    o.title = laps === 0 ? "The journey only ever goes forward" : `${laps} laps out, then back over the same loops`;
    pingPong.appendChild(o);
  }
  drift.value = flowNow.drift;
  speed.value = String(flowNow.speedBars);
  pingPong.value = String(flowNow.pingPongLaps ?? 0);
  const evolve = document.createElement("button");
  evolve.className = "weave-evolve";
  evolve.id = "weave-evolve";
  const paintEvolve = () => {
    const on = !!ctx.flow().evolve;
    evolve.dataset.on = on ? "1" : "";
    evolve.textContent = on ? "\u221E EVOLVE" : "\u23F8 STATIC";
    evolve.title = on ? "Arriving at the far end hands over: clips advance in order, library loops are drawn at random." : "The pair you chose is the pair you keep. The fader has two ends.";
  };
  paintEvolve();
  evolve.addEventListener("click", () => {
    ctx.setFlow(flowWound, drift.value, Number(speed.value), !ctx.flow().evolve, Number(pingPong.value));
    paintEvolve();
  });
  function pushFlow(wound) {
    ctx.setFlow(wound, drift.value, Number(speed.value), !!ctx.flow().evolve, Number(pingPong.value));
    following = Number(speed.value) > 0;
    flowDial.el.classList.toggle("following", following);
    showFlow();
  }
  let following = flowNow.speedBars > 0;
  flowDial.el.classList.toggle("following", following);
  const resend = () => pushFlow(flowWound);
  drift.addEventListener("change", resend);
  speed.addEventListener("change", resend);
  pingPong.addEventListener("change", resend);
  const driftLabel = el3("span", "weave-label");
  driftLabel.textContent = "Drift";
  const speedLabel = el3("span", "weave-label");
  speedLabel.textContent = "Speed";
  const pingPongLabel = el3("span", "weave-label");
  pingPongLabel.textContent = "Journey";
  const ROMAN = ["i", "II", "III", "iv", "v", "VI", "VII"];
  const chordWrap = el3("div", "weave-chordbar");
  const chordFill = el3("span", "weave-chordbar-fill");
  const chordOut = el3("span", "weave-chordbar-text");
  chordWrap.append(chordFill, chordOut);
  const paintChord = () => {
    const now = ctx.chordNow();
    const walking = !!now && now.bars > 1;
    chordWrap.classList.toggle("idle", !walking);
    if (!now) {
      chordOut.textContent = "";
      chordFill.style.width = "0%";
      return;
    }
    chordFill.style.width = `${(now.bar + 1) / now.bars * 100}%`;
    chordOut.textContent = walking ? `${now.bar + 1}/${now.bars} \xB7 ${ROMAN[now.degree] ?? now.degree}` : "home";
  };
  paintChord();
  flowRow.append(
    flowLabel,
    flowDial.el,
    flowOut,
    driftLabel,
    drift,
    speedLabel,
    speed,
    // AFTER evolve, not beside the speed. Reasoning it out as "how long a lap
    // takes, and how many laps" put two unlabelled-looking dropdowns side by
    // side and read as one control with two halves — reported as confusing, and
    // it is: Speed is a TEMPO and this is a SHAPE.
    //
    // Its real neighbour is EVOLVE, because both answer what happens at the END
    // of a lap — one draws something new, the other decides whether the lane
    // ever comes back for it.
    evolve,
    pingPongLabel,
    pingPong,
    chordWrap
  );
  const chordStrip = el3("div", "weave-chords");
  const paintChords = () => {
    chordStrip.textContent = "";
    const track = ctx.chordTrack();
    const total = track.reduce((n, c) => n + c.bars, 0) || 1;
    track.forEach((c, i) => {
      const cell = el3("div", "weave-chord-cell");
      cell.textContent = ROMAN[c.degree] ?? String(c.degree);
      cell.style.flexGrow = String(c.bars);
      cell.title = `${c.bars} bar${c.bars === 1 ? "" : "s"} \u2014 click to change the chord, drag the right edge to lengthen`;
      cell.addEventListener("click", () => {
        ctx.setChordDegree(i, (c.degree + 1) % ROMAN.length);
        paintChords();
      });
      const grip = el3("div", "weave-chord-grip");
      grip.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        e.preventDefault();
        const startX = e.clientX;
        const startBars = c.bars;
        const perBar = chordStrip.clientWidth / total;
        const move = (m) => {
          ctx.setChordBars(i, startBars + (m.clientX - startX) / perBar);
          paintChords();
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      });
      cell.appendChild(grip);
      const kill = el3("button", "weave-chord-kill");
      kill.type = "button";
      kill.textContent = "\xD7";
      kill.title = "Remove this chord";
      kill.addEventListener("click", (e) => {
        e.stopPropagation();
        ctx.removeChord(i);
        paintChords();
      });
      cell.appendChild(kill);
      chordStrip.appendChild(cell);
    });
    const add2 = el3("button", "weave-chord-add");
    add2.type = "button";
    add2.textContent = "+";
    add2.title = "Add a chord at the end";
    add2.addEventListener("click", () => {
      ctx.insertChordAfter(ctx.chordTrack().length - 1);
      paintChords();
    });
    chordStrip.appendChild(add2);
    progSel.value = ctx.isCustomProgression() ? CUSTOM : ctx.progression();
  };
  paintChords();
  const lanes = el3("div", "weave-lanes");
  const head2 = el3("div", "weave-lane weave-lane-head");
  for (const label of [
    "",
    "",
    "Lane",
    "",
    "Level",
    "Topology",
    "Loops",
    "Sound"
  ]) {
    const c = el3("span", "weave-col");
    c.textContent = label;
    head2.appendChild(c);
  }
  lanes.appendChild(head2);
  const engineChoices = ctx.engines();
  const laneRows = ctx.lanes().map((lane) => buildLaneRow(lane, ctx, engineChoices));
  for (const r of laneRows) lanes.appendChild(r.el);
  const addRow = el3("div", "weave-empty");
  if (laneRows.length === 0) {
    head2.remove();
    const msg = el3("p", "");
    msg.textContent = "Nothing to weave yet.";
    addRow.appendChild(msg);
  }
  const addWhat = pick("weave-add-engine", engineChoices, "subtractive");
  addWhat.setAttribute("aria-label", "Instrument for the new track");
  const add = el3("button", "weave-add");
  add.textContent = "+ Weaving track";
  add.title = "Add a track already weaving two loops from the library";
  add.addEventListener("click", () => {
    ctx.addLane(addWhat.value);
  });
  addRow.append(add, addWhat);
  lanes.appendChild(addRow);
  const stepsRow = buildStepRack(ctx);
  const macros = el3("div", "weave-macros");
  for (const m of MACROS) {
    const knob = macroKnob(m, ctx);
    macros.appendChild(knob.el);
    repaintMacros.push(knob.paint);
  }
  rack.append(head, pulse, flowRow, chordStrip, lanes, stepsRow, macros);
  host.appendChild(rack);
  let raf = 0;
  let lastStep = -1;
  let lastChordBar = -1;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  const SILENT = { state: "silent", frac: 0, bars: 0, centerText: "" };
  const frame = (now = performance.now()) => {
    raf = requestAnimationFrame(frame);
    const phase = ctx.bypassed() ? -1 : ctx.barPhase();
    for (const l of laneRows) l.followWeave(phase);
    for (const l of laneRows) l.meter.set(ctx.laneLevelNow(l.laneId), now);
    if (phase < 0) {
      if (lastStep !== -1) {
        lastStep = -1;
        for (const c of cells) c.classList.remove("on");
        for (const l of laneRows) l.ring.set(SILENT);
        rack.style.removeProperty("--weave-pulse");
      }
      return;
    }
    for (const l of laneRows) l.ring.set(ctx.loopPhase(l.laneId));
    if (following) {
      const pos = ctx.flow().position;
      if (Math.abs(pos - flowDial.shown()) >= 5e-3) {
        flowDial.set(pos);
        showFlow();
      }
    }
    const chordBar = ctx.chordNow()?.bar ?? -1;
    if (chordBar !== lastChordBar) {
      lastChordBar = chordBar;
      paintChord();
    }
    const step = Math.floor(phase * 16) % 16;
    if (step !== lastStep) {
      lastStep = step;
      cells.forEach((c, i) => c.classList.toggle("on", i === step));
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
