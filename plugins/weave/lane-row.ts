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

import { CLOUD_PATHS } from '@loom/plugin-sdk';
import type { PanelChoice, PanelContext, PanelLoopPhase, PanelWeave } from '@loom/plugin-sdk';
import { endlessDial } from './endless-dial';

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

/** The topologies a lane can be PUT on.
 *
 *  A dropdown and not a row of buttons, for the reason the empty entry is here
 *  at all: three buttons could only ever turn weaving ON. Once a lane was
 *  weaving there was no way back to it simply playing its clip — the one thing
 *  every other control on this row can be undone into.
 *
 *  QUEUE is deliberately absent. The topology still exists, still resolves and
 *  still plays: a saved lane on it keeps working and the row shows it. It is
 *  just not offered any more — a cursor over an ordered list is a playlist, and
 *  the two that earn their place are the ones that travel on their own. */
const TOPOS: { kind: PanelWeave['kind']; label: string; title: string }[] = [
  { kind: 'ab', label: 'A→B', title: 'Two loops. Arrive at B and a fresh B is drawn — the journey never ends.' },
  { kind: 'cloud', label: 'Cloud', title: 'Four loops at the corners of a square. Best on melodic material.' },
];

/** What every topology is named when a lane is on it — the retired one
 *  included, so a row can say what it is playing even when it can no longer be
 *  chosen. A dropdown that showed a dash for a lane that IS weaving would be
 *  the same lie the loop pickers were fixed for. */
const TOPO_NAME: Record<PanelWeave['kind'], string> = {
  ab: 'A→B', queue: 'Queue', cloud: 'Cloud',
};

const OFF = '';
const OFF_LABEL = '— off —';

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
  // Named by ROLE rather than by position, because the pair is drawn in the
  // order that makes the dial honest and that is not the order it is stored in.
  // "Loop 1 / Loop 2" read off the screen would name them the wrong way round.
  const SLOT_LABEL = ['Loop this lane travels FROM', 'Loop this lane travels TO'];
  const slot = (i: number, current: string, apply: (id: string) => PanelWeave) =>
    picker('weave-slot', SLOT_LABEL[i] ?? `Loop ${i + 1}`, loops, current, (id) => {
      ctx.setLaneWeave(laneId, apply(id));
      onChanged();
    });

  if (sel.kind === 'ab') {
    // The loop names ARE the pickers, one at each end of the dial. A separate
    // label plus a separate dropdown would say the same thing twice in a row
    // that has no room to say anything twice.
    //
    // A DIAL rather than a fader, for the same reason the master flow is one:
    // a linear control promises two ends, and with the scene evolving there are
    // none — arriving hands over and the leg starts again. The names stay put
    // either side as from → to, and the ring says how far across you are.
    const fader = endlessDial({
      value: sel.x,
      label: `Weave position between ${nameOf(sel.a)} and ${nameOf(sel.b)}`,
      onChange: (v) => {
        // The dial winds past 1 and keeps counting so the HOST can tell a lap
        // from a hand turning back; a lane's stored position is always inside
        // its leg, so it takes the fraction.
        ctx.setLaneWeave(laneId, { ...sel, x: ((v % 1) + 1) % 1 });
      },
      size: 40,
    });

    // B on the LEFT and A on the right, which reads backwards and is the only
    // arrangement that tells the truth.
    //
    // The dial's tick leaves twelve o'clock and turns clockwise, so at a
    // quarter of the way round it points RIGHT and at three quarters it points
    // LEFT. With A on the left you are mostly hearing A while the tick aims at
    // B, and mostly hearing B while it aims at A: for almost the whole journey
    // the needle indicates the loop you are leaving. Reported exactly that way
    // — make the wheel point at the loop that sounds.
    //
    // Swapping the two ends fixes it without touching the dial: a quarter round
    // now points at A, which is what is mostly sounding, and three quarters
    // points at B. The pair is still stored a → b; only where they are drawn
    // changed.
    cell.append(
      slot(1, sel.b, (id) => ({ ...sel, b: id })),
      fader.el,
      slot(0, sel.a, (id) => ({ ...sel, a: id })),
    );
    return {
      el: cell,
      follow: () => {
        const now = ctx.laneWeave(laneId);
        // Only while the pointer is elsewhere: writing the value under a drag
        // fights the hand that is holding it.
        if (!now || fader.held()) return;
        // A completed lap re-hooks A→B onto a fresh loop, so the two NAMES
        // change and not just the position. Rebuilding is the honest response —
        // the option lists are built per style and a bare `.value =` with an id
        // they do not carry would blank the picker. Once a lap, not once a
        // frame: the ids only move when the journey comes round.
        if (now.kind === 'ab' && (now.a !== sel.a || now.b !== sel.b)) { onChanged(); return; }
        fader.set(now.x);
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

  // WHICH WAY the master flow drags the dot. A cloud needs saying because the
  // flow is one number and the cloud is two: RIM walks the four sides, so the
  // lap is a chain of clean two-loop crossfades; CROSS alternates side and
  // diagonal, touching the same corners but crossing the middle — the one point
  // where all four loops sound at once — twice a lap.
  const path = el('div', 'weave-path');
  const pathBtns = CLOUD_PATHS.map((p) => {
    const b = el('button', 'weave-topo-btn', p.label) as HTMLButtonElement;
    b.type = 'button';
    b.title = p.title;
    b.addEventListener('click', () => {
      // The POSITION is left where it is. Changing the shape of a journey
      // mid-lap must not also teleport the lane to the start of it.
      ctx.setLaneWeave(laneId, { ...sel, path: p.id });
      paintPath(p.id);
    });
    path.appendChild(b);
    return { id: p.id, b };
  });
  const paintPath = (cur: string) => {
    for (const { id, b } of pathBtns) {
      b.classList.toggle('on', id === cur);
      b.setAttribute('aria-pressed', String(id === cur));
    }
  };
  paintPath(sel.path ?? 'rim');

  const padWrap = el('div', 'cn-pad');
  padWrap.append(pad.el, path);
  cloud.append(pickers[0], padWrap, pickers[1], pickers[2], pickers[3]);
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
  //
  // On a RACK lane they point somewhere else: at one of the two instruments
  // inside it, chosen by the 1|2 buttons beside them. The lane's own engine is
  // the rack, which ships no presets and cannot be swapped without throwing the
  // rack away — so left as they were, the two sounds a converted lane is made of
  // were reachable only from another page.
  //
  // Rebuilt rather than repainted, because `picker` builds a select from a list:
  // both the list and the current value change when the slot does.
  let slot = 0;
  const engineHost = el('div', 'weave-pick-host');
  const presetHost = el('div', 'weave-pick-host');
  const slots = el('div', 'weave-slotpick');

  const paintPickers = () => {
    const rack = ctx.laneSlots(lane.id);
    const inRack = rack.length > 1;
    if (slot >= rack.length) slot = 0;

    // The slot buttons only exist for a lane that has slots. One instrument
    // needs no "which one".
    slots.replaceChildren();
    slots.classList.toggle('off', !inRack);
    if (inRack) {
      rack.forEach((_, i) => {
        const b = el('button', `weave-slot-btn${i === slot ? ' on' : ''}`, String(i + 1)) as HTMLButtonElement;
        b.type = 'button';
        b.title = `Instrument ${i + 1} of this lane's rack — the ${i === 0 ? 'near' : 'far'} end of its sound fader`;
        b.addEventListener('click', () => { slot = i; paintPickers(); });
        slots.appendChild(b);
      });
    }

    const held = inRack ? rack[slot].engineId : lane.engineId;
    engineHost.replaceChildren(picker(
      'weave-engine',
      inRack ? `Instrument ${slot + 1} for ${lane.name}` : `Instrument for ${lane.name}`,
      inRack ? ctx.slotEngines() : engines,
      held,
      (id) => {
        if (inRack) { ctx.setLaneSlotEngine(lane.id, slot, id); paintPickers(); }
        else ctx.setEngine(lane.id, id);
      },
    ));

    // A slot remembers its preset by BARE name; the dropdown's vocabulary is
    // `engine:<name>`, which is what the lane's own picker stores verbatim. The
    // two have to be translated in both directions or the current selection can
    // never match an option — which reads as a slot playing a sound while its
    // picker says nothing is chosen.
    const chosen = inRack
      ? (rack[slot].presetName ? `engine:${rack[slot].presetName}` : undefined)
      : lane.presetId;
    engineHost.classList.toggle('in-rack', inRack);
    presetHost.replaceChildren(picker(
      'weave-preset',
      inRack ? `Preset for instrument ${slot + 1} of ${lane.name}` : `Preset for ${lane.name}`,
      ctx.presets(held),
      chosen,
      (id) => {
        const bare = id.startsWith('engine:') ? id.slice('engine:'.length) : id;
        if (inRack) { ctx.setLaneSlotPreset(lane.id, slot, bare); paintPickers(); }
        else ctx.setPreset(lane.id, id);
      },
    ));
  };
  paintPickers();

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

  // ── level ────────────────────────────────────────────────────────────────
  //
  // The same gain the mixer column shows, not a second one: balancing a weave
  // meant leaving the panel for the desk and coming back, and the whole point
  // of a track row is that the decisions about one track are in one place.
  //
  // The range comes from the host rather than being written 0..1.5 here. It is
  // the mixer's own spec, and a panel that hardcoded a top would quietly stop
  // agreeing with the desk the day that spec changed.
  const range = ctx.laneLevelRange();
  const levelWrap = el('div', 'weave-level');
  const level = document.createElement('input');
  level.type = 'range';
  level.className = 'weave-level-fader';
  level.min = String(range.min);
  level.max = String(range.max);
  // Fine enough that the fader does not step audibly, coarse enough that a drag
  // does not fire a write per pixel of a high-DPI screen.
  level.step = '0.01';
  level.value = String(ctx.laneLevel(lane.id));
  level.setAttribute('aria-label', 'Level for this track');
  const levelOut = el('span', 'weave-level-out');
  const showLevel = (v: number) => { levelOut.textContent = `${Math.round(v * 100)}%`; };
  showLevel(Number(level.value));
  level.addEventListener('input', () => {
    const v = Number(level.value);
    ctx.setLaneLevel(lane.id, v);
    showLevel(v);
  });
  levelWrap.append(level, levelOut);

  // ── sound ────────────────────────────────────────────────────────────────
  //
  // The SECOND axis, and the reason it is a separate control rather than a
  // fourth topology: the weave decides which NOTES play, this decides what they
  // are played ON, and they are independent. That is what lets loop A be heard
  // on instrument B — and what lets the sound evolve while the notes stand
  // still.
  //
  // Off by default, and off is not zero. Without it the lane routes each note
  // to the layer of the loop it came from, which is the other way of using a
  // rack and the one this panel shipped with. Turning it on switches that off:
  // every note reaches both instruments and this balances them.
  // The sound control wears the SHAPE OF THE LOOP CONTROL on the same lane: a
  // fader where the lane crosses two loops, a square where it crosses four. One
  // idea per row rather than one per panel — a hand that has learnt how this
  // lane moves has learnt both of its controls at once.
  //
  // And it EXISTS only while it is on. Off, the column collapses to the button:
  // the row is a dense thing already, and a control that is dimmed but still
  // taking its width is width nobody is using.
  const soundWrap = el('div', 'weave-sound');
  const soundOn = el('button', 'weave-sound-btn', '◐') as HTMLButtonElement;
  soundOn.type = 'button';
  const soundHost = el('div', 'weave-sound-host');

  const paintSound = () => {
    const at = ctx.laneSound(lane.id);
    const on = at !== null;
    soundOn.classList.toggle('on', on);
    soundOn.title = on
      ? 'Sound on — every note reaches every instrument in the rack'
      : 'Sound off — each note plays on the instrument of the loop it came from';
    soundOn.setAttribute('aria-pressed', String(on));
    soundWrap.classList.toggle('off', !on);

    // Rebuilt rather than repainted, because the SHAPE can change: switching
    // this lane to a cloud turns its fader into a square. Only ever from a
    // press — never from the control's own onChange — so a drag is never
    // interrupted by the thing being dragged.
    soundHost.replaceChildren();
    if (!at) return;
    if (ctx.laneWeave(lane.id)?.kind === 'cloud') {
      const p = Loom.controls.pad2d({
        x: at.x,
        y: at.y,
        label: 'Drag: how much of each of the four instruments this lane is played on',
        onChange: (x, y) => { ctx.setLaneSound(lane.id, x, y); },
      });
      p.el.classList.add('weave-sound-pad');
      soundHost.appendChild(p.el);
      return;
    }
    const fader = document.createElement('input');
    fader.type = 'range';
    fader.className = 'weave-sound-fader';
    fader.min = '0';
    fader.max = '1';
    fader.step = '0.01';
    fader.value = String(at.x);
    fader.setAttribute('aria-label', 'Which instrument this lane is played on');
    fader.addEventListener('input', () => { ctx.setLaneSound(lane.id, Number(fader.value)); });
    soundHost.appendChild(fader);
  };

  soundOn.addEventListener('click', () => {
    // Off entirely, or back at the end slot 0 is on — the instrument the lane
    // already had, so turning it on is inaudible until you move it.
    ctx.setLaneSound(lane.id, ctx.laneSound(lane.id) === null ? 0 : null, 0);
    paintSound();
    // Turning it on can have made this lane a RACK, which is what the row's
    // instrument and preset dropdowns then point at. Without this they caught up
    // whenever something else happened to repaint the panel — reported as the
    // slot buttons appearing later, for no reason you could see.
    paintPickers();
  });
  soundWrap.append(soundOn, soundHost);

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

  // What PART this lane plays. It decides which shelf the picker beside it then
  // picks a style from, which is why the two sit together.
  //
  // The host hands over the choices AND their labels, including the unmarked
  // option's — on an instrument that declares the part it is built for, that
  // option is not "no part" but "the part this instrument is", and only the host
  // knows which. An EMPTY list means the question does not apply to this lane —
  // a drum lane — and the picker renders as a disabled dash rather than
  // vanishing, so the row keeps its shape.
  const roleChoices = ctx.roleChoices(lane.id);
  const role = picker('weave-role', `Part played by ${lane.name}`, roleChoices,
    ctx.laneRole(lane.id) ?? '', (id) => {
      ctx.setLaneRole(lane.id, id || null);
      // The material moved with it — the whole point of the mark — so the loop
      // cell has to be rebuilt from the new list rather than left showing ids
      // this lane no longer reads.
      repaintCell();
    });
  if (roleChoices.length === 0) role.title = 'A drum lane plays percussion, whatever part anything says';

  const topo = document.createElement('select');
  topo.className = 'weave-topo';
  topo.setAttribute('aria-label', `How ${lane.name} weaves`);
  const off = el('option', undefined, OFF_LABEL) as HTMLOptionElement;
  off.value = OFF;
  off.title = 'Stop weaving — the lane plays its clip untouched';
  topo.appendChild(off);
  for (const t of TOPOS) {
    const o = el('option', undefined, t.label) as HTMLOptionElement;
    o.value = t.kind;
    o.title = t.title;
    topo.appendChild(o);
  }
  topo.addEventListener('change', () => {
    // OFF is a real destination, not the absence of a choice. `setLaneWeave`
    // with null is the host's own door for "play the clip untouched" — the same
    // one the sound fader uses to go back to routing by loop.
    if (topo.value === OFF) ctx.setLaneWeave(lane.id, null);
    else ctx.setLaneTopology(lane.id, topo.value as PanelWeave['kind']);
    paintTopo();
    repaintCell();
    // The sound control has the shape of THIS one, so changing it changes that:
    // a fader becomes a square and back. And a lane that just gained corners may
    // have gained instruments to put in them, which the slot buttons show.
    paintSound();
    paintPickers();
  });
  // Half time and double time for this lane alone — the one thing that lets a
  // pad sit under a beat rather than beside it.
  //
  // The phrase is always delivered whole: ×2 stretches it and it takes the room
  // it needs. These used to change only that room, which on a weaving lane you
  // could not hear at all — the fold refills whatever space there is.
  const length = el('div', 'weave-len');
  for (const [label, factor, title] of [
    ['÷2', 0.5, 'Double time: this lane plays its phrase twice as fast'],
    ['×2', 2, 'Half time: this lane stretches its phrase over twice the room'],
  ] as [string, number, string][]) {
    const b = el('button', 'weave-len-btn', label) as HTMLButtonElement;
    b.type = 'button';
    b.title = title;
    b.addEventListener('click', () => {
      ctx.setLaneTime(lane.id, factor);
      repaintCell();
    });
    length.appendChild(b);
  }

  // The REGISTER, beside the tempo, because they are the same kind of thing: two
  // ways to say "the same part, somewhere it fits" without touching a note of
  // the material. The reading sits between the buttons, because the interesting
  // state is how far from home the lane is and a control that shows nothing
  // makes you press it to find out.
  const octave = el('div', 'weave-oct');
  const octOut = el('span', 'weave-oct-out');
  const paintOct = () => {
    const v = ctx.laneOctave(lane.id);
    octOut.textContent = v === 0 ? '0' : v > 0 ? `+${v}` : String(v);
    octave.classList.toggle('off', v === 0);
  };
  for (const [label, delta, title] of [
    ['−', -1, 'Down an octave'],
    ['+', 1, 'Up an octave'],
  ] as [string, number, string][]) {
    const b = el('button', 'weave-oct-btn', label) as HTMLButtonElement;
    b.type = 'button';
    b.title = `${title} — the lane's register, never its notes`;
    b.addEventListener('click', () => {
      ctx.setLaneOctave(lane.id, delta);
      paintOct();
      repaintCell();
    });
    // The readout goes between them, so down is on the left of the number and up
    // on the right — which is the only arrangement that needs no label.
    if (delta > 0) octave.appendChild(octOut);
    octave.appendChild(b);
  }
  paintOct();

  const paintTopo = () => {
    const kind = ctx.laneWeave(lane.id)?.kind;
    // A lane on a topology this list no longer offers — a saved QUEUE — gets
    // its own entry rather than falling back to OFF, which would claim the lane
    // is playing its clip while it is audibly weaving.
    if (kind && !TOPOS.some((t) => t.kind === kind) && !topo.querySelector(`option[value="${kind}"]`)) {
      const o = el('option', undefined, TOPO_NAME[kind]) as HTMLOptionElement;
      o.value = kind;
      o.title = 'Retired: still plays, no longer offered';
      topo.appendChild(o);
    }
    topo.value = kind ?? OFF;
  };
  paintTopo();
  repaintCell();
  // After the topology is known: the sound control's shape is read off it.
  paintSound();

  // The lane in TWO lines, split by what you do with a control rather than by
  // what it controls.
  //
  // Up here, only what a hand reaches for while the music is running: the lamp,
  // the position, the name, the transport, the LEVEL, the topology, the loops
  // and the sound fader. Everything up here got wider for it — the level fader
  // was 44px, which is nine steps of a percentage, and is now 88.
  row.append(led, ring.el, name, transport, levelWrap, topo, cellHost, soundWrap);

  // The bar this track is about to play, at a QUARTER of the width. It is the
  // OUTPUT, and the playhead only ever travels across it, so the other three
  // quarters of the line were empty by construction — that is where the
  // settings went.
  const strip = noteStrip(lane.id, ctx);
  const setup = el('div', 'weave-lane-setup');
  // What you set once and leave: which instrument, which preset, which part,
  // which shelf, how many bars, which octave. None of them is a gesture.
  setup.append(strip.el, slots, engineHost, presetHost, role, style, length, octave);

  const wrap = el('div', 'weave-lane-wrap');
  wrap.append(row, setup);

  return {
    laneId: lane.id, el: wrap, led, ring, syncTransport,
    // Called from the panel's rAF while the master flow is travelling: the host
    // owns the position then, and the row FOLLOWS it. Without this the lanes sat
    // at whatever they were built with while the music crossed away underneath.
    followWeave: (phase) => { cell.follow?.(); strip.draw(phase); },
  };
}
