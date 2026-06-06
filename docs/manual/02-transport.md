# Transport

The header runs across the top of the interface in two rows. The first row (transport & tempo) holds the playback and timing controls you touch while the music plays; the second row (session & I/O) holds the mode toggle, recording/export, and session file management.

![Transport bar](images/transport.png)

---

## Play / Stop

Press **▶** (`#play`, title "Play — arranca el transporte") to start playback, and **⏹** (`#stop`, title "Stop — detiene el transporte") to stop it. Play and Stop are now two separate buttons — Play is no longer a play/stop toggle. When you press Play the browser's `AudioContext` resumes automatically if it was suspended (a browser policy requirement on first interaction).

---

## Position and time readout

The readout shows two values side by side:

- **Bar.Beat.Step** (`#transport-position`, e.g. `1.1.1`) — the current song position derived from elapsed time, BPM, and the active meter. The counter resets to `1.1.1` on each new Play.
- **Elapsed** (`#transport-time`, e.g. `00:00:00`) — wall-clock time since the most recent Play press.

Both readouts update via `requestAnimationFrame` while playing and freeze on stop so you can read the final position. Because each lane has its own independent loop clock, the global position is computed from elapsed seconds rather than a single sequencer cursor. The visual playhead is similarly a display-only timer matched to scheduled audio time; it may drift slightly under browser tab throttling, but audio scheduling is unaffected.

---

## Tempo controls

**BPM** (`#bpm`) — sets the tempo. Range: 40–240 BPM, default 130. You can type a value directly or use the number-input spinners. BPM changes propagate immediately to the sequencer, all lane engines, delay/LFO sync, and stretch-mode loop buffers. The change takes effect on the next scheduled step; it does not alter a note that is already held.

Each 16th-note step lasts `60 / bpm / 4` seconds.

**Meter** (`#meter`) — sets the global time signature. The dropdown offers common meters: 4/4, 3/4, 2/4, 5/4, 6/8, 7/8, 9/8, and 12/8. The meter controls how bars map onto the 16th-step grid and how the position readout counts beats. Changing the meter takes effect on the next loop cycle.

**Swing** (`#swing`) — intended to add a shuffle feel by delaying odd 16th-note steps. Range: 0 (straight) to 0.6. The value is saved and restored with the session. **Note:** swing is currently stored and persisted but is not yet read by the scheduler, so moving the slider does not change the timing you hear — full swing is planned for a future update.

---

## Master volume

**Volume** (`#volume`) — the master output level, range 0–1 (default 0.5). This is a post-mix gain applied before the output visualiser.

---

## Mode toggle and REC

**Session / Performance** (`#mode-toggle`) — switches the main view between the Session clip grid and the Performance arrangement view.

**⤉ Copy to Performance** (`#copy-to-performance`) — an icon-only button (tooltip "Copiar las escenas a la timeline de Performance") that copies the current scenes onto the Performance timeline. See [Performance & Arrangement](10-performance-and-arrangement.md).

- **Session** is the default mode: you see the clip grid and can trigger scenes, edit clips, and record automation in real time.
- **Performance** shows the arrangement timeline where recorded takes are displayed as timeline bands and automation curves can be drawn directly. See [Performance & Arrangement](10-performance-and-arrangement.md) for the full workflow.

**● REC** (`#rec`, tooltip "Grabar — el modo se elige al lado") arms recording; the **mode selector** (`#rec-mode`) beside it chooses what gets recorded:

- **🎛 take** (`data-recmode="take"`, the default) — records knob moves and clip launches into a performance take. See [Modulation & Note FX](06-modulation-and-note-fx.md) for how automation lanes work.
- **⏱ live** (`data-recmode="live"`) — records the real-time audio output to a WAV.
- **⚡ offline** (`data-recmode="offline"`) — renders the current scene to a WAV offline (fast).

Click **REC** again to disarm. This unified REC group replaced the old standalone WAV-export button.

---

## Output visualiser

The canvas at the far right (`#viz`) shows a real-time waveform of the master output. It updates continuously while the page is open and gives a quick visual check that audio is flowing.

---

## Session management, export, and demos

The remaining controls in the transport row are covered in dedicated chapters:

- **WAV export** — there is no longer a standalone "↓ WAV" button. WAV export now happens through the **REC** group's mode selector (see the Mode toggle and REC section above): **⏱ live** records real-time audio to WAV, and **⚡ offline** renders the scene to WAV offline (fast). See [Saving & Export](09-saving-and-export.md).
- **New / Save / Load** (`#new-session`, `#save`, `#load`) — session file management. See [Saving & Export](09-saving-and-export.md).
- **— load a demo —** (`#demo-picker`) — loads a bundled demo arrangement into the session.
- **▶ MIDI IMPORT** (`.midi-panel`) — imports a Standard MIDI File. See the MIDI Import chapter for details.
- **☰ Stems…** (`#stems-open`) — opens the stem-separation dialog, which splits a finished song into four Sampler lanes (vocals / drums / bass / other) via a local helper service. Requires the service to be running; see [MIDI & Samples → Stem separation](08-midi-and-samples.md#stem-separation-optional-local-service).
