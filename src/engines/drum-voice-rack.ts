// src/engines/drum-voice-rack.ts
// Renders the per-voice "mini-mixer" rack for a drums lane: one column per
// voice with curated synth knobs + curated mixer (LEVEL/A/B) + a collapsed
// ▸advanced block (raw synth params + PAN + EQ). Each control is built through
// buildEngineParamGrid in its flat layout, so it registers under
// `<laneId>.<id>`, mirrors to engineState, and gets undo for free.

import { html, render, nothing, type TemplateResult } from 'lit-html';
import type { SynthEngine, EngineUIContext } from './engine-types';
import { DRUM_LANES, type DrumVoice } from '../core/drums';
import { buildEngineParamGrid } from './engine-param-grid';
import { mirrorDrumMutes } from '../session/session-engine-state';

/** The drum mute/solo surface the rack drives (DrumsEngine implements it). */
interface DrumMuteSoloEngine {
  getDrumVoiceMute(v: DrumVoice): boolean;
  setDrumVoiceMute(v: DrumVoice, m: boolean): void;
  getDrumVoiceSolo(v: DrumVoice): boolean;
  toggleDrumVoiceSolo(v: DrumVoice): void;
  getDrumVoiceMutes(): Record<string, boolean>;
}

export const VOICE_LABELS: Record<DrumVoice, string> = {
  kick: 'KICK', snare: 'SNARE', rimshot: 'RIM', closedHat: 'CH', openHat: 'OH',
  clap: 'CLAP', cowbell: 'COWBL', tom: 'TOM', ride: 'RIDE', crash: 'CRASH',
};

export interface RackLayout {
  curatedSynth: string[];   // leaf names shown up-front per voice
  curatedMixer: string[];   // mixer leaves shown up-front
  advancedMixer: string[];  // mixer leaves collapsed into ▸advanced
}

// Default layout for engines that do NOT implement getRackLayout.
// curatedSynth is empty so all synth leaves fall through to advanced.
const DEFAULT_LAYOUT: RackLayout = {
  curatedSynth: [],
  curatedMixer: ['level', 'rev', 'dly'],
  advancedMixer: ['pan', 'eq.low', 'eq.mid', 'eq.high'],
};

const KNOB = 34;

// Precondition: the caller clears `host` first (e.g. buildParamUI sets container.innerHTML='');
// this appends a fresh `.drum-voice-rack`.
/** Optional per-column extras for the SAMPLER drumkit (a pad has a trigger key and
 *  can be deleted). Synth drums omit these — their voices are fixed. */
export interface DrumRackOpts {
  labelOf?: (voice: string) => string;   // override the column title (melodic: a note name)
  keyOf?: (voice: string) => string;     // e.g. 'kick' → 'D1'
  onDelete?: (voice: string) => void;    // remove this pad
  onSelect?: (voice: string) => void;    // select this channel (drives the sample editor)
  isSelected?: (voice: string) => boolean;
  onAdd?: () => void;                    // a "+" tile after the last column adds a pad
  onAudition?: (voice: string) => void;  // ▶ play this channel's sample
}

export function renderDrumVoiceRack(
  engine: SynthEngine,
  ctx: EngineUIContext,
  host: HTMLElement,
  voices: string[] = DRUM_LANES as unknown as string[],
  opts: DrumRackOpts = {},
): void {
  const layout = (engine as unknown as { getRackLayout?: () => RackLayout }).getRackLayout?.() ?? DEFAULT_LAYOUT;
  const ms = engine as unknown as DrumMuteSoloEngine;

  // One-shot lit render into a fragment (the whole rack is rebuilt by the
  // caller on any structural change, so no panel lifecycle is needed), then
  // the `.drum-voice-rack` element is pulled out and appended — keeping the
  // documented contract of appending a fresh rack to a caller-cleared host.
  const frag = document.createDocumentFragment();
  render(html`
    <div class="drum-voice-rack">
      ${voices.map((voice) => colTemplate(voice, ms, ctx, opts))}
      ${opts.onAdd
        // A "+" tile after the last channel adds a pad (the standard add
        // affordance, right where the modules are). Delete is per-channel
        // (the ✕ on each strip).
        ? html`<button type="button" class="dv-add" title="Add a pad" @click=${() => opts.onAdd!()}>＋</button>`
        : nothing}
    </div>
  `, frag);
  const rack = frag.firstElementChild as HTMLElement;

  // The knobs/selects are imperative widgets (the grid registers each under
  // `<laneId>.<id>` and mirrors to engineState), so they are appended
  // into the rendered blocks after the template pass — one build per rack,
  // exactly as before. Split per the layout: curated synth vs curated mixer
  // up-front, everything else into the collapsed ▸advanced block.
  const paramIds = engine.params.map((p) => p.id);
  for (const col of rack.querySelectorAll<HTMLElement>(':scope > .dv-col')) {
    const voice = col.dataset.voice!;
    const all = paramIds.filter((id) => id.startsWith(`${voice}.`));
    const curatedSynth = new Set(layout.curatedSynth.map((l) => `${voice}.${l}`));
    const curatedMixer = new Set(layout.curatedMixer.map((l) => `${voice}.${l}`));
    const advancedMixer = new Set(layout.advancedMixer.map((l) => `${voice}.${l}`));
    const advancedSynth = new Set(all.filter((id) => !curatedSynth.has(id) && !curatedMixer.has(id) && !advancedMixer.has(id)));

    const block = (sel: string, keep: (id: string) => boolean) =>
      buildEngineParamGrid(engine, ctx, col.querySelector<HTMLElement>(sel)!, {
        layout: 'flat', knobSize: KNOB, skip: (id) => !keep(id),
      });
    block('.dv-synth',    (id) => curatedSynth.has(id));
    block('.dv-mix',      (id) => curatedMixer.has(id));
    block('.dv-advanced', (id) => advancedSynth.has(id) || advancedMixer.has(id));
  }

  host.appendChild(rack);
}

function colTemplate(
  voice: string,
  ms: DrumMuteSoloEngine,
  ctx: EngineUIContext,
  opts: DrumRackOpts,
): TemplateResult {
  // Clicking the header (not the ✕) selects this channel → drives the sample editor.
  const onHeadClick = (e: Event) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const col = (e.currentTarget as HTMLElement).closest('.dv-col') as HTMLElement;
    col.closest('.drum-voice-rack')!.querySelectorAll('.dv-col.selected').forEach((c) => c.classList.remove('selected'));
    col.classList.add('selected');
    opts.onSelect!(voice);
  };
  // Per-voice mute/solo. Mute persists (mirrored to engineState); solo is
  // live-only (exclusive within the kit, applied via channels[voice].setMuted).
  // The template renders once, so the buttons update their own .on class.
  const onMute = (e: Event) => {
    const next = !ms.getDrumVoiceMute(voice as DrumVoice);
    ms.setDrumVoiceMute(voice as DrumVoice, next);
    (e.currentTarget as HTMLElement).classList.toggle('on', next);
    if (ctx.sessionState) mirrorDrumMutes(ctx.sessionState, ctx.laneId, ms.getDrumVoiceMutes());
  };
  const onSolo = (e: Event) => {
    ms.toggleDrumVoiceSolo(voice as DrumVoice);
    (e.currentTarget as HTMLElement).classList.toggle('on', ms.getDrumVoiceSolo(voice as DrumVoice));
  };
  const onAdvToggle = (e: Event) => {
    const toggle = e.currentTarget as HTMLElement;
    const adv = toggle.nextElementSibling as HTMLElement;   // the .dv-advanced block below
    const open = adv.classList.toggle('open');
    toggle.textContent = open ? '▾ adv' : '▸ adv';
  };

  return html`
    <div class="dv-col ${voice}${opts.isSelected?.(voice) ? ' selected' : ''}" data-voice=${voice}>
      <div class=${opts.onSelect ? 'dv-head dv-head-sel' : 'dv-head'} @click=${opts.onSelect ? onHeadClick : nothing}>
        ${opts.onAudition || opts.onDelete
          // Actions row (▶ play / ✕ delete) centred at the TOP, separated from
          // the name below by a divider line.
          ? html`
            <div class="dv-actions">
              ${opts.onAudition ? html`<button type="button" class="dv-play" title="Play this sample"
                  @click=${(e: Event) => { e.stopPropagation(); opts.onAudition!(voice); }}>▶</button>` : nothing}
              ${opts.onDelete ? html`<button type="button" class="dv-del" title="Delete this pad"
                  @click=${() => opts.onDelete!(voice)}>✕</button>` : nothing}
            </div>`
          : nothing}
        <span class="dv-name">${opts.labelOf?.(voice) ?? VOICE_LABELS[voice as DrumVoice] ?? voice.toUpperCase()}</span>
        ${opts.keyOf ? html`<span class="dv-key">${opts.keyOf(voice)}</span>` : nothing}
      </div>
      <div class="dv-ms">
        <button type="button" class="dv-mute${ms.getDrumVoiceMute(voice as DrumVoice) ? ' on' : ''}"
            title="Mute this voice" @click=${onMute}>M</button>
        <button type="button" class="dv-solo${ms.getDrumVoiceSolo(voice as DrumVoice) ? ' on' : ''}"
            title="Solo this voice (within the kit)" @click=${onSolo}>S</button>
      </div>
      <div class="dv-synth"></div>
      <div class="dv-mix"></div>
      <button type="button" class="dv-adv-toggle" @click=${onAdvToggle}>▸ adv</button>
      <div class="dv-advanced"></div>
    </div>
  `;
}
