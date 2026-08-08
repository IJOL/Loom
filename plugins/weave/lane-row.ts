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
  /** Move the weaving control to where the lane's position now sits, without
   *  writing back. Called from the same rAF while the master flow is
   *  travelling: the host owns the position then and the row FOLLOWS it. */
  followWeave(): void;
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

  if (current === undefined || !choices.some((c) => c.id === current)) {
    const o = el('option', undefined, '—') as HTMLOptionElement;
    o.value = '';
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
  const corners = el('div', 'weave-corners');
  for (let i = 0; i < 4; i++) {
    corners.appendChild(slot(i, sel.corners[i] ?? '', (id) => ({
      ...sel,
      corners: sel.corners.map((c, k) => (k === i ? id : c)),
    })));
  }
  const pad = Loom.controls.pad2d({
    x: sel.x,
    y: sel.y,
    label: 'Weave position between the four loops',
    onChange: (x, y) => { ctx.setLaneWeave(laneId, { ...sel, x, y }); },
  });
  cell.append(corners, pad.el);
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

  const syncTransport = () => {
    const t = ctx.laneTransport(lane.id);
    play.classList.toggle('on', t.playing);
    stop.disabled = !t.playing;
    mute.classList.toggle('on', t.muted);
    solo.classList.toggle('on', t.soloed);
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
  return {
    laneId: lane.id, el: row, led, ring, syncTransport,
    // Called from the panel's rAF while the master flow is travelling: the host
    // owns the position then, and the row FOLLOWS it. Without this the lanes sat
    // at whatever they were built with while the music crossed away underneath.
    followWeave: () => cell.follow?.(),
  };
}
