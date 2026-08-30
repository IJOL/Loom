// plugins/stepseq/main.ts
// The step sequencer's own editor, mounted through the modulator-UI door
// (Loom.registerModulatorUI) into the modulators panel. Built ENTIRELY out of
// the host's control catalogue — the bars are the app's own steps control and
// the knobs are the app's own knob, so this editor cannot disagree with the
// rest of the UI about how a control feels. The host mounts this once per
// (lane, modulator instance) and keeps the element across repaints.
//
// Everything read or written goes through the numeric bag `api` wraps — the
// SAME bag the dsp kernel's valueAt receives, so what you draw is what plays.

const STEP_IDS = Array.from({ length: 16 }, (_, i) => `step${i}`);
const MAX_STEPS = 16;
const MIN_STEPS = 2;

Loom.registerModulatorUI('stepseq', (root, api) => {
  root.style.display = 'flex';
  root.style.alignItems = 'center';
  root.style.gap = '8px';

  const count = (): number =>
    Math.max(MIN_STEPS, Math.min(MAX_STEPS, Math.round(api.get('steps', 8))));
  const drawn = (): number[] => STEP_IDS.slice(0, count()).map((id) => api.get(id, 0));

  // First mount on a bag that has never been drawn: seed a pattern. All-zero
  // bars are invisible AND inaudible — a modulator that arrives useless until
  // you draw reads as broken. The sentinel is step0's absence, so a pattern a
  // user deliberately zeroed (and saved) is respected.
  if (api.get('step0', -1) < 0) {
    [1, 0, 0.6, 0, 0.8, 0.3, 0.6, 0].forEach((v, i) => api.set(STEP_IDS[i], v));
  }

  // The steps control sizes its bars off ITS OWN box (a grid of 1fr columns),
  // so this zone must give it one: flex-grow with a real minimum, stretched to
  // the row's height. And its set() repaints values but cannot change the BAR
  // COUNT — the row is rebuilt (element replaced) when the count knob moves.
  const makeBars = () => {
    const b = Loom.controls.steps({
      values: drawn(),
      label: 'Pattern',
      onChange: (i, v) => api.set(STEP_IDS[i], Math.max(0, Math.min(1, v))),
    });
    b.el.style.flex = '1 1 160px';
    b.el.style.minWidth = '160px';
    b.el.style.alignSelf = 'stretch';
    return b;
  };
  let bars = makeBars();

  const rate = Loom.controls.knob({
    min: 0.5, max: 32, value: api.get('rate', 8), defaultValue: 8, label: 'Rate',
    format: (v) => `${v.toFixed(1)}Hz`,
    onChange: (v) => api.set('rate', v),
  });

  const len = Loom.controls.knob({
    min: MIN_STEPS, max: MAX_STEPS, value: count(), defaultValue: 8, step: 1, label: 'Steps',
    format: (v) => `${Math.round(v)}`,
    onChange: (v) => {
      api.set('steps', Math.round(v));
      const next = makeBars();   // the row grows or shrinks to the new count
      bars.el.replaceWith(next.el);
      bars = next;
    },
  });

  const glide = Loom.controls.knob({
    min: 0, max: 1, value: api.get('glide', 0), defaultValue: 0, label: 'Glide',
    onChange: (v) => api.set('glide', v),
  });

  const polarity = document.createElement('button');
  polarity.className = 'rnd';
  polarity.title = 'Polarity: unipolar (0..1) or bipolar (-1..+1)';
  const paintPolarity = (): void => {
    polarity.textContent = api.get('bipolar', 0) !== 0 ? 'Bi' : 'Uni';
  };
  polarity.addEventListener('click', () => {
    api.set('bipolar', api.get('bipolar', 0) !== 0 ? 0 : 1);
    paintPolarity();
  });
  paintPolarity();

  root.append(bars.el, rate.el, len.el, glide.el, polarity);
});

// A module, not a global script — see the note at the end of dsp.ts.
export {};
