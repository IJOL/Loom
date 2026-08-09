// plugins/weave/step-rack.ts — the rows of steps under the weave, one per
// parameter they move.
//
// The grid itself is the host's (`Loom.controls.steps`, the same one the clip
// painter draws) and the shape maths is the painter's too. What is different
// here is WHERE the curve lives: on the weave rather than on a clip, because in
// this panel a lane's clip is a vessel the loops fill and tying a curve to it
// would tie it to the one thing that does not matter.
//
// Two things this file exists to get right, both reported from the panel:
//
//   - ONE row was not enough. A scene worth playing moves several parameters —
//     a cutoff opening while a delay send swells — so the rack is a list with a
//     "+", not a single row with a compromise in it.
//
//   - The destination picker listed 226 entries in one flat run, which is not a
//     choice, it is a search. It is two pickers now: WHERE first (the lane, or
//     the master, or a send), then WHAT, and the second only ever holds that
//     one place's parameters.
//
// The lane picker keeps NO state of its own. Which place a row is on is derived
// from the destination it already holds, so a repaint cannot leave the two
// disagreeing — the bug a remembered "currently showing" field would invite.

import type { PanelChoice, PanelContext } from '@loom/plugin-sdk';

const el = (tag: string, cls?: string, text?: string) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

/** The heading a destination sits under — its lane's name, "Weave", "Master" or
 *  a send's label. The catalogue already groups them; this is only the fallback
 *  for a destination that arrives ungrouped. */
const placeOf = (c: PanelChoice) => c.group || 'Other';

function option(value: string, text: string): HTMLOptionElement {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = text;
  return o;
}

/** One row: where it lands, what it lands on, how it gets there, and the shape.
 *
 *  `row` is the index into the rack, captured once. Every ABI call takes it, and
 *  the host answers out-of-range calls with nothing rather than throwing — a row
 *  can be removed while a handler built over it is still on screen.
 *
 *  `rebuild` repaints the whole rack. Called only when the SET of rows changes;
 *  editing a row's own controls never rebuilds, or the grid would be recreated
 *  under the pointer that is drawing on it. */
function buildRow(
  ctx: PanelContext,
  row: number,
  choices: readonly PanelChoice[],
  rebuild: () => void,
): HTMLElement {
  const st = ctx.stepRows()[row];
  const wrap = el('div', 'weave-step-row');

  // ── where ────────────────────────────────────────────────────────────────
  const places = [...new Set(choices.map(placeOf))];
  const current = choices.find((c) => c.id === st.destId);
  // The place the row is already on. A row pointing nowhere opens on the first,
  // which is a list you can read rather than an empty one you cannot.
  const place = current ? placeOf(current) : places[0] ?? '';

  const placePick = el('select', 'weave-step-place') as HTMLSelectElement;
  placePick.setAttribute('aria-label', 'Which track this row moves');
  for (const p of places) placePick.appendChild(option(p, p));
  placePick.value = place;

  // ── what ─────────────────────────────────────────────────────────────────
  const destPick = el('select', 'weave-step-dest') as HTMLSelectElement;
  destPick.setAttribute('aria-label', 'What the step row moves');

  const fillDests = (forPlace: string) => {
    destPick.replaceChildren(option('', '— nothing yet —'));
    for (const c of choices) {
      if (placeOf(c) !== forPlace) continue;
      destPick.appendChild(option(c.id, c.name));
    }
    // Keep the row's own destination when it belongs here; otherwise the row is
    // parked, which is honest — changing the place is choosing to point it
    // somewhere else, and guessing which parameter would be the panel deciding.
    destPick.value = [...destPick.options].some((o) => o.value === st.destId) ? st.destId : '';
  };
  fillDests(place);

  placePick.addEventListener('change', () => {
    fillDests(placePick.value);
    ctx.setStepsDest(row, destPick.value);
  });
  destPick.addEventListener('change', () => ctx.setStepsDest(row, destPick.value));

  // ── how ──────────────────────────────────────────────────────────────────
  const modePick = el('select', 'weave-step-mode') as HTMLSelectElement;
  modePick.setAttribute('aria-label', 'How a step reaches the next');
  for (const [v, label] of [['hold', 'Step'], ['ramp', 'Glide']]) {
    modePick.appendChild(option(v, label));
  }
  modePick.value = st.mode;
  modePick.addEventListener('change', () => {
    ctx.setStepsMode(row, modePick.value === 'ramp' ? 'ramp' : 'hold');
  });

  const on = el('button', 'weave-step-on') as HTMLButtonElement;
  const paintOn = () => {
    const running = ctx.stepRows()[row]?.on ?? false;
    on.textContent = running ? '● RUNNING' : '○ OFF';
    on.classList.toggle('on', running);
    on.setAttribute('aria-pressed', String(running));
  };
  on.addEventListener('click', () => {
    ctx.setStepsOn(row, !(ctx.stepRows()[row]?.on ?? false));
    paintOn();
  });
  paintOn();

  // ── the shape ────────────────────────────────────────────────────────────
  const grid = Loom.controls.steps({
    values: st.values,
    label: 'The step row',
    onChange: (i, v) => ctx.setStep(row, i, v),
  });
  grid.el.classList.add('weave-step-grid');

  const tools = el('div', 'weave-step-tools');
  for (const [kind, label] of [['up', '↗'], ['down', '↘'], ['invert', '⇅'], ['random', '⚄']] as const) {
    const b = el('button', 'weave-step-tool', label);
    b.title = { up: 'Ramp up', down: 'Ramp down', invert: 'Invert', random: 'Randomise' }[kind];
    b.addEventListener('click', () => {
      ctx.stepsTool(row, kind);
      grid.set(ctx.stepRows()[row]?.values ?? []);
    });
    tools.appendChild(b);
  }

  const drop = el('button', 'weave-step-drop', '×') as HTMLButtonElement;
  drop.title = 'Remove this row';
  drop.addEventListener('click', () => { ctx.removeStepRow(row); rebuild(); });

  const head = el('div', 'weave-step-head');
  head.append(placePick, destPick, modePick, on, tools, drop);
  wrap.append(head, grid.el);
  return wrap;
}

/** The whole rack, plus the "+" that grows it.
 *
 *  Returns a container the panel appends once. Adding or removing a row repaints
 *  the container in place rather than the panel, so the flow, the lanes and the
 *  macros above keep their live state — and, more to the point, the grid the
 *  pointer is on is never rebuilt by an edit to a different row. */
export function buildStepRack(ctx: PanelContext): HTMLElement {
  const rack = el('div', 'weave-steps');

  const paint = () => {
    const choices = ctx.destinations();
    const rows = ctx.stepRows();
    const label = el('span', 'weave-label', 'Steps');

    const add = el('button', 'weave-step-add', '+ ROW') as HTMLButtonElement;
    add.title = 'Another row, for another parameter';
    add.addEventListener('click', () => { ctx.addStepRow(); paint(); });

    const bar = el('div', 'weave-step-bar');
    bar.append(label, add);

    rack.replaceChildren(bar, ...rows.map((_, i) => buildRow(ctx, i, choices, paint)));
  };

  paint();
  return rack;
}
