// src/control/live-recorder.ts
// Pure loop-record state machine: pairs live note on/off into NoteEvents,
// stamped from a caller-provided play-position reader. No audio, no DOM.
import type { NoteEvent } from '../core/notes';

interface StartOpts {
  mode: 'merge' | 'replace';
  existingNotes: NoteEvent[];
  clipLengthTicks: number | null;   // null = new clip (round length up to bar)
  barTicks: number;
  posTicks: () => number;
}

export interface LiveRecorder {
  start(opts: StartOpts): void;
  noteOn(midi: number, velocity: number): void;
  noteOff(midi: number): void;
  stop(): { notes: NoteEvent[]; lengthTicks: number };
  isRecording(): boolean;
}

export function createLiveRecorder(): LiveRecorder {
  let recording = false;
  let opts: StartOpts | null = null;
  const open = new Map<number, { start: number; velocity: number }>(); // midi → onset
  let captured: NoteEvent[] = [];

  return {
    start(o) { recording = true; opts = o; open.clear(); captured = []; },
    isRecording: () => recording,
    noteOn(midi, velocity) {
      if (!recording || !opts) return;
      open.set(midi, { start: opts.posTicks(), velocity });
    },
    noteOff(midi) {
      if (!recording || !opts) return;
      const on = open.get(midi);
      if (!on) return;
      open.delete(midi);
      const end = opts.posTicks();
      const duration = Math.max(1, end - on.start);
      captured.push({ start: on.start, duration, midi, velocity: on.velocity });
    },
    stop() {
      recording = false;
      const o = opts; opts = null;
      if (!o) return { notes: [], lengthTicks: 0 };
      const base = o.mode === 'merge' ? [...o.existingNotes] : [];
      let notes = [...base, ...captured];
      let lengthTicks: number;
      if (o.clipLengthTicks != null) {
        lengthTicks = o.clipLengthTicks;
        // clamp: drop notes starting past the end; trim durations that overrun
        notes = notes
          .filter((n) => n.start < lengthTicks)
          .map((n) => ({ ...n, duration: Math.max(1, Math.min(n.duration, lengthTicks - n.start)) }));
      } else {
        const end = notes.reduce((mx, n) => Math.max(mx, n.start + n.duration), 0);
        lengthTicks = Math.max(o.barTicks, Math.ceil(end / o.barTicks) * o.barTicks);
      }
      return { notes, lengthTicks };
    },
  };
}
