import { DRUM_LANES, type DrumVoice } from '../core/drums';
import { MAX_EXTRA_POLY_TRACKS } from '../core/pattern';
import { TICKS_PER_STEP, type NoteEvent } from '../core/notes';
import type { Sequencer } from '../core/sequencer';
import type { PolySynth } from '../polysynth/polysynth';

type ExtraId =
  | 'poly1' | 'poly2' | 'poly3' | 'poly4' | 'poly5' | 'poly6' | 'poly7' | 'poly8'
  | 'poly9' | 'poly10' | 'poly11' | 'poly12' | 'poly13' | 'poly14' | 'poly15' | 'poly16';

const EXTRA_IDS: ExtraId[] = [
  'poly1','poly2','poly3','poly4','poly5','poly6','poly7','poly8',
  'poly9','poly10','poly11','poly12','poly13','poly14','poly15','poly16',
];

// Minimal SMF parser (matches scripts/parse-midi.mjs).
interface ParsedTrack {
  index: number;
  name: string;
  program: number;
  notes: { startTick: number; duration: number; midi: number; velocity: number; channel: number }[];
}

function parseMidiFile(buf: Uint8Array): { division: number; tracks: ParsedTrack[] } {
  let p = 0;
  const u8 = () => buf[p++];
  const u16 = () => (buf[p++] << 8) | buf[p++];
  const u32 = () => (buf[p++] * 0x1000000) + (buf[p++] << 16) + (buf[p++] << 8) + buf[p++];
  const vlq = () => { let v = 0, b; do { b = buf[p++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };

  if (String.fromCharCode(buf[0], buf[1], buf[2], buf[3]) !== 'MThd') throw new Error('not SMF');
  p = 4;
  const hLen = u32(); u16(); /* format */ const ntracks = u16(); const division = u16();
  p = 4 + 4 + hLen;
  const tracks: ParsedTrack[] = [];
  for (let t = 0; t < ntracks; t++) {
    if (String.fromCharCode(buf[p], buf[p+1], buf[p+2], buf[p+3]) !== 'MTrk') break;
    p += 4;
    const tlen = u32();
    const tend = p + tlen;
    let abs = 0; let lastStatus = 0; let name = ''; let program = -1;
    const noteOn = new Map<number, number>();
    const notes: ParsedTrack['notes'] = [];
    while (p < tend) {
      abs += vlq();
      let status = buf[p];
      if (status < 0x80) { status = lastStatus; } else { p++; lastStatus = status; }
      if (status === 0xff) {
        const type = u8(); const len = vlq();
        if (type === 0x03) name = String.fromCharCode(...buf.slice(p, p + len));
        p += len;
      } else if (status === 0xf0 || status === 0xf7) {
        const len = vlq(); p += len;
      } else {
        const high = status & 0xf0;
        const ch = status & 0x0f;
        if (high === 0x80 || high === 0x90) {
          const note = u8(); const vel = u8();
          const isOff = high === 0x80 || vel === 0;
          const key = (ch << 8) | note;
          if (!isOff) noteOn.set(key, abs);
          else {
            const start = noteOn.get(key);
            if (start != null) {
              notes.push({ startTick: start, duration: abs - start, midi: note, velocity: 80, channel: ch });
              noteOn.delete(key);
            }
          }
        } else if (high === 0xc0) {
          program = u8();
        } else if (high === 0xa0 || high === 0xb0 || high === 0xe0) {
          p += 2;
        } else if (high === 0xd0) {
          p += 1;
        }
      }
    }
    tracks.push({ index: t, name, program, notes });
  }
  return { division, tracks };
}

// Map GM program number to a factory polysynth preset name so imported MIDI
// tracks get a tone that roughly matches their original instrument.
function presetFromProgram(prog: number): string {
  // 0-7 pianos / EP / harpsichord
  if (prog === 0 || prog === 1) return 'KEY Acoustic Piano';   // Grand / Bright Acoustic
  if (prog === 2) return 'KEY Acoustic Piano';                  // Electric Grand
  if (prog === 3) return 'KEY Acoustic Piano';                  // Honky-tonk
  if (prog === 4 || prog === 5) return 'KEY Rhodes';            // EP 1, EP 2
  if (prog === 6) return 'KEY Rhodes';                          // Harpsichord
  if (prog === 7) return 'PLUCK Digital';                       // Clavinet
  // 8-15 chromatic percussion
  if (prog === 8)  return 'BELL FM';
  if (prog === 9 || prog === 10) return 'BELL FM';
  if (prog === 11 || prog === 12) return 'PLUCK Marimba';
  if (prog === 13) return 'PLUCK Marimba';
  if (prog === 14 || prog === 15) return 'BELL FM';
  // 16-23 organs
  if (prog >= 16 && prog <= 23) return 'PAD Organ';
  // 24-31 guitars
  if (prog >= 24 && prog <= 27) return 'PLUCK Digital';
  if (prog >= 28 && prog <= 31) return 'LEAD Bright Saw';
  // 32-39 basses
  if (prog === 32) return 'BASS Plucky';
  if (prog === 33) return 'BASS Big Saws';
  if (prog === 34) return 'BASS Punchy';
  if (prog === 35) return 'BASS Sub 808';
  if (prog === 36) return 'BASS Plucky';
  if (prog === 37) return 'BASS Punchy';
  if (prog === 38) return 'BASS Wobble';
  if (prog === 39) return 'BASS Reese';
  // 40-47 solo strings / pizz / harp
  if (prog >= 40 && prog <= 44) return 'PAD Detuned Strings';
  if (prog === 45) return 'PLUCK Marimba';
  if (prog === 46) return 'BELL FM';
  if (prog === 47) return 'PLUCK Digital';
  // 48-51 strings / synth strings
  if (prog === 48 || prog === 49) return 'PAD Detuned Strings';
  if (prog === 50) return 'PAD Sweep';
  if (prog === 51) return 'PAD Warm';
  // 52-54 choir / voice
  if (prog === 52) return 'VOX Aah';
  if (prog === 53) return 'VOX Ooh';
  if (prog === 54) return 'VOX Hum Choir';
  // 55 orchestra hit
  if (prog === 55) return 'LEAD Brass Stab';
  // 56-63 brass
  if (prog >= 56 && prog <= 63) return 'LEAD Brass Stab';
  // 64-79 reed / pipe
  if (prog >= 64 && prog <= 79) return 'LEAD Soft Sine';
  // 80-87 synth lead
  if (prog === 80) return 'LEAD Square';
  if (prog === 81) return 'LEAD Bright Saw';
  if (prog === 82) return 'LEAD Soft Sine';
  if (prog === 83) return 'LEAD Bright Saw';
  if (prog === 84) return 'LEAD Supersaw';
  if (prog === 85) return 'VOX Hum Choir';
  if (prog === 86) return 'LEAD Trance';
  if (prog === 87) return 'LEAD Hoover';
  // 88-95 synth pad
  if (prog === 88) return 'PAD Warm';
  if (prog === 89) return 'PAD Sweep';
  if (prog === 90) return 'PAD Glass';
  if (prog === 91) return 'PAD Choir Aah';
  if (prog === 92) return 'PAD Detuned Strings';
  if (prog === 93) return 'PAD Glass';
  if (prog === 94 || prog === 95) return 'PAD Sweep';
  // 96-103 synth effects
  if (prog >= 96 && prog <= 103) return 'FX Sci-Fi';
  // 104+ ethnic / percussive / SFX
  if (prog >= 120) return 'FX Noise Sweep';
  return 'Init';
}

// GM drum channel (MIDI ch 10 = 0-indexed 9) note → DrumMachine voice.
const DRUM_NOTE_TO_VOICE: Record<number, DrumVoice> = {
  35: 'kick', 36: 'kick',
  37: 'snare', 38: 'snare', 40: 'snare',
  39: 'clap',
  42: 'closedHat', 44: 'closedHat',
  46: 'openHat',
  41: 'tom', 43: 'tom', 45: 'tom', 47: 'tom', 48: 'tom', 50: 'tom',
  49: 'ride', 51: 'ride', 53: 'ride', 57: 'ride', 59: 'ride',
  56: 'cowbell',
};
function midiNoteToDrumVoice(note: number): DrumVoice | null {
  return DRUM_NOTE_TO_VOICE[note] ?? null;
}

export interface MidiImportDeps {
  seq: Sequencer;
  muteState: Record<string, boolean>;
  applyMuteSolo: () => void;
  refreshLoopBtn: () => void;
  refresh?: () => void;
  flashButton: (b: HTMLButtonElement, msg: string) => void;
  ensureExtraPoly: (id: ExtraId) => PolySynth;
  applyPresetByName: (poly: PolySynth, name: string) => void;
}

export function wireMidiImport(deps: MidiImportDeps): void {
  const { seq, muteState, applyMuteSolo, refreshLoopBtn, flashButton, ensureExtraPoly, applyPresetByName } = deps;

  const fileInput = document.getElementById('poly-midi-file') as HTMLInputElement;
  const trackListEl = document.getElementById('poly-midi-tracklist') as HTMLDivElement;
  const loadBtn = document.getElementById('poly-midi-load') as HTMLButtonElement;

  let parsedMidi: ReturnType<typeof parseMidiFile> | null = null;

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    const buf = new Uint8Array(await f.arrayBuffer());
    try {
      parsedMidi = parseMidiFile(buf);
    } catch (err) {
      alert('Not a valid SMF: ' + (err as Error).message);
      return;
    }
    // Build a checkbox list for every track that has notes.
    trackListEl.innerHTML = '';
    parsedMidi.tracks.forEach((tr) => {
      if (tr.notes.length === 0) return;
      const lo = Math.min(...tr.notes.map((n) => n.midi));
      const hi = Math.max(...tr.notes.map((n) => n.midi));
      const lbl = document.createElement('label');
      lbl.className = 'midi-track-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.idx = String(tr.index);
      cb.checked = true; // default check all
      const txt = document.createElement('span');
      txt.textContent = ` [${tr.index}] ${tr.name || 'untitled'} — ${tr.notes.length} notes, range ${lo}-${hi}, prog ${tr.program} → preset "${presetFromProgram(tr.program)}"`;
      lbl.append(cb, txt);
      trackListEl.appendChild(lbl);
    });
    trackListEl.style.display = '';
    loadBtn.style.display = '';
  });

  loadBtn.addEventListener('click', () => {
    if (!parsedMidi) return;
    const TICKS_PER_QUARTER = 96;
    const scale = TICKS_PER_QUARTER / parsedMidi.division;
    const checks = Array.from(trackListEl.querySelectorAll<HTMLInputElement>('input[type=checkbox]:checked'));

    // Clear existing extras
    seq.pattern.extraPolyTracks = [];

    // Global min start across all selected tracks so they align.
    let globalMinStart = Infinity;
    let globalMaxEnd = 0;
    const selected = checks
      .map((cb) => parsedMidi!.tracks.find((t) => t.index === parseInt(cb.dataset.idx ?? '', 10)))
      .filter((t): t is NonNullable<typeof t> => !!t);
    for (const tr of selected) {
      for (const n of tr.notes) {
        if (n.startTick < globalMinStart) globalMinStart = n.startTick;
        const end = n.startTick + n.duration;
        if (end > globalMaxEnd) globalMaxEnd = end;
      }
    }
    if (!isFinite(globalMinStart)) globalMinStart = 0;

    // Expand pattern length to fit the full MIDI duration.
    const songTicks = Math.ceil((globalMaxEnd - globalMinStart) * scale);
    const requiredSteps = Math.max(seq.length, Math.ceil(songTicks / TICKS_PER_STEP) + 4);
    if (requiredSteps !== seq.length) seq.setLength(requiredSteps);

    // Split selected tracks: drums (channel 9 in 0-indexed) vs tonal.
    const drumTracks = selected.filter((tr) => tr.notes.some((n) => n.channel === 9));
    const polyTracks = selected.filter((tr) => !tr.notes.some((n) => n.channel === 9));

    // Drum tracks → step grid via GM percussion map (quantize to 16ths).
    if (drumTracks.length > 0) {
      for (const lane of DRUM_LANES) {
        for (const s of seq.drums[lane]) { s.on = false; s.accent = false; s.roll = 0; }
      }
      for (const tr of drumTracks) {
        for (const n of tr.notes) {
          const voice = midiNoteToDrumVoice(n.midi);
          if (!voice) continue;
          const stepIdx = Math.floor((n.startTick - globalMinStart) * scale / TICKS_PER_STEP);
          if (stepIdx < 0 || stepIdx >= seq.length) continue;
          seq.drums[voice][stepIdx].on = true;
          if (n.velocity >= 100) seq.drums[voice][stepIdx].accent = true;
        }
      }
    }

    // Tonal tracks → extra polysynth slots
    let nextSlot = 0;
    for (const tr of polyTracks) {
      if (nextSlot >= MAX_EXTRA_POLY_TRACKS) break;
      const notes: NoteEvent[] = tr.notes.map((n) => ({
        start: Math.round((n.startTick - globalMinStart) * scale),
        duration: Math.max(6, Math.round(n.duration * scale)),
        midi: n.midi,
        velocity: n.velocity,
      }));
      const id = EXTRA_IDS[nextSlot];
      seq.pattern.extraPolyTracks.push({
        id,
        name: tr.name || `Track ${tr.index}`,
        enabled: true,
        notes,
      });
      applyPresetByName(ensureExtraPoly(id), presetFromProgram(tr.program));
      nextSlot++;
    }

    // Auto-mute the step-based "demo" tracks (bass + main poly).
    // Drums only mute if NO drum track came from the MIDI.
    muteState.bass = true;
    muteState.poly = true;
    if (drumTracks.length === 0) {
      for (const lane of DRUM_LANES) muteState[lane] = true;
    } else {
      for (const lane of DRUM_LANES) muteState[lane] = false;
    }
    applyMuteSolo();

    // MIDI is a one-shot song, not a 1-bar loop. Stop looping.
    seq.loopEnabled = false;
    refreshLoopBtn();

    deps.refresh?.();
    flashButton(loadBtn, `Loaded ${nextSlot} poly + ${drumTracks.length} drum, ${requiredSteps} steps, no loop`);
  });
}
