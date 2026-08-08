// One lane in WEAVE: what it plays, what it sounds like, and — the part that
// makes this a panel rather than a readout — WHICH loops it is weaving between.
//
// The three topologies share a row because they share a contract: each produces
// a position, the host turns that into weights, and the blend never learns which
// control the user was holding. So this file only has to decide what a control
// LOOKS like, never what it means.
//
// Nothing musical is decided here. Which loops survive a change of topology is a
// rule with a home in the host (`setLaneTopology`); this file asks.

import type { PanelChoice, PanelContext, PanelLoopPhase, PanelWeave } from '@loom/plugin-sdk';

export interface LaneRowHandle {
  laneId: string;
  el: HTMLElement;
  led: HTMLElement;
  ring: { el: HTMLElement; set(phase: PanelLoopPhase): void };
  /** Repaint the transport buttons from the host. Driven by the panel's one rAF
   *  rather than by a click handler, because a lane can start or stop from the
   *  grid, from a scene launch or from a MIDI controller — none of which pass
   *  through this row. */
  syncTransport(): void;
  /** Move the weaving control to where the lane's position now sits, and redraw
   *  the bar with the playhead at `phase` (0..1, or -1 when stopped).
   *
   *  Called from the panel's one rAF, BEFORE its stopped-transport branch: the
   *  position moves with the clock stopped — the master flow, the dice, an undo
   *  — and a row that only followed while playing looked like a dead control. */
  followWeave(phase: number): void;
}

const TOPOS: { kind: PanelWeave['kind']; label: string; title: string }[] = [
  { kind: 'ab', label: 'A→B', title: 'Two loops. Arrive at B and a fresh B is drawn — the journey never ends.' },
  { kind: 'queue', label: 'Queue', title: 'A cursor over an ordered list. Finite, but walkable both ways.' },
  { kind: 'cloud', label: 'Cloud', title: 'Four loops at the corners of a square. Best on melodic material.' },
];

const el = (tag: string, cls?: string, text?: string) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

/** A readable name for a loop the current list does not offer.
 *
 *  Parsed from the id rather than looked up, because the whole situation IS "the
 *  host is not offering this one" — there is nowhere to look it up. `lib:` ids
 *  read `style:kind:index`; a clip id is shown as a clip. Split from the right:
 *  a clip id may contain colons. */
function offShelfLabel(id: string): string | undefined {
  if (id.startsWith('clip:')) return 'Another clip';
  // Only LOOP ids. This picker also draws the engine and the preset columns,
  // and inventing a name for an unknown preset would have the row claim a
  // preset the lane is not on — the very thing the dash is right about.
  if (!id.startsWith('lib:')) return undefined;
  const parts = id.split(':');
  const index = parts[parts.length - 1];
  const kind = parts[parts.length - 2];
  const style = parts.slice(1, -2).join(':');
  return `${style} ${kind} #${Number(index) + 1}`;
}

/** A dropdown of host-supplied choices, with `current` selected.
 *
 *  A lane whose current value the host cannot name gets no selection rather than
 *  a wrong one: the browser would otherwise default to the first option and the
 *  row would claim a preset the lane is not on. */
export function picker(
  cls: string, label: string, choices: PanelChoice[],
  current: string | undefined, onPick: (id: string) => void,
): HTMLSelectElement {
  const sel = document.createElement('select');
  sel.className = cls;
  sel.setAttribute('aria-label', label);

  if (choices.length === 0) {
    // An engine that ships no presets — or a lane with no clips — gets a
    // disabled dash rather than an empty box, which reads as broken.
    sel.appendChild(el('option', undefined, '—'));
    sel.disabled = true;
    return sel;
  }

  const offered = current !== undefined && choices.some((c) => c.id === current);
  if (!offered) {
    // A dash means NOTHING IS CHOSEN. When something IS chosen and merely is not
    // on the shelf this list shows — a lane pointed at another style, a save from
    // a session with other clips — the dash was a lie: the loop went on playing
    // while four pickers read as empty. Show it, marked as off-shelf.
    const named = current ? offShelfLabel(current) : undefined;
    const o = el('option', undefined, named ?? '—') as HTMLOptionElement;
    o.value = named ? current! : '';
    o.selected = true;
    sel.appendChild(o);
  }
  // Grouped when the host says so. The pattern library runs to hundreds of
  // entries per style, and a flat run of names is a list nobody reads.
  const groups = new Map<string, HTMLElement>();
  for (const c of choices) {
    const o = el('option', undefined, c.name) as HTMLOptionElement;
    o.value = c.id;
    if (c.id === current) o.selected = true;
    if (!c.group) { sel.appendChild(o); continue; }
    let g = groups.get(c.group);
    if (!g) {
      g = document.createElement('optgroup');
      (g as HTMLOptGroupElement).label = c.group;
      groups.set(c.group, g);
      sel.appendChild(g);
    }
    g.appendChild(o);
  }
  sel.addEventListener('change', () => { if (sel.value) onPick(sel.value); });
  return sel;
}

/** The fader, the queue or the pad — whichever this lane's topology calls for.
 *
 *  Rebuilt rather than mutated when the topology changes: three controls with
 *  three shapes have nothing to diff, and the alternative is a cell that
 *  remembers which widgets it once held. */
interface WeaveCell {
  el: HTMLElement;
  /** Move the control to where the lane's selection now sits, WITHOUT writing
   *  back. The master flow moves lane positions from the host's clock, and a
   *  cell that only ever showed the value it was built with would sit still
   *  while the music travelled. */
  follow?: () => void;
}

function weaveCell(
  laneId: string, ctx: PanelContext, loops: PanelChoice[], onChanged: () => void,
): WeaveCell {
  const cell = el('div', 'weave-cell');
  const sel = ctx.laneWeave(laneId);

  if (!sel) {
    cell.appendChild(el('span', 'weave-hint', loops.length === 0
      ? 'No clips on this lane yet'
      : 'Pick a topology to start weaving'));
    return { el: cell };
  }

  const nameOf = (id: string) => loops.find((l) => l.id === id)?.name ?? id;
  const slot = (i: number, current: string, apply: (id: string) => PanelWeave) =>
    picker('weave-slot', `Loop ${i + 1} for this lane`, loops, current, (id) => {
      ctx.setLaneWeave(laneId, apply(id));
      onChanged();
    });

  if (sel.kind === 'ab') {
    // The loop names ARE the pickers, one at each end of the fader. A separate
    // label plus a separate dropdown would say the same thing twice in a row
    // that has no room to say anything twice.
    const fader = document.createElement('input');
    fader.type = 'range';
    fader.min = '0';
    fader.max = '1';
    fader.step = '0.001';
    fader.value = String(sel.x);
    fader.className = 'weave-fader';
    fader.setAttribute('aria-label', `Weave position between ${nameOf(sel.a)} and ${nameOf(sel.b)}`);
    fader.addEventListener('input', () => {
      ctx.setLaneWeave(laneId, { ...sel, x: Number(fader.value) });
    });

    cell.append(
      slot(0, sel.a, (id) => ({ ...sel, a: id })),
      fader,
      slot(1, sel.b, (id) => ({ ...sel, b: id })),
    );
    return {
      el: cell,
      follow: () => {
        const now = ctx.laneWeave(laneId);
        // Only while the pointer is elsewhere: writing .value under a drag
        // fights the hand that is holding it.
        if (!now || document.activeElement === fader) return;
        // A completed lap re-hooks A→B onto a fresh loop, so the two NAMES
        // change and not just the position. Rebuilding is the honest response —
        // the option lists are built per style and a bare `.value =` with an id
        // they do not carry would blank the picker. Once a lap, not once a
        // frame: the ids only move when the journey comes round.
        if (now.kind === 'ab' && (now.a !== sel.a || now.b !== sel.b)) { onChanged(); return; }
        if (Math.abs(now.x - Number(fader.value)) >= 0.002) fader.value = String(now.x);
      },
    };
  }

  if (sel.kind === 'queue') {
    // The queue is the lane's own list in order, so there is nothing to pick —
    // only somewhere to be in it. The caption names the pair the cursor sits
    // between, which is the one thing the dots cannot say.
    const between = el('span', 'weave-between');
    const q = Loom.controls.queue({
      length: Math.max(1, sel.loops.length),
      value: sel.x,
      label: 'Position in the queue',
      onChange: (v) => {
        ctx.setLaneWeave(laneId, { ...sel, x: v });
        paintBetween(v);
      },
    });
    const paintBetween = (x: number) => {
      const n = sel.loops.length;
      if (n < 2) { between.textContent = n === 1 ? nameOf(sel.loops[0]) : '—'; return; }
      const pos = Math.min(n - 2, Math.floor(Math.min(1, Math.max(0, x)) * (n - 1)));
      between.textContent = `${nameOf(sel.loops[pos])} → ${nameOf(sel.loops[pos + 1])}`;
    };
    paintBetween(sel.x);
    cell.append(q.el, between);
    let shown = sel.x;
    return {
      el: cell,
      follow: () => {
        const now = ctx.laneWeave(laneId);
        if (!now || Math.abs(now.x - shown) < 0.002) return;
        shown = now.x;
        q.set(now.x);
        paintBetween(now.x);
      },
    };
  }

  // Cloud: four corners round a pad, laid out where they actually are. A list of
  // four names beside the box would leave the user matching names to corners by
  // counting.
  // Each picker sits AT its corner, with the pad between them. A 2x2 block of
  // dropdowns beside the box was the first arrangement and it left the user
  // matching names to corners by counting — which is most of why the cloud read
  // as incomprehensible.
  const AT = ['cn-tl', 'cn-tr', 'cn-bl', 'cn-br'];
  const cloud = el('div', 'weave-cloud');
  const pickers = Array.from({ length: 4 }, (_, i) => {
    const p = slot(i, sel.corners[i] ?? '', (id) => ({
      ...sel,
      corners: sel.corners.map((c, k) => (k === i ? id : c)),
    }));
    p.classList.add(AT[i]);
    return p;
  });
  const pad = Loom.controls.pad2d({
    x: sel.x,
    y: sel.y,
    label: 'Drag: how much of each of the four loops is playing',
    onChange: (x, y) => { ctx.setLaneWeave(laneId, { ...sel, x, y }); },
  });
  pad.el.classList.add('cn-pad');
  cloud.append(pickers[0], pad.el, pickers[1], pickers[2], pickers[3]);
  cell.appendChild(cloud);
  let at = { x: sel.x, y: sel.y };
  return {
    el: cell,
    follow: () => {
      const now = ctx.laneWeave(laneId);
      if (!now || now.kind !== 'cloud') return;
      if (Math.abs(now.x - at.x) < 0.002 && Math.abs(now.y - at.y) < 0.002) return;
      at = { x: now.x, y: now.y };
      pad.set(now.x, now.y);
    },
  };
}

/** The bar this lane is about to play, drawn.
 *
 *  The panel's whole argument is that a crossfade between two loops produces a
 *  THIRD bar that is in neither — and until this existed you could read the
 *  names of the two inputs and never see the output. A rack of dropdowns for an
 *  instrument about transformation is a form.
 *
 *  Colour is the ORIGIN, which is the point: watch a hit change colour and you
 *  have watched the handover happen, in the order the blend decides it — weak
 *  positions first, the downbeat last. The number on the fader says the same
 *  thing and says it to nobody.
 *
 *  Canvas, not elements: this redraws whenever the fader moves, and a bar can
 *  hold thirty notes across eight lanes. */
function noteStrip(
  laneId: string, ctx: PanelContext,
): { el: HTMLCanvasElement; draw: (phase: number) => void } {
  const cv = document.createElement('canvas');
  cv.className = 'weave-bar';
  cv.setAttribute('aria-label', 'The bar this track is about to play');

  // What the last draw showed. Redrawing costs nothing per frame until there are
  // eight lanes, and comparing is cheaper than drawing.
  let sig = '';

  const draw = (phase: number) => {
    const notes = ctx.laneNotes(laneId);
    // The playhead moves every frame, so it goes in the signature: a bar that
    // draws the notes and not the head is a picture, and the panel is already
    // accused of being a form. Quantised to a hundredth of a bar — finer than
    // the eye and coarse enough that a still bar is still a compare.
    const head = phase < 0 ? -1 : Math.round(phase * 100);
    const next = `${head}|` + notes.map((n) => `${n.at.toFixed(3)}:${n.midi}:${n.from ?? '-'}`).join(',');
    const w = cv.clientWidth, h = cv.clientHeight;
    if (next === sig && cv.width === Math.round(w * devicePixelRatio)) return;
    sig = next;
    if (w === 0 || h === 0) return;

    cv.width = Math.round(w * devicePixelRatio);
    cv.height = Math.round(h * devicePixelRatio);
    const g = cv.getContext('2d');
    if (!g) return;
    g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    g.clearRect(0, 0, w, h);

    // Beat lines first, so the drawing is readable as a BAR and not as a row of
    // marks: without them there is no telling a downbeat from an offbeat, which
    // is exactly what the handover order is about.
    g.strokeStyle = 'rgba(255,255,255,0.07)';
    g.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const x = Math.round((i / 4) * w) + 0.5;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
    }

    // The playhead. One line, drawn under the notes so it never hides a hit —
    // and the only thing here that moves by itself, which is what tells you at a
    // glance that the drawing is live rather than a diagram.
    if (phase >= 0) {
      g.fillStyle = 'rgba(255,255,255,0.10)';
      g.fillRect(0, 0, phase * w, h);
      g.strokeStyle = 'var(--amber)';
      g.strokeStyle = '#ffb02e';
      g.beginPath();
      g.moveTo(Math.round(phase * w) + 0.5, 0);
      g.lineTo(Math.round(phase * w) + 0.5, h);
      g.stroke();
    }

    if (notes.length === 0) return;

    // Pitch fills the height, with a floor under the span so a one-note loop
    // does not draw a bar-wide slab across the middle.
    let lo = Infinity, hi = -Infinity;
    for (const n of notes) { if (n.midi < lo) lo = n.midi; if (n.midi > hi) hi = n.midi; }
    const span = Math.max(12, hi - lo);
    const mid = (lo + hi) / 2;
    const top = mid + span / 2;

    // Scaled to whatever height the strip has been given, so the same drawing
    // serves both the compact row and the expanded one without a second code
    // path deciding what "small" looks like.
    const PAD = Math.max(2, Math.round(h * 0.1));
    const NOTE_H = Math.max(2, Math.round(h * 0.09));
    for (const n of notes) {
      const x = n.at * w;
      const wdt = Math.max(2, n.length * w - 1);
      const y = PAD + ((top - n.midi) / span) * (h - PAD * 2 - NOTE_H);
      // Origin decides the hue; velocity decides how present it looks. Loop A
      // amber, loop B blue — the two the eye separates fastest at this size.
      const hue = n.from === undefined ? 40 : [40, 205, 300, 120][n.from % 4];
      const a = 0.35 + 0.65 * Math.min(1, n.velocity / 110);
      g.fillStyle = `hsla(${hue}, 85%, 60%, ${a})`;
      g.fillRect(x, y, wdt, NOTE_H);
    }
  };

  return { el: cv, draw };
}

export function buildLaneRow(
  lane: { id: string; name: string; engineId: string; presetId?: string },
  ctx: PanelContext,
  engines: PanelChoice[],
): LaneRowHandle {
  const row = el('div', 'weave-lane');
  const led = el('span', 'weave-led');
  const ring = Loom.controls.loopRing({ label: `Loop position for ${lane.name}` });
  const name = el('span', 'weave-lane-name', lane.name);

  // Instrument and preset go through the HOST's own doors, so a change made here
  // behaves — and undoes — exactly like the same change made in the Session grid.
  const engine = picker('weave-engine', `Instrument for ${lane.name}`, engines, lane.engineId,
    (id) => ctx.setEngine(lane.id, id));
  const preset = picker('weave-preset', `Preset for ${lane.name}`, ctx.presets(lane.engineId),
    lane.presetId, (id) => ctx.setPreset(lane.id, id));

  // ── transport: play, stop, mute, solo ────────────────────────────────────
  //
  // All four go through the HOST's own seams. Launch is the grid's launch, so a
  // lane started here lands on the same bar line as one started there; mute and
  // solo are the mixer's own tables by reference, so these are literally the
  // desk's two buttons rather than a second pair that can disagree with it.
  const transport = el('div', 'weave-transport');
  const tbtn = (cls: string, text: string, title: string, on: () => void) => {
    const b = el('button', `weave-tbtn ${cls}`, text) as HTMLButtonElement;
    b.type = 'button';
    b.title = title;
    b.addEventListener('click', on);
    transport.appendChild(b);
    return b;
  };
  const play = tbtn('play', '▶', 'Launch this track', () => {
    ctx.setLanePlaying(lane.id, true);
    syncTransport();
  });
  const stop = tbtn('stop', '■', 'Stop this track', () => {
    ctx.setLanePlaying(lane.id, false);
    syncTransport();
  });
  const mute = tbtn('mute', 'M', 'Silence it without losing its place in the bar', () => {
    ctx.setLaneMuted(lane.id, !ctx.laneTransport(lane.id).muted);
    syncTransport();
  });
  const solo = tbtn('solo', 'S', 'Solo — the mixer\'s own, not a second one', () => {
    ctx.setLaneSoloed(lane.id, !ctx.laneTransport(lane.id).soloed);
    syncTransport();
  });
  // The way to keep one part STILL while the rest of the scene travels. Beside
  // mute and solo because it is the same kind of decision — what this one track
  // does while the others carry on — and not a property of the weaving control,
  // which is why it survives switching topology.
  const lock = tbtn('lock', '🔒', 'Hold this track where it is — the flow moves everything else', () => {
    ctx.setLaneLocked(lane.id, !ctx.laneLocked(lane.id));
    syncTransport();
  });

  const syncTransport = () => {
    const t = ctx.laneTransport(lane.id);
    play.classList.toggle('on', t.playing);
    stop.disabled = !t.playing;
    mute.classList.toggle('on', t.muted);
    solo.classList.toggle('on', t.soloed);
    lock.classList.toggle('on', ctx.laneLocked(lane.id));
  };
  syncTransport();

  // Re-read on every repaint, never captured: the style picker below changes
  // which shelf of the library this lane draws from, and a captured list would
  // keep offering the loops of the style the user just left.
  const cellHost = el('div', 'weave-cell-host');
  let cell: WeaveCell = { el: cellHost };
  const repaintCell = () => {
    cell = weaveCell(lane.id, ctx, ctx.loops(lane.id), repaintCell);
    cellHost.replaceChildren(cell.el);
  };

  // Which shelf of the pattern library this lane reads. It is the reason the
  // panel exists: hundreds of named loops per style is a great deal more to
  // fade between than whatever happens to be sitting in the grid.
  const style = picker('weave-style', `Loop style for ${lane.name}`, ctx.styles(),
    ctx.laneStyle(lane.id), (id) => {
      ctx.setLaneStyle(lane.id, id);
      repaintCell();
    });

  const topo = el('div', 'weave-topo');
  const buttons = TOPOS.map((t) => {
    const b = el('button', 'weave-topo-btn', t.label) as HTMLButtonElement;
    b.type = 'button';
    b.title = t.title;
    b.addEventListener('click', () => {
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
      b.classList.toggle('on', k === kind);
      b.setAttribute('aria-pressed', String(k === kind));
    }
  };
  paintTopo();
  repaintCell();

  row.append(led, ring.el, name, transport, engine, preset, style, topo, cellHost);

  // The bar, under the controls and across the whole row. A second line rather
  // than a tenth column because it is the OUTPUT and the row above it is the
  // input: reading it as another setting is exactly the wrong shape.
  const strip = noteStrip(lane.id, ctx);
  const wrap = el('div', 'weave-lane-wrap');
  wrap.append(row, strip.el);

  return {
    laneId: lane.id, el: wrap, led, ring, syncTransport,
    // Called from the panel's rAF while the master flow is travelling: the host
    // owns the position then, and the row FOLLOWS it. Without this the lanes sat
    // at whatever they were built with while the music crossed away underneath.
    followWeave: (phase) => { cell.follow?.(); strip.draw(phase); },
  };
}
