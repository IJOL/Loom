import type { PianoRollHandle } from '../core/pianoroll';
import type { PolySynth } from '../polysynth/polysynth';
import type { DrumVoice } from '../core/drums';
import type { Sequencer } from '../core/sequencer';
import type { PatternBank, PolyTrack } from '../core/pattern';
import type { ChannelStrip } from '../core/fx';

export type ExtraId =
  | 'poly1' | 'poly2' | 'poly3' | 'poly4' | 'poly5' | 'poly6' | 'poly7' | 'poly8'
  | 'poly9' | 'poly10' | 'poly11' | 'poly12' | 'poly13' | 'poly14' | 'poly15' | 'poly16';

export const EXTRA_IDS: ExtraId[] = [
  'poly1','poly2','poly3','poly4','poly5','poly6','poly7','poly8',
  'poly9','poly10','poly11','poly12','poly13','poly14','poly15','poly16',
];

export interface RollEntry {
  handle: PianoRollHandle;
  scrollEl: HTMLElement;
  canvasEl: HTMLCanvasElement;
}

export interface BassCellRefs {
  el: HTMLDivElement;
  noteSel: HTMLSelectElement;
  onBtn: HTMLButtonElement;
  accentBtn: HTMLButtonElement;
  slideBtn: HTMLButtonElement;
}

export interface MelodyCellRefs {
  el: HTMLDivElement;
  noteSel: HTMLSelectElement;
  onBtn: HTMLButtonElement;
  accentBtn: HTMLButtonElement;
  tieBtn: HTMLButtonElement;
  chordBtn: HTMLButtonElement;
}

export const classicState = {
  bassCells:        {} as Record<number, BassCellRefs>,
  melodyCells:      {} as Record<number, MelodyCellRefs>,
  drumCells: {
    kick: {}, snare: {}, closedHat: {}, openHat: {},
    clap: {}, cowbell: {}, tom: {}, ride: {},
  } as Record<DrumVoice, Record<number, HTMLButtonElement>>,
  mainRollEntry:    null as RollEntry | null,
  bassRollEntry:    null as RollEntry | null,
  extraRolls:       new Map<string, RollEntry>(),
  pianoRoll:        null as PianoRollHandle | null,
  viewStart:        0,
  currentSynthLane: 'main' as string,
  activePolyTarget: null as PolySynth | null,
};

export interface ClassicDeps {
  seq: Sequencer;
  bank: PatternBank;
  polysynth: PolySynth;
  extraPolys: Partial<Record<ExtraId, PolySynth>>;
  extraStrips: Partial<Record<ExtraId, ChannelStrip>>;
  ensureExtraPoly: (id: ExtraId) => PolySynth;
  extraPolyIds: readonly ExtraId[];
  laneLabels: Record<string, string>;
  bassTracksEl: HTMLDivElement;
  drumTracksEl: HTMLDivElement;
  polyTracksEl: HTMLDivElement;
  VIEW_SIZE: number;
  midiLabel: (m: number) => string;
  setBassMode: (mode: 'step' | 'piano') => void;
  refreshPolyKnobsFromState: () => void;
  refreshPolyPresetSelect: () => void;
  setActiveEngineLane: (laneId: string) => void;
  rebuildMixer: () => void;
  buildArpUI: (opts: { getExtraPolyTracks: () => PolyTrack[] }) => void;
}
