// src/engines/drum-voice-rack.ts
// Renders the per-voice "mini-mixer" rack for a drums lane: one column per
// voice with curated synth knobs + curated mixer (LEVEL/A/B) + a collapsed
// ▸advanced block (raw synth params + PAN + EQ). Each control is built through
// wireEngineParams so it registers under `<laneId>.<id>`, mirrors to
// engineState, and gets undo for free.

import type { SynthEngine, EngineUIContext } from './engine-types';
import { DRUM_LANES, type DrumVoice } from '../core/drums';
import { wireEngineParams } from './engine-ui';
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

  const rack = document.createElement('div');
  rack.className = 'drum-voice-rack';

  // Precompute which spec ids exist for each voice so we can split synth vs mixer.
  const idsByVoice = new Map<string, string[]>(
    voices.map((v) => [v, engine.params.map((p) => p.id).filter((id) => id.startsWith(`${v}.`))]),
  );
  const ms = engine as unknown as DrumMuteSoloEngine;

  for (const voice of voices) {
    const col = document.createElement('div');
    col.className = `dv-col ${voice}`;
    col.dataset.voice = voice;
    if (opts.isSelected?.(voice)) col.classList.add('selected');

    const head = document.createElement('div');
    head.className = 'dv-head';
    // Actions row (▶ play / ✕ delete) centred at the TOP, separated from the name
    // below by a divider line.
    if (opts.onAudition || opts.onDelete) {
      const actions = document.createElement('div');
      actions.className = 'dv-actions';
      if (opts.onAudition) {
        const play = document.createElement('button');
        play.type = 'button';
        play.className = 'dv-play';
        play.textContent = '▶';
        play.title = 'Play this sample';
        play.addEventListener('click', (e) => { e.stopPropagation(); opts.onAudition!(voice); });
        actions.appendChild(play);
      }
      if (opts.onDelete) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'dv-del';
        del.textContent = '✕';
        del.title = 'Delete this pad';
        del.addEventListener('click', () => opts.onDelete!(voice));
        actions.appendChild(del);
      }
      head.appendChild(actions);
    }
    const nameEl = document.createElement('span');
    nameEl.className = 'dv-name';
    nameEl.textContent = opts.labelOf?.(voice) ?? VOICE_LABELS[voice as DrumVoice] ?? voice.toUpperCase();
    head.appendChild(nameEl);
    if (opts.keyOf) {
      const keyEl = document.createElement('span');
      keyEl.className = 'dv-key';
      keyEl.textContent = opts.keyOf(voice);
      head.appendChild(keyEl);
    }
    // Clicking the header (not the ✕) selects this channel → drives the sample editor.
    if (opts.onSelect) {
      head.classList.add('dv-head-sel');
      head.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        rack.querySelectorAll('.dv-col.selected').forEach((c) => c.classList.remove('selected'));
        col.classList.add('selected');
        opts.onSelect!(voice);
      });
    }
    col.appendChild(head);

    // Per-voice mute/solo. Mute persists (mirrored to engineState); solo is
    // live-only (exclusive within the kit, applied via channels[voice].setMuted).
    const msRow = document.createElement('div');
    msRow.className = 'dv-ms';
    const muteBtn = document.createElement('button');
    muteBtn.type = 'button';
    muteBtn.className = 'dv-mute';
    muteBtn.textContent = 'M';
    muteBtn.title = 'Mute this voice';
    muteBtn.classList.toggle('on', ms.getDrumVoiceMute(voice as DrumVoice));
    const soloBtn = document.createElement('button');
    soloBtn.type = 'button';
    soloBtn.className = 'dv-solo';
    soloBtn.textContent = 'S';
    soloBtn.title = 'Solo this voice (within the kit)';
    soloBtn.classList.toggle('on', ms.getDrumVoiceSolo(voice as DrumVoice));
    muteBtn.addEventListener('click', () => {
      const next = !ms.getDrumVoiceMute(voice as DrumVoice);
      ms.setDrumVoiceMute(voice as DrumVoice, next);
      muteBtn.classList.toggle('on', next);
      if (ctx.sessionState) mirrorDrumMutes(ctx.sessionState, ctx.laneId, ms.getDrumVoiceMutes());
    });
    soloBtn.addEventListener('click', () => {
      ms.toggleDrumVoiceSolo(voice as DrumVoice);
      soloBtn.classList.toggle('on', ms.getDrumVoiceSolo(voice as DrumVoice));
    });
    msRow.appendChild(muteBtn);
    msRow.appendChild(soloBtn);
    col.appendChild(msRow);

    const all = idsByVoice.get(voice)!;
    const curatedSynth = new Set(layout.curatedSynth.map((l) => `${voice}.${l}`));
    const curatedMixer = new Set(layout.curatedMixer.map((l) => `${voice}.${l}`));
    const advancedMixer = new Set(layout.advancedMixer.map((l) => `${voice}.${l}`));
    const advancedSynth = new Set(all.filter((id) => !curatedSynth.has(id) && !curatedMixer.has(id) && !advancedMixer.has(id)));

    const synthBlock = document.createElement('div');
    synthBlock.className = 'dv-synth';
    col.appendChild(synthBlock);
    wireEngineParams(engine, ctx, synthBlock, {
      knobSize: KNOB, filter: (id) => curatedSynth.has(id),
    });

    const mixBlock = document.createElement('div');
    mixBlock.className = 'dv-mix';
    col.appendChild(mixBlock);
    wireEngineParams(engine, ctx, mixBlock, {
      knobSize: KNOB, filter: (id) => curatedMixer.has(id),
    });

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'dv-adv-toggle';
    toggle.textContent = '▸ adv';
    col.appendChild(toggle);

    const adv = document.createElement('div');
    adv.className = 'dv-advanced';
    col.appendChild(adv);
    wireEngineParams(engine, ctx, adv, {
      knobSize: KNOB, filter: (id) => advancedSynth.has(id) || advancedMixer.has(id),
    });

    toggle.addEventListener('click', () => {
      const open = adv.classList.toggle('open');
      toggle.textContent = open ? '▾ adv' : '▸ adv';
    });

    rack.appendChild(col);
  }

  // A "+" tile after the last channel adds a pad (the standard add affordance,
  // right where the modules are). Delete is per-channel (the ✕ on each strip).
  if (opts.onAdd) {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'dv-add';
    add.textContent = '＋';
    add.title = 'Add a pad';
    add.addEventListener('click', () => opts.onAdd!());
    rack.appendChild(add);
  }

  host.appendChild(rack);
}
