// Canvas drum-rack editor (Spec 3): N voice rows × time, variable resolution +
// free off-grid placement, selection/clipboard/group-move, and a canvas playhead.
// Replaces the button matrix. Same NoteEvent data model; serves synth-drums (the
// fixed 8 GM rows) AND a variable-size sample drumkit (one row per pad) via an
// injected DrumRows model. Returns a { redraw } handle driven by the session-host
// RAF. Pure logic in core/drum-grid-editing.ts.

import { html, render, nothing } from 'lit-html';
import { DRUM_LANES, type DrumVoice } from '../../core/drums';
import { velToColor } from '../../core/velocity-color';
import { velocityToBarHeight, barHitTest, yToVelocity, setVelocity, applyGroupDelta, FAN_PX } from '../../core/velocity-lane-editing';
import { DEFAULT_VELOCITY } from '../../core/velocity-gain';
import type { SessionClip } from '../session';
import type { NoteEvent } from '../../core/notes';
import { withUndo, isTextEditTarget, type HistoryDeps } from '../../save/history-wiring';
import { ticksPerBar, stepsPerBar, stepsPerBeat, DEFAULT_METER, type TimeSignature } from '../../core/meter';
import {
  resolutionToSnap, clampResolution, DEFAULT_RESOLUTION, snapTickToRes,
  hitInCell, hitsInCell, rowsInRect, rowMove, serializeDrumClipboard, pasteDrumClipboard, clampGroupTick,
  gmDrumRows, type DrumRows, type ResolutionKey, type DrumClipNote,
} from '../../core/drum-grid-editing';
import { createToolToggle, createHelpButton, createResolutionSelect, createFollowToggle, createFullKitToggle } from '../../core/clip-editor-toolbar';
import { mountDrumEuclidPanel } from './drum-euclid-panel';
import { mountClipLoopOverlay } from '../../core/clip-loop-overlay';
import { ClipAxis } from '../../core/clip-axis';
import { attachPrimaryAxis } from '../../core/clip-axis-primary';
import { isFollowEnabled, followScrollTarget } from '../../core/clip-follow';
import { isDrumFullKit } from '../../core/clip-drum-fullkit';
import { LANE_LABELS, LABEL_W, RULER_H, ROW_H, VEL_LANE_H, DRUM_KEY_LEGEND, type DrumGridModel, type DrumEditorHandle, type DrumEditorDeps } from './drum-grid-types';
export { LANE_LABELS, LABEL_W, DRUM_KEY_LEGEND, type DrumGridModel, type DrumEditorHandle, type DrumEditorDeps } from './drum-grid-types';

const GM_MODEL: DrumGridModel = { rows: gmDrumRows(), labels: DRUM_LANES.map((v) => LANE_LABELS[v]) };

type Tool = 'draw' | 'select';
let currentTool: Tool = 'draw';          // persists across clips (session)
let clipboard: DrumClipNote[] | null = null;


export function renderDrumGridEditor(
  host: HTMLElement, clip: SessionClip,
  historyDeps?: HistoryDeps, meter: TimeSignature = DEFAULT_METER,
  deps: DrumEditorDeps = {},
  model: DrumGridModel = GM_MODEL,
): DrumEditorHandle {
  host.innerHTML = '';
  if (!clip.notes) clip.notes = [];
  const notes = (): NoteEvent[] => clip.notes;
  const setNotes = (n: NoteEvent[]) => { clip.notes = n; };
  const audition = deps.auditionNote;

  // The row model is reassignable so the "Full kit" toggle can swap compact ↔
  // full in place. On init, honour the current flag's view so reopening respects
  // the toggle; otherwise use the model the caller passed.
  let activeModel = deps.fullKit ? deps.fullKit.build(isDrumFullKit()) : model;
  let rows = activeModel.rows;
  let labels = activeModel.labels;
  let ROWS_N = Math.max(1, rows.count);
  let FRAME_H = RULER_H + ROW_H * ROWS_N + VEL_LANE_H;

  let resolution: ResolutionKey = clampResolution(clip.gridResolution ?? DEFAULT_RESOLUTION);
  const snap = () => resolutionToSnap(resolution);

  const patternTicks = Math.max(1, clip.lengthBars * ticksPerBar(meter));
  const barTicks = ticksPerBar(meter);
  const beatsPerBar = stepsPerBar(meter) / stepsPerBeat(meter);
  const beatTicks = barTicks / beatsPerBar;

  const selection = new Set<NoteEvent>();
  let marquee: { row0: number; tick0: number; row1: number; tick1: number } | null = null;
  let groupDrag: { lastTick: number; lastRow: number } | null = null;
  let laneDrag: NoteEvent | null = null;
  let lastMouse: { row: number; tick: number } | null = null;
  let playheadTick = -1;

  // ── DOM: toolbar + label column + scroll viewport ─────────────────────────
  // One-shot lit template into a throwaway fragment (this editor is rebuilt per
  // clip open — there is no re-render pass, so the imperative toolbar widgets
  // interpolate directly). Drawing stays imperative on the two canvases.
  // Popover lives just below the toolbar (inside the wrap), positioned by SCSS.
  // The row bounds the labels+grid block at 60vh and scrolls it vertically:
  // full kit can be ~52 rows tall; the labels canvas (flex:0 0 LABEL_W) and the
  // grid viewport stay side-by-side and scroll together; compact view (few
  // rows) shows no scrollbar.
  const tools = createToolToggle(currentTool, (t) => { currentTool = t; });
  const drawBtn = tools.drawBtn, selBtn = tools.selBtn;

  // Grid resolution select — shared with the piano-roll; persisted on the clip.
  const { control: resCtl } = createResolutionSelect(resolution, (r) => {
    resolution = r; clip.gridResolution = r; draw();
  });

  const help = createHelpButton(DRUM_KEY_LEGEND);
  const helpPopover = help.popover;

  const frag = document.createDocumentFragment();
  render(html`
    <div tabindex="0" style="outline:none">
      <div style="display:flex;gap:6px;align-items:center;padding:4px 2px">
        ${drawBtn}${selBtn}${createFollowToggle()}
        ${deps.fullKit ? createFullKitToggle(() => {
          setModel(deps.fullKit!.build(isDrumFullKit()));
          deps.fullKit!.onToggle?.();
        }) : nothing}
        ${resCtl}${help.btn}
      </div>
      ${helpPopover}
      <div style="display:flex;align-items:flex-start;max-height:60vh;overflow-y:auto">
        <canvas style="display:block;flex:0 0 ${LABEL_W}px"></canvas>
        <div class="drum-grid-vp" style="flex:1 1 auto;overflow-x:auto;overflow-y:hidden;position:relative">
          <canvas style="display:block;cursor:crosshair"></canvas>
        </div>
      </div>
    </div>`, frag);
  const wrap = frag.firstElementChild as HTMLElement;
  const [labelsCanvas, canvas] = Array.from(wrap.querySelectorAll('canvas'));
  const viewport = wrap.querySelector('.drum-grid-vp') as HTMLDivElement;
  const row = viewport.parentElement as HTMLElement;
  // The Euclidean fields go between the labels and the grid so a voice's numbers
  // sit beside its name; they share the row's vertical scroll, so they stay lined
  // up with their voice at any kit size. The panel appends itself to the row, so
  // move the viewport back behind it to keep labels · fields · grid order.
  const euclidPanel = mountDrumEuclidPanel(row, {
    rows, labels,
    totalSteps: clip.lengthBars * stepsPerBar(meter),
    defaultSteps: stepsPerBar(meter),
    getNotes: notes, setNotes, onChange: () => draw(), historyDeps,
  });
  row.append(viewport);
  host.appendChild(wrap);

  const c2d = canvas.getContext('2d');
  if (!c2d) throw new Error('canvas 2d unavailable');
  const ctx = c2d;

  const lctx = labelsCanvas.getContext('2d')!;

  // ── Zoom/scroll: owned by the clip's shared axis ──────────────────────────
  const axis = deps.axis ?? new ClipAxis(clip.id, patternTicks);
  axis.setTotalTicks(patternTicks);
  let gridW = 600, pxPerTick = gridW / patternTicks;
  const xForTick = (t: number) => t * pxPerTick;                 // content space (no LABEL_W)
  const yForRow = (r: number) => RULER_H + r * ROW_H;
  const tickFromX = (x: number) => Math.max(0, Math.min(patternTicks - 1, x / pxPerTick));
  const rowFromY = (y: number) => Math.max(0, Math.min(ROWS_N - 1, Math.floor((y - RULER_H) / ROW_H)));
  // Loop overlay handle — its column lives inside the viewport and is positioned
  // in CONTENT coords (tickToX = t·pxPerTick), so a zoom change (which changes
  // pxPerTick) must re-layout it. resize() is the single place zoom is applied,
  // so it drives the redraw; the column then tracks the grid at every zoom.
  let loopHandle: { redraw: () => void } | undefined;

  function resize(): void {
    const vpW = Math.max(120, viewport.clientWidth || ((wrap.clientWidth || host.clientWidth || 600) - LABEL_W));
    axis.setBasisWidth(vpW);                 // publish the fit basis for followers
    gridW = Math.max(1, axis.contentWidth());
    pxPerTick = axis.pxPerTick();
    canvas.width = gridW; canvas.height = FRAME_H;
    canvas.style.width = `${gridW}px`; canvas.style.height = `${FRAME_H}px`;
    labelsCanvas.width = LABEL_W; labelsCanvas.height = FRAME_H;
    labelsCanvas.style.width = `${LABEL_W}px`; labelsCanvas.style.height = `${FRAME_H}px`;
    drawLabels(); draw();
    loopHandle?.redraw();   // re-layout the loop column for the new pxPerTick (zoom)
  }

  // Swap the row model in place (the "Full kit" toggle). Recomputes row count +
  // canvas heights, clears the selection (its notes may no longer have a row),
  // and redraws both layers via resize().
  function setModel(m: DrumGridModel): void {
    activeModel = m; rows = m.rows; labels = m.labels;
    ROWS_N = Math.max(1, rows.count);
    FRAME_H = RULER_H + ROW_H * ROWS_N + VEL_LANE_H;
    selection.clear();
    euclidPanel.setModel(rows, labels);
    resize();
  }

  function drawLabels(): void {
    lctx.fillStyle = '#0a0a0a'; lctx.fillRect(0, 0, LABEL_W, FRAME_H);
    for (let r = 0; r < ROWS_N; r++) {
      const y = yForRow(r);
      lctx.fillStyle = '#202020'; lctx.fillRect(0, y, LABEL_W, ROW_H);
      lctx.fillStyle = '#9a9a9a'; lctx.font = '10px ui-monospace, monospace'; lctx.textBaseline = 'middle';
      lctx.fillText(labels[r] ?? '', 4, y + ROW_H / 2);
    }
    const laneTop = RULER_H + ROW_H * ROWS_N;
    lctx.fillStyle = '#202020'; lctx.fillRect(0, laneTop, LABEL_W, VEL_LANE_H);
  }

  function draw(): void {
    ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, canvas.width, FRAME_H);
    for (let r = 0; r < ROWS_N; r++) {
      const y = yForRow(r);
      ctx.fillStyle = r % 2 ? '#121212' : '#161616'; ctx.fillRect(0, y, gridW, ROW_H);
    }
    // gridlines: in free mode draw only bar/beat reference lines (snap=1 would draw one per tick).
    const lineStep = resolution === 'free' ? beatTicks : snap();
    for (let t = 0; t <= patternTicks; t += lineStep) {
      const x = xForTick(t);
      ctx.strokeStyle = (t % barTicks === 0) ? '#555' : (t % beatTicks === 0) ? '#2f2f2f' : '#1c1c1c';
      ctx.beginPath(); ctx.moveTo(x, RULER_H); ctx.lineTo(x, FRAME_H); ctx.stroke();
    }
    for (const n of notes()) {
      const r = rows.noteToRow(n.midi);
      if (r < 0) continue;
      const x = xForTick(n.start);
      const maxW = gridW - x;
      const w = Math.max(3, Math.min(n.duration * pxPerTick, maxW));
      const y = yForRow(r) + 3;
      const sel = selection.has(n);
      ctx.fillStyle = sel ? '#7fd4ff' : velToColor(n.velocity);
      ctx.fillRect(x, y, w, ROW_H - 6);
      ctx.strokeStyle = sel ? '#fff' : (n.velocity >= 100 ? '#ffffff' : '#0a0a0a');
      ctx.strokeRect(x + 0.5, y + 0.5, Math.max(3, w - 1), ROW_H - 7);
    }
    if (marquee) {
      const x0 = xForTick(Math.min(marquee.tick0, marquee.tick1));
      const x1 = xForTick(Math.max(marquee.tick0, marquee.tick1));
      const y0 = yForRow(Math.min(marquee.row0, marquee.row1));
      const y1 = yForRow(Math.max(marquee.row0, marquee.row1)) + ROW_H;
      ctx.strokeStyle = '#7fd4ff'; ctx.setLineDash([4, 3]);
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
      ctx.setLineDash([]);
    }
    if (playheadTick >= 0) {
      const x = xForTick(playheadTick);
      ctx.strokeStyle = '#f7d000'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, RULER_H); ctx.lineTo(x, FRAME_H); ctx.stroke();
    }
    // ── Velocity lane band ────────────────────────────────────────────────────
    const laneTop = RULER_H + ROW_H * ROWS_N;
    ctx.fillStyle = '#0e0e0e'; ctx.fillRect(0, laneTop, gridW, VEL_LANE_H);
    const accentY = laneTop + VEL_LANE_H - velocityToBarHeight(100, VEL_LANE_H);
    ctx.strokeStyle = '#ff8c2e'; ctx.globalAlpha = 0.6; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(0, accentY); ctx.lineTo(gridW, accentY); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    const seen = new Map<number, number>();
    for (const n of notes()) {
      if (rows.noteToRow(n.midi) < 0) continue;
      const fan = seen.get(n.start) ?? 0; seen.set(n.start, fan + 1);
      const x = xForTick(n.start) + fan * FAN_PX;
      const h = velocityToBarHeight(n.velocity, VEL_LANE_H);
      ctx.fillStyle = selection.has(n) ? '#7fd4ff' : velToColor(n.velocity);
      ctx.fillRect(x, laneTop + VEL_LANE_H - h, 6, h);
    }
  }

  // ── Pencil: click-cycle off → normal → accent → off over the whole cell ───
  function pencilClick(row: number, rawTick: number): void {
    const midi = rows.rowToNote(row);
    const cell = snapTickToRes(rawTick, snap());
    const cluster = hitsInCell(notes(), row, cell, snap(), rows);
    const run = () => {
      if (cluster.length === 0) {
        const dur = Math.max(1, Math.floor(snap() * 0.9));
        notes().push({ midi, start: cell, duration: dur, velocity: DEFAULT_VELOCITY });
        audition?.(midi);
      } else if (cluster.every((n) => n.velocity < 100)) {
        for (const n of cluster) n.velocity = 115;
        audition?.(midi);
      } else {
        const set = new Set(cluster);
        setNotes(notes().filter((n) => !set.has(n)));
      }
      draw();
    };
    if (historyDeps) withUndo(historyDeps, run); else run();
  }

  // ── Pointer handling ──────────────────────────────────────────────────────
  const pos = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();         // shifted by scroll → content x
    const x = e.clientX - rect.left;
    return { row: rowFromY(e.clientY - rect.top), x, tick: tickFromX(x), localY: e.clientY - rect.top };
  };

  canvas.addEventListener('pointerdown', (e) => {
    // Ruler scrub: ↕ zoom-H anchored at the cursor, ↔ pan-H.
    if ((e.clientY - canvas.getBoundingClientRect().top) < RULER_H) {
      let lx = e.clientX, ly = e.clientY;
      canvas.setPointerCapture(e.pointerId); e.preventDefault();
      const onMove = (ev: PointerEvent) => {
        const dy = ev.clientY - ly, dx = ev.clientX - lx; lx = ev.clientX; ly = ev.clientY;
        // Zoom (anchored) + pan through the shared axis; applyAxis does the rest.
        const anchorPx = ev.clientX - viewport.getBoundingClientRect().left;
        axis.scrub(dy, anchorPx);
        axis.setScrollLeft(axis.scrollLeft - dx);
        applyAxis();
      };
      const onUp = (ev: PointerEvent) => {
        canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerup', onUp);
        canvas.removeEventListener('pointercancel', onUp);
        try { canvas.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
      };
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerup', onUp);
      canvas.addEventListener('pointercancel', onUp);
      return;
    }

    const p = pos(e); wrap.focus();
    const laneTop = RULER_H + ROW_H * ROWS_N;
    const localY = p.localY;
    if (localY >= laneTop) {
      const hit = barHitTest(notes(), p.x, xForTick);
      if (hit) {
        historyDeps?.beginGesture?.();
        laneDrag = hit;
        const vel = yToVelocity(localY - laneTop, VEL_LANE_H);
        if (selection.has(hit) && selection.size > 1) applyGroupDelta([...selection], vel - hit.velocity);
        else setVelocity(hit, vel);
        draw();
        canvas.setPointerCapture(e.pointerId); e.preventDefault();
      }
      return;
    }
    if (e.altKey || e.button === 2) {
      const cell = snapTickToRes(p.tick, snap());
      const cluster = hitsInCell(notes(), p.row, cell, snap(), rows);
      if (cluster.length) { const set = new Set(cluster); const run = () => { setNotes(notes().filter((n) => !set.has(n))); draw(); }; historyDeps ? withUndo(historyDeps, run) : run(); }
      e.preventDefault(); return;
    }
    if (currentTool === 'draw') { pencilClick(p.row, p.tick); e.preventDefault(); return; }
    const cell = snapTickToRes(p.tick, snap());
    const hit = hitInCell(notes(), p.row, cell, snap(), rows);
    if (hit) {
      if (e.shiftKey) { selection.has(hit) ? selection.delete(hit) : selection.add(hit); }
      else if (!selection.has(hit)) { selection.clear(); selection.add(hit); }
      groupDrag = { lastTick: snapTickToRes(p.tick, snap()), lastRow: p.row };
      historyDeps?.beginGesture?.();
    } else {
      if (!e.shiftKey) selection.clear();
      marquee = { row0: p.row, tick0: p.tick, row1: p.row, tick1: p.tick };
    }
    canvas.setPointerCapture(e.pointerId); draw(); e.preventDefault();
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = pos(e); lastMouse = { row: p.row, tick: p.tick };
    if (laneDrag) {
      const localY = e.clientY - canvas.getBoundingClientRect().top;
      const laneTop = RULER_H + ROW_H * ROWS_N;
      const vel = yToVelocity(localY - laneTop, VEL_LANE_H);
      if (selection.has(laneDrag) && selection.size > 1) applyGroupDelta([...selection], vel - laneDrag.velocity);
      else {
        const hit = barHitTest(notes(), e.clientX - canvas.getBoundingClientRect().left, xForTick) ?? laneDrag;
        setVelocity(hit, vel);
      }
      draw();
      return;
    }
    if (marquee) { marquee.row1 = p.row; marquee.tick1 = p.tick; draw(); return; }
    if (groupDrag) {
      const wantTick = snapTickToRes(p.tick, snap());
      const dTick = clampGroupTick([...selection], wantTick - groupDrag.lastTick, patternTicks);
      const dRow = p.row - groupDrag.lastRow;
      if (dTick !== 0) { for (const n of selection) n.start += dTick; groupDrag.lastTick += dTick; }
      if (dRow !== 0) {
        const moved = rowMove([...selection], dRow, rows);
        for (const [n, midi] of moved) n.midi = midi;
        groupDrag.lastRow += dRow;
      }
      if (dTick !== 0 || dRow !== 0) draw();
      return;
    }
  });

  const endPointer = (e: PointerEvent) => {
    if (laneDrag) {
      laneDrag = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      historyDeps?.endGesture?.();
      return;
    }
    if (marquee) {
      for (const n of rowsInRect(notes(), marquee, rows)) selection.add(n);
      marquee = null; try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ } draw(); return;
    }
    if (groupDrag) {
      groupDrag = null; try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      historyDeps?.endGesture?.();
      return;
    }
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // ── Keyboard (focus-scoped) ───────────────────────────────────────────────
  wrap.addEventListener('keydown', (e) => {
    if (isTextEditTarget(e.target)) return;
    const cmd = e.metaKey || e.ctrlKey;
    if (e.key === 'Delete' || e.key === 'Backspace') e.stopPropagation();
    if (!cmd && e.key === '1') { currentTool = 'draw'; tools.set('draw'); e.preventDefault(); return; }
    if (!cmd && e.key === '2') { currentTool = 'select'; tools.set('select'); e.preventDefault(); return; }
    if (cmd && e.key.toLowerCase() === 'a') { selection.clear(); for (const n of notes()) selection.add(n); draw(); e.preventDefault(); return; }
    if (e.key === 'Escape') { selection.clear(); draw(); e.preventDefault(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selection.size) {
      const set = new Set(selection);
      const run = () => { setNotes(notes().filter((n) => !set.has(n))); selection.clear(); draw(); };
      historyDeps ? withUndo(historyDeps, run) : run(); e.preventDefault(); return;
    }
    if (cmd && e.key.toLowerCase() === 'c' && selection.size) { clipboard = serializeDrumClipboard([...selection], rows); e.preventDefault(); return; }
    if (cmd && e.key.toLowerCase() === 'x' && selection.size) {
      clipboard = serializeDrumClipboard([...selection], rows);
      const set = new Set(selection);
      const run = () => { setNotes(notes().filter((n) => !set.has(n))); selection.clear(); draw(); };
      historyDeps ? withUndo(historyDeps, run) : run(); e.preventDefault(); return;
    }
    if (cmd && e.key.toLowerCase() === 'v' && clipboard && clipboard.length) {
      const anchorTick = snapTickToRes(lastMouse?.tick ?? 0, snap());
      const anchorRow = lastMouse?.row ?? 0;
      const pasted = pasteDrumClipboard(clipboard, anchorTick, anchorRow, patternTicks, rows);
      const run = () => { for (const n of pasted) notes().push(n); selection.clear(); for (const n of pasted) selection.add(n); draw(); };
      historyDeps ? withUndo(historyDeps, run) : run(); e.preventDefault(); return;
    }
    if (selection.size && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const run = () => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          const d = clampGroupTick([...selection], e.key === 'ArrowRight' ? snap() : -snap(), patternTicks);
          for (const n of selection) n.start += d;
        } else {
          const moved = rowMove([...selection], e.key === 'ArrowDown' ? 1 : -1, rows);
          for (const [n, midi] of moved) n.midi = midi;
        }
        draw();
      };
      historyDeps ? withUndo(historyDeps, run) : run(); e.preventDefault(); return;
    }
  });

  // ── Mount + the host-RAF redraw handle (per-frame width check + playhead) ──
  // The shared axis moved (our ruler scrub, our scroll, or another view of this
  // clip). The guard + "skip the relayout on a plain scroll" memo + scroll
  // mirroring all live in attachPrimaryAxis.
  const primaryAxis = attachPrimaryAxis({
    axis,
    viewport,
    relayout: () => resize(),
    afterApply: () => loopHandle?.redraw(),
  });
  const applyAxis = () => primaryAxis.apply();

  resize();
  viewport.scrollLeft = axis.scrollLeft;      // restore the clip's shared H scroll

  viewport.addEventListener('scroll', () => axis.setScrollLeft(viewport.scrollLeft));

  if (deps.loop) {
    const total = patternTicks;
    loopHandle = mountClipLoopOverlay({
      toolbarHost: deps.loop.toolbarHost,
      scrollHost: viewport,
      clip, meter,
      historyDeps: deps.loop.historyDeps,
      onChange: deps.loop.onChange,
      isLinked: deps.loop.isLinked,
      onToggleLink: deps.loop.onToggleLink,
      onClipLoopEdited: deps.loop.onClipLoopEdited,
      tickToX: (t) => xForTick(t),
      tickFromClientX: (cx) => {
        const x = cx - canvas.getBoundingClientRect().left;
        return pxPerTick > 0 ? Math.max(0, Math.min(total, x / pxPerTick)) : 0;
      },
      contentHeight: () => FRAME_H,
    });
  }

  let lastW = viewport.clientWidth;
  function redraw(): void {
    const w = viewport.clientWidth;
    if (w && w !== lastW) {
      lastW = w;
      primaryAxis.invalidate();               // the viewport itself resized
      applyAxis();                            // resize() republishes the basis
    }
    const ph = deps.getPlayheadTick?.() ?? -1;
    if (ph !== playheadTick) { playheadTick = ph; draw(); }
    if (ph >= 0 && isFollowEnabled()) {
      const target = followScrollTarget(xForTick(ph), viewport.clientWidth, gridW, viewport.scrollLeft);
      if (target != null) viewport.scrollLeft = target;     // fires scroll → publishes to the axis
    }
  }
  return { redraw, dispose: () => primaryAxis.dispose() };
}
