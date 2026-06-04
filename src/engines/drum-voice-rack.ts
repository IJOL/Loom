// src/engines/drum-voice-rack.ts
// Renders the per-voice "mini-mixer" rack for a drums lane: one column per
// voice with curated synth knobs + curated mixer (LEVEL/REV/DLY) + a collapsed
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

const VOICE_LABELS: Record<DrumVoice, string> = {
  kick: 'KICK', snare: 'SNARE', closedHat: 'CH', openHat: 'OH',
  clap: 'CLAP', cowbell: 'COWBL', tom: 'TOM', ride: 'RIDE',
};

// Curated synth leaves shown up-front per voice; everything else for that
// voice (minus mixer) drops into ▸advanced.
const CURATED_SYNTH: Record<DrumVoice, string[]> = {
  kick: ['tune', 'attack', 'decay'],
  snare: ['tune', 'tone', 'snap'],
  closedHat: ['tune', 'decay'],
  openHat: ['tune', 'decay'],
  clap: ['tone', 'decay'],
  tom: ['tune', 'decay'],
  cowbell: ['tune', 'decay'],
  ride: ['tune', 'decay'],
};
const CURATED_MIXER = ['level', 'rev', 'dly'];
const ADVANCED_MIXER = ['pan', 'eq.low', 'eq.mid', 'eq.high'];

const KNOB = 34;

// Precondition: the caller clears `host` first (e.g. buildParamUI sets container.innerHTML='');
// this appends a fresh `.drum-voice-rack`.
export function renderDrumVoiceRack(
  engine: SynthEngine,
  ctx: EngineUIContext,
  host: HTMLElement,
): void {
  const rack = document.createElement('div');
  rack.className = 'drum-voice-rack';

  // Precompute which spec ids exist for each voice so we can split synth vs mixer.
  const idsByVoice = new Map<DrumVoice, string[]>(
    DRUM_LANES.map((v) => [v, engine.params.map((p) => p.id).filter((id) => id.startsWith(`${v}.`))]),
  );
  const ms = engine as unknown as DrumMuteSoloEngine;

  for (const voice of DRUM_LANES) {
    const col = document.createElement('div');
    col.className = `dv-col ${voice}`;

    const head = document.createElement('div');
    head.className = 'dv-head';
    head.textContent = VOICE_LABELS[voice];
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
    muteBtn.classList.toggle('on', ms.getDrumVoiceMute(voice));
    const soloBtn = document.createElement('button');
    soloBtn.type = 'button';
    soloBtn.className = 'dv-solo';
    soloBtn.textContent = 'S';
    soloBtn.title = 'Solo this voice (within the kit)';
    soloBtn.classList.toggle('on', ms.getDrumVoiceSolo(voice));
    muteBtn.addEventListener('click', () => {
      const next = !ms.getDrumVoiceMute(voice);
      ms.setDrumVoiceMute(voice, next);
      muteBtn.classList.toggle('on', next);
      if (ctx.sessionState) mirrorDrumMutes(ctx.sessionState, ctx.laneId, ms.getDrumVoiceMutes());
    });
    soloBtn.addEventListener('click', () => {
      ms.toggleDrumVoiceSolo(voice);
      soloBtn.classList.toggle('on', ms.getDrumVoiceSolo(voice));
    });
    msRow.appendChild(muteBtn);
    msRow.appendChild(soloBtn);
    col.appendChild(msRow);

    const all = idsByVoice.get(voice)!;
    const curatedSynth = new Set(CURATED_SYNTH[voice].map((l) => `${voice}.${l}`));
    const curatedMixer = new Set(CURATED_MIXER.map((l) => `${voice}.${l}`));
    const advancedMixer = new Set(ADVANCED_MIXER.map((l) => `${voice}.${l}`));
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

  host.appendChild(rack);
}
