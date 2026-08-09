// plugins/weave/endless-dial.ts — the control a journey without an end needs.
//
// The panel used a linear fader for the crossfade, and a linear fader is a
// promise: this is where you are between two ends. EVOLVE breaks that promise —
// arriving at the far end is a handover, the pair advances and the position
// starts again — so the fader had to jump back to zero every lap. Reported, and
// rightly: "un slider que va de atrás adelante y luego salta es raro".
//
// A dial has no ends to violate. The arc says how far into the CURRENT leg you
// are; the two loop names sit beside it, fixed, as from → to. Turning past the
// top is not a jump, it is the next lap — which is exactly what the music does.
//
// Two properties earn their keep:
//
//   - RELATIVE drag. The pointer's travel is a delta, never an absolute
//     position, so the dial can turn for ever without the hand having to be
//     anywhere in particular. (A macro knob here is absolute: it has a floor and
//     a ceiling and the value IS the angle. Different job, same drawing.)
//
//   - WRAP is the caller's to decide. STATIC clamps — the pair you chose is the
//     pair you keep, and the dial stops at both ends. EVOLVE wraps, and the lap
//     it completes is the handover. One control, and the switch is what changes
//     its meaning rather than a second control appearing.

/** A FULL circle, starting at twelve.
 *
 *  The panel's macro knobs use the usual 270° arc with a gap at the bottom, and
 *  that gap is exactly what a journey without an end must not have: it shows
 *  where the travel begins and stops, so coming round reads as jumping back to
 *  the start. Closing the ring removes the landmark, and a lap becomes what it
 *  actually is — the pointer going round again.
 *
 *  Drawn as a dashed circle rather than an arc path, because an arc of exactly
 *  360° is not drawable: its two ends coincide and SVG renders nothing. A circle
 *  with `stroke-dasharray` has no such seam. */
const SWEEP = 360, START = 0;

const svgEl = (tag: string) => document.createElementNS('http://www.w3.org/2000/svg', tag);

function polar(deg: number, radius: number, cx: number, cy: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)];
}

export interface EndlessDialOptions {
  /** 0..1 within the current leg. */
  value: number;
  label: string;
  /** Where the hand left it — and a number that keeps
   *  GROWING rather than folding: 0.95 turns into 1.05, not 0.05.
   *
   *  The ring folds for the eye; the number must not, because the host tells a
   *  completed lap from a hand turning back by whether this went up or down,
   *  and a folded number makes those two identical. That is exactly the bug
   *  already fixed once for the fader — arriving and rewinding looked the same
   *  — and folding here would hand it straight back. */
  onChange: (value: number) => void;
  /** Radius in px. The lane rows want a small one, the master a large one. */
  size?: number;
}

export interface EndlessDial {
  el: HTMLElement;
  /** Move the ring without telling anyone — for the host driving the journey. */
  set(value: number): void;
  /** What the RING shows: 0..1 inside the current leg.
   *
   *  Not the same number `onChange` reports, and the difference is the whole
   *  design: that one keeps growing so a lap can be told from a rewind, this
   *  one is where the crossfade actually is. Anything drawn beside the dial —
   *  a readout, a caption — must take it from here, or the two disagree at
   *  exactly the interesting moment. At the far end, clamped, this reads 1
   *  rather than folding to 0. */
  shown(): number;
  /** True while a hand is on it, so a follower does not fight the pointer. */
  held(): boolean;
}

export function endlessDial(o: EndlessDialOptions): EndlessDial {
  const size = o.size ?? 58;
  const cx = size / 2, cy = size / 2;
  const r = size * 0.38;
  const hubR = size * 0.19;

  const wrap = document.createElement('div');
  wrap.className = 'weave-dial';

  const s = svgEl('svg');
  s.setAttribute('viewBox', `0 0 ${size} ${size}`);
  s.setAttribute('width', String(size));
  s.setAttribute('height', String(size));
  s.setAttribute('role', 'slider');
  s.setAttribute('tabindex', '0');
  s.setAttribute('aria-label', o.label);
  s.setAttribute('aria-valuemin', '0');
  s.setAttribute('aria-valuemax', '1');

  const circumference = 2 * Math.PI * r;

  const track = svgEl('circle');
  track.setAttribute('class', 'knob-track');
  track.setAttribute('cx', String(cx));
  track.setAttribute('cy', String(cy));
  track.setAttribute('r', r.toFixed(2));
  track.setAttribute('fill', 'none');

  // Rotated so the ring FILLS from twelve o'clock. Without it a dashed circle
  // starts at three, which reads as a dial someone forgot to align.
  const arc = svgEl('circle');
  arc.setAttribute('class', 'knob-arc');
  arc.setAttribute('cx', String(cx));
  arc.setAttribute('cy', String(cy));
  arc.setAttribute('r', r.toFixed(2));
  arc.setAttribute('fill', 'none');
  arc.setAttribute('stroke-dasharray', circumference.toFixed(3));
  arc.setAttribute('transform', `rotate(-90 ${cx} ${cy})`);

  const hub = svgEl('circle');
  hub.setAttribute('class', 'knob-hub');
  hub.setAttribute('cx', String(cx));
  hub.setAttribute('cy', String(cy));
  hub.setAttribute('r', hubR.toFixed(2));

  const tick = svgEl('line');
  tick.setAttribute('class', 'knob-tick');

  s.append(track, arc, hub, tick);
  wrap.append(s);

  // What the hand has wound in, which is NOT what the ring shows: this keeps
  // growing past 1 so the host can tell a lap from a rewind, and the ring takes
  // the fractional part.
  let wound = Math.min(1, Math.max(0, o.value));
  // The ring takes the fractional part: a full turn reads as the start of the
  // next one. It never stops, in either mode — a dial with ends is a slider
  // that happens to be round, which is what the first attempt at this was and
  // what it was rightly called.
  const shown = () => ((wound % 1) + 1) % 1;

  const paint = () => {
    const value = shown();
    // Offset by the UNFILLED part, so the ring grows clockwise from twelve.
    arc.setAttribute('stroke-dashoffset', (circumference * (1 - value)).toFixed(3));
    const [x1, y1] = polar(START + SWEEP * value, hubR * 0.3, cx, cy);
    const [x2, y2] = polar(START + SWEEP * value, hubR * 0.92, cx, cy);
    tick.setAttribute('x1', x1.toFixed(2));
    tick.setAttribute('y1', y1.toFixed(2));
    tick.setAttribute('x2', x2.toFixed(2));
    tick.setAttribute('y2', y2.toFixed(2));
    s.setAttribute('aria-valuenow', value.toFixed(3));
  };
  paint();

  /** Land a DELTA.
   *
   *  The wound value simply keeps going — past 1 and below 0 — and the ring
   *  folds for the eye. What a lap MEANS for the material is the host's call,
   *  not the dial's; this only reports how far the hand has wound. */
  const move = (delta: number) => {
    wound += delta;
    paint();
    o.onChange(wound);
  };

  let lastY = 0;
  let holding = false;
  s.addEventListener('pointerdown', (e) => {
    const ev = e as PointerEvent;
    holding = true;
    lastY = ev.clientY;
    if (typeof ev.pointerId === 'number' && s.setPointerCapture) {
      try { s.setPointerCapture(ev.pointerId); } catch { /* capture is a nicety */ }
    }
  });
  const letGo = () => { holding = false; };
  s.addEventListener('pointerup', letGo);
  s.addEventListener('pointercancel', letGo);
  s.addEventListener('lostpointercapture', letGo);
  s.addEventListener('pointermove', (e) => {
    const ev = e as PointerEvent;
    if (!ev.buttons) { holding = false; return; }
    // 180px of travel is one whole leg: fine enough to place a crossfade, and
    // coarse enough to cross one in a single gesture.
    move((lastY - ev.clientY) / 180);
    lastY = ev.clientY;
  });
  s.addEventListener('keydown', (e) => {
    const k = (e as KeyboardEvent).key;
    const d = k === 'ArrowUp' || k === 'ArrowRight' ? 0.02
      : k === 'ArrowDown' || k === 'ArrowLeft' ? -0.02 : 0;
    if (!d) return;
    e.preventDefault();
    move(d);
  });

  return {
    el: wrap,
    set(v) {
      // Never under a hand: writing the value mid-drag fights the pointer that
      // is setting it, which reads as a control that resists you.
      if (holding) return;
      // The host reports a position INSIDE the current leg, so the whole turns
      // the hand has wound are kept and only the fraction is replaced. Assigning
      // it raw would rewind the dial to its first lap every time the clock moved
      // it, and the hand's own progress would vanish under the journey.
      const laps = Math.floor(wound);
      const next = laps + Math.min(1, Math.max(0, v));
      if (Math.abs(next - wound) < 0.0005) return;
      wound = next;
      paint();
    },
    shown,
    held: () => holding,
  };
}
