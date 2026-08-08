// plugins/weave/main.ts — the panel that weaves the scene, and the first Loom
// plugin that is a screen rather than a sound.
//
// It owns a DOM zone and nothing else. Everything it needs to read or change
// arrives through the PanelContext the host hands to mount; every control it
// draws comes from Loom.controls. That split is the whole point: the host still
// owns the drawing, so this file can arrange controls but cannot paint their
// internals, and the blast radius of a mistake here is its own tab.
//
// There is no manifest in this file. The host already read and validated the
// one on disk.

import type { PanelContext, PanelLoopPhase } from '@loom/plugin-sdk';
import { buildLaneRow } from './lane-row';

/** The six macros, in the order the panel shows them. Colours match the knob
 *  palette the rest of Loom uses, so a WEAVE knob reads as a Loom knob. */
const MACROS = [
  { id: 'density', label: 'Density', color: 'var(--knob-cyan)' },
  { id: 'energy', label: 'Energy', color: 'var(--knob-yellow)' },
  { id: 'darkness', label: 'Darkness', color: 'var(--knob-purple)' },
  { id: 'space', label: 'Space', color: 'var(--knob-blue)' },
  { id: 'motion', label: 'Motion', color: 'var(--knob-orange)' },
  { id: 'styleMix', label: 'Style mix', color: 'var(--knob-red)' },
];

// The arc opens at the BOTTOM: 225 degrees clockwise from twelve, sweeping 270.
// Drawing it from 135 puts the gap on top and the knob reads upside down.
const R = 22, CX = 29, CY = 29, SWEEP = 270, START = 225;

function polar(deg: number, radius: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [CX + radius * Math.cos(rad), CY + radius * Math.sin(rad)];
}

function arcPath(frac: number): string {
  const [x0, y0] = polar(START, R);
  const [x1, y1] = polar(START + SWEEP * frac, R);
  const large = SWEEP * frac > 180 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${R} ${R} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

const svg = (tag: string) => document.createElementNS('http://www.w3.org/2000/svg', tag);
const el = (tag: string, cls?: string) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
};

/** One macro knob. The pointer lives INSIDE the hub, centre to rim, where it is
 *  readable — drawn out in the ring it disappears under the arc. */
function macroKnob(spec: typeof MACROS[number], ctx: PanelContext): { el: HTMLElement; paint: () => void } {
  const wrap = el('div', 'weave-macro');

  const s = svg('svg');
  s.setAttribute('viewBox', '0 0 58 58');
  s.setAttribute('role', 'slider');
  s.setAttribute('tabindex', '0');
  s.setAttribute('aria-label', spec.label);
  s.setAttribute('aria-valuemin', '0');
  s.setAttribute('aria-valuemax', '1');

  const track = svg('path');
  track.setAttribute('class', 'knob-track');
  track.setAttribute('d', arcPath(1));

  const arc = svg('path');
  arc.setAttribute('class', 'knob-arc');
  arc.setAttribute('style', `stroke:${spec.color}`);

  const hub = svg('circle');
  hub.setAttribute('class', 'knob-hub');
  hub.setAttribute('cx', String(CX));
  hub.setAttribute('cy', String(CY));
  hub.setAttribute('r', '11');

  const tick = svg('line');
  tick.setAttribute('class', 'knob-tick');

  s.append(track, arc, hub, tick);

  const name = el('span', 'mname');
  name.textContent = spec.label;
  const val = el('span', 'mval');

  const paint = () => {
    const v = ctx.macro(spec.id);
    arc.setAttribute('d', arcPath(v));
    const [x1, y1] = polar(START + SWEEP * v, 3);
    const [x2, y2] = polar(START + SWEEP * v, 10);
    tick.setAttribute('x1', x1.toFixed(2));
    tick.setAttribute('y1', y1.toFixed(2));
    tick.setAttribute('x2', x2.toFixed(2));
    tick.setAttribute('y2', y2.toFixed(2));
    val.textContent = v.toFixed(2).replace('.', ',');
    s.setAttribute('aria-valuenow', v.toFixed(2));
  };
  paint();

  let lastY = 0;
  s.addEventListener('pointerdown', (e) => {
    lastY = (e as PointerEvent).clientY;
    const id = (e as PointerEvent).pointerId;
    if (typeof id === 'number' && s.setPointerCapture) {
      try { s.setPointerCapture(id); } catch { /* capture is a nicety, not a requirement */ }
    }
  });
  s.addEventListener('pointermove', (e) => {
    const ev = e as PointerEvent;
    if (!ev.buttons) return;
    // 180 px of travel spans the whole range: fine enough to place a value,
    // coarse enough to cross it in one gesture.
    ctx.setMacro(spec.id, ctx.macro(spec.id) + (lastY - ev.clientY) / 180);
    lastY = ev.clientY;
    paint();
  });
  s.addEventListener('keydown', (e) => {
    const k = (e as KeyboardEvent).key;
    const d = k === 'ArrowUp' || k === 'ArrowRight' ? 0.05
      : k === 'ArrowDown' || k === 'ArrowLeft' ? -0.05 : 0;
    if (!d) return;
    e.preventDefault();
    ctx.setMacro(spec.id, ctx.macro(spec.id) + d);
    paint();
  });

  wrap.append(s, name, val);
  return { el: wrap, paint };
}

export function mountWeave(host: HTMLElement, ctx: PanelContext): () => void {
  const rack = el('div', 'weave-rack');

  // ── header ───────────────────────────────────────────────────────────────
  const head = el('div', 'weave-head');
  const logo = el('span', 'weave-logo');
  logo.textContent = 'WEAVE';
  // A HELD button, not a toggle. Roland puts Scatter and Step Loop on held
  // buttons because a momentary gesture needs no "return to previous" state
  // machine, no undo entry and no memory of what the user meant: the release IS
  // the restore. It is what turns a rack of sliders into something you play.
  const surge = el('button', 'weave-surge');
  surge.textContent = 'SURGE';
  surge.title = 'Hold: everything at full. Release: exactly as it was.';

  const held = new Map<string, number>();
  const SURGE_TARGETS = [
    { id: 'density', value: 1 },
    { id: 'energy', value: 1 },
    { id: 'motion', value: 1 },
  ];
  // Repaints the knobs and NOTHING else. ctx.refresh() would remount the whole
  // panel — including this very button, mid-gesture, destroying the element the
  // pointer is still held on and losing its "held" look with it.
  const repaintMacros: Array<() => void> = [];
  const press = () => {
    if (held.size) return;          // a second press would snapshot the gesture
    for (const t of SURGE_TARGETS) held.set(t.id, ctx.macro(t.id));
    for (const t of SURGE_TARGETS) ctx.setMacro(t.id, t.value);
    surge.classList.add('held');
    for (const p of repaintMacros) p();
  };
  const release = () => {
    if (!held.size) return;
    for (const [id, v] of held) ctx.setMacro(id, v);
    held.clear();
    surge.classList.remove('held');
    for (const p of repaintMacros) p();
  };
  surge.addEventListener('pointerdown', press);
  surge.addEventListener('pointerup', release);
  // A pointer that leaves the button, or a window that loses focus mid-hold,
  // must still restore. Otherwise the scene stays surged and nothing says why.
  surge.addEventListener('pointercancel', release);
  surge.addEventListener('pointerleave', release);
  window.addEventListener('blur', release);

  // Printing is an OUTPUT, not the goal: the weave carries on folding after it.
  // The button says what happened, because writing a scene leaves nothing on
  // this screen to look at — the new row is over in Session.
  const print = el('button', 'weave-print');
  print.textContent = '▣ Print to scene';
  print.title = 'Freeze what is playing right now into a new scene';
  let printTimer = 0;
  print.addEventListener('click', () => {
    const n = ctx.printScene();
    print.textContent = n > 0
      ? `▣ Printed ${n} track${n === 1 ? '' : 's'}`
      : '▣ Nothing weaving';
    clearTimeout(printTimer);
    printTimer = window.setTimeout(() => { print.textContent = '▣ Print to scene'; }, 1800);
  });
  // ── the project's musical ground ─────────────────────────────────────────
  //
  // Key, scale, style and tempo are NOT the panel's: these are the session's
  // own, the same ones Project Options and the toolbar chip show. They sit here
  // because this is the screen you play from, and walking to a dialog to change
  // key mid-performance is the reason the mockup put them in the header.
  const field = (label: string, ...controls: HTMLElement[]) => {
    const f = el('span', 'weave-field');
    const l = el('span', 'weave-label');
    l.textContent = label;
    f.append(l, ...controls);
    return f;
  };
  const pick = (cls: string, choices: { id: string; name: string }[], value: string) => {
    const s = document.createElement('select');
    s.className = cls;
    for (const c of choices) {
      const o = document.createElement('option');
      o.value = c.id;
      o.textContent = c.name;
      s.appendChild(o);
    }
    s.value = value;
    return s;
  };

  const mus = ctx.musicality();
  const keySel = pick('weave-key', ctx.keys(), String(mus.key));
  const scaleSel = pick('weave-scale', ctx.scales(), mus.scale);
  const styleSel = pick('weave-style', ctx.styles(), mus.style);
  const pushMus = () =>
    ctx.setMusicality(Number(keySel.value), scaleSel.value, styleSel.value);
  for (const s of [keySel, scaleSel, styleSel]) s.addEventListener('change', pushMus);

  // No BPM field here, though the mockup drew one. The mockup was a standalone
  // picture; in the app the transport's own BPM input sits forty pixels above
  // this row and is already editable, so a second one would be duplication you
  // can see both of at once. Key and style stay, because up there they are a
  // CHIP that opens a dialog — these are the same values, one click closer.

  // A different deal from the same deck: which style each lane strays to is
  // re-drawn, while HOW FAR it may stray — the Style knob — stays where the
  // user put it.
  const reseed = el('button', 'weave-reseed');
  reseed.textContent = '⟳ Reshuffle';
  reseed.title = 'Deal the lane styles again — the Style amount stays where it is';
  reseed.addEventListener('click', () => ctx.reseed());

  const spacer = el('span', 'weave-head-spacer');

  head.append(
    logo,
    field('Key', keySel, scaleSel),
    field('Style', styleSel),
    spacer, reseed, surge, print,
  );

  // ── the pulse: a bar of sixteen cells that lights on the beat ────────────
  //
  // It reads the audio clock rather than a UI timer, so it cannot drift away
  // from what is sounding — and it is the one thing on screen that tells you
  // at a glance whether the weave is moving or the transport is stopped.
  const pulse = el('div', 'weave-pulse');
  const cells: HTMLElement[] = [];
  for (let i = 0; i < 16; i++) {
    const c = el('i', i % 4 === 0 ? 'accent' : '');
    pulse.appendChild(c);
    cells.push(c);
  }

  // ── master flow ──────────────────────────────────────────────────────────
  const flowRow = el('div', 'weave-flow');
  const flowLabel = el('span', 'weave-label');
  flowLabel.textContent = 'Flow';
  const flow = document.createElement('input');
  flow.type = 'range';
  flow.min = '0';
  flow.max = '1';
  flow.step = '0.01';
  flow.id = 'weave-flow';
  flow.setAttribute('aria-label', 'Master flow');
  const flowNow = ctx.flow();
  flow.value = String(flowNow.position);
  const flowOut = el('span', 'weave-readout');
  const showFlow = () => { flowOut.textContent = Number(flow.value).toFixed(2); };
  showFlow();

  // How the lanes relate while the flow moves them. Three musical intentions,
  // not three settings: everything turning over at once is a section change;
  // fanned out means something is always mid-transition; free means the flow
  // only nudges a scene the user placed by hand.
  const drift = document.createElement('select');
  drift.className = 'weave-drift';
  drift.setAttribute('aria-label', 'How the lanes drift apart');
  for (const [id, label, hint] of [
    ['together', 'Together', 'Every lane crosses at the same moment — a section change.'],
    ['offset', 'Offset', 'Lanes fanned out, so something is always mid-transition.'],
    ['free', 'Free', 'Each lane keeps its own position; the flow only nudges it.'],
  ]) {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = label;
    o.title = hint;
    drift.appendChild(o);
  }

  // How long a full journey takes. OFF by default — a panel that started
  // travelling the moment it was opened would change a session nobody touched.
  const speed = document.createElement('select');
  speed.className = 'weave-speed';
  speed.setAttribute('aria-label', 'How long a full journey takes');
  for (const bars of [0, 4, 8, 16, 32, 64]) {
    const o = document.createElement('option');
    o.value = String(bars);
    o.textContent = bars === 0 ? 'Off' : `${bars} bars`;
    speed.appendChild(o);
  }

  drift.value = flowNow.drift;
  speed.value = String(flowNow.speedBars);

  const pushFlow = () => {
    ctx.setFlow(Number(flow.value), drift.value, Number(speed.value));
    // Travelling on its own, the fader is a readout and not a handle. Left live
    // it would fight the host for the position every frame.
    flow.disabled = Number(speed.value) > 0;
    showFlow();
  };
  flow.disabled = flowNow.speedBars > 0;
  flow.addEventListener('input', pushFlow);
  drift.addEventListener('change', pushFlow);
  speed.addEventListener('change', pushFlow);

  const driftLabel = el('span', 'weave-label');
  driftLabel.textContent = 'Drift';
  const speedLabel = el('span', 'weave-label');
  speedLabel.textContent = 'Speed';
  flowRow.append(flowLabel, flow, flowOut, driftLabel, drift, speedLabel, speed);

  // ── lanes ────────────────────────────────────────────────────────────────
  const lanes = el('div', 'weave-lanes');

  // Column headers. The row carries seven things now, and without a header the
  // two dropdowns in the middle are guesswork.
  const head2 = el('div', 'weave-lane weave-lane-head');
  for (const label of ['', '', 'Lane', '', 'Instrument', 'Preset', 'Style', 'Topology', 'Loops']) {
    const c = el('span', 'weave-col');
    c.textContent = label;
    head2.appendChild(c);
  }
  lanes.appendChild(head2);

  const engineChoices = ctx.engines();
  const laneRows = ctx.lanes().map((lane) => buildLaneRow(lane, ctx, engineChoices));
  for (const r of laneRows) lanes.appendChild(r.el);

  // A fresh session has no tracks, and a panel that answered that with a notice
  // telling you to go somewhere else would be a dead end on the screen you play
  // from. The button makes a track that arrives already weaving two loops from
  // the library, so New Session → open WEAVE → play is a path that makes sound.
  const addRow = el('div', 'weave-empty');
  if (laneRows.length === 0) {
    head2.remove();
    const msg = el('p', '');
    msg.textContent = 'Nothing to weave yet.';
    addRow.appendChild(msg);
  }
  // WHICH instrument, because the answer is not always a synth: a weave with no
  // drums in it is half a scene, and the button used to be able to make one kind
  // of track only.
  const addWhat = pick('weave-add-engine', engineChoices, 'subtractive');
  addWhat.setAttribute('aria-label', 'Instrument for the new track');
  const add = el('button', 'weave-add');
  add.textContent = '+ Weaving track';
  add.title = 'Add a track already weaving two loops from the library';
  add.addEventListener('click', () => { ctx.addLane(addWhat.value); });
  addRow.append(add, addWhat);
  lanes.appendChild(addRow);

  // ── macros ───────────────────────────────────────────────────────────────
  const macros = el('div', 'weave-macros');
  for (const m of MACROS) {
    const knob = macroKnob(m, ctx);
    macros.appendChild(knob.el);
    repaintMacros.push(knob.paint);
  }

  rack.append(head, pulse, flowRow, lanes, macros);
  host.appendChild(rack);

  // ── the animation ────────────────────────────────────────────────────────
  //
  // One rAF loop for the whole panel. Every visual that moves reads barPhase()
  // and nothing keeps its own timer, so the pulse, the lane LEDs and the rack
  // glow can never disagree about where the beat is.
  let raf = 0;
  let lastStep = -1;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
  const SILENT: PanelLoopPhase = { state: 'silent', frac: 0, bars: 0, centerText: '' };

  const frame = () => {
    raf = requestAnimationFrame(frame);
    const phase = ctx.barPhase();

    if (phase < 0) {
      // Stopped: everything settles rather than freezing mid-flash, so a still
      // panel looks deliberate instead of hung. The rings go silent explicitly
      // rather than being left alone — the audio clock keeps running while the
      // transport is paused, so a ring that kept reading it would go on sweeping
      // over silence.
      if (lastStep !== -1) {
        lastStep = -1;
        for (const c of cells) c.classList.remove('on');
        for (const l of laneRows) { l.led.classList.remove('hit'); l.ring.set(SILENT); }
        rack.style.removeProperty('--weave-pulse');
      }
      return;
    }

    // Every frame, not every step: the wedge is a sweep, and quantising it to
    // sixteenths would turn the one continuous thing on screen into a stutter.
    for (const l of laneRows) l.ring.set(ctx.loopPhase(l.laneId));

    // With a journey running the host owns the position and the fader FOLLOWS.
    // Reading it back rather than counting bars here is what keeps the control
    // showing where the music actually is, not where the panel thinks it put it.
    if (flow.disabled) {
      const pos = ctx.flow().position;
      if (Math.abs(pos - Number(flow.value)) >= 0.005) {
        flow.value = String(pos);
        showFlow();
      }
      // And the lanes themselves, each following its own position — with Offset
      // drift they are all at DIFFERENT points of the journey, so one master
      // readout cannot stand in for them.
      for (const l of laneRows) l.followWeave();
    }

    const step = Math.floor(phase * 16) % 16;
    if (step !== lastStep) {
      lastStep = step;
      cells.forEach((c, i) => c.classList.toggle('on', i === step));
      // The LEDs flash on the quarter, not on every sixteenth: sixteen flashes
      // a bar reads as flicker rather than as a beat.
      const onBeat = step % 4 === 0;
      for (const l of laneRows) l.led.classList.toggle('hit', onBeat);
      // Once a beat, not once a frame: a lane can start or stop from the grid,
      // from a scene launch or from a MIDI pad, none of which pass through this
      // row — but four reads a second is plenty to notice.
      for (const l of laneRows) l.syncTransport();
    }

    if (!reduced) {
      // A glow that swells on the downbeat and decays across the bar. Squaring
      // the decay keeps it a pulse rather than a sine that never quite rests.
      const beat = (phase * 4) % 1;
      const decay = (1 - beat) * (1 - beat);
      rack.style.setProperty('--weave-pulse', decay.toFixed(3));
    }
  };
  frame();

  return () => {
    cancelAnimationFrame(raf);
    // The print button's "what happened" message is on a timer that outlives
    // this zone; left running, it writes into a node the panel no longer owns.
    clearTimeout(printTimer);
    // The blur listener is on WINDOW, so it outlives this zone unless it is
    // taken off explicitly — a panel that leaks one would restore a macro that
    // no longer has a panel behind it.
    window.removeEventListener('blur', release);
    host.replaceChildren();
  };
}

Loom.registerPanel('weave', mountWeave);
