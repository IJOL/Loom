// src/engines/drum-voice-rack.ts
// Renders the per-voice "mini-mixer" rack for a drums lane: one column per
// voice with curated synth knobs + curated mixer (LEVEL/REV/DLY) + a collapsed
// ▸advanced block (raw synth params + PAN + EQ). Each control is built through
// wireEngineParams so it registers under `<laneId>.<id>`, mirrors to
// engineState, and gets undo for free.

import type { SynthEngine, EngineUIContext } from './engine-types';
import { DRUM_LANES, type DrumVoice } from '../core/drums';
import { wireEngineParams } from './engine-ui';

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

export function renderDrumVoiceRack(
  engine: SynthEngine,
  ctx: EngineUIContext,
  host: HTMLElement,
): void {
  const rack = document.createElement('div');
  rack.className = 'drum-voice-rack';

  // Precompute which spec ids exist for the engine so we can split synth vs mixer.
  const idsForVoice = (voice: DrumVoice) =>
    engine.params.map((p) => p.id).filter((id) => id.startsWith(`${voice}.`));

  for (const voice of DRUM_LANES) {
    const col = document.createElement('div');
    col.className = `dv-col ${voice}`;

    const head = document.createElement('div');
    head.className = 'dv-head';
    head.textContent = VOICE_LABELS[voice];
    col.appendChild(head);

    const all = idsForVoice(voice);
    const curatedSynth = CURATED_SYNTH[voice].map((l) => `${voice}.${l}`);
    const curatedMixer = CURATED_MIXER.map((l) => `${voice}.${l}`);
    const advancedMixer = ADVANCED_MIXER.map((l) => `${voice}.${l}`);
    const curatedSet = new Set([...curatedSynth, ...curatedMixer, ...advancedMixer]);
    const advancedSynth = all.filter((id) => !curatedSet.has(id));

    const synthBlock = document.createElement('div');
    synthBlock.className = 'dv-synth';
    col.appendChild(synthBlock);
    wireEngineParams(engine, ctx, synthBlock, {
      knobSize: KNOB, filter: (id) => curatedSynth.includes(id),
    });

    const mixBlock = document.createElement('div');
    mixBlock.className = 'dv-mix';
    col.appendChild(mixBlock);
    wireEngineParams(engine, ctx, mixBlock, {
      knobSize: KNOB, filter: (id) => curatedMixer.includes(id),
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
      knobSize: KNOB, filter: (id) => advancedSynth.includes(id) || advancedMixer.includes(id),
    });

    toggle.addEventListener('click', () => {
      const open = adv.classList.toggle('open');
      toggle.textContent = open ? '▾ adv' : '▸ adv';
    });

    rack.appendChild(col);
  }

  host.appendChild(rack);
}
