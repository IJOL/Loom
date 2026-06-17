"""Audio → notes transcription for remixing a stem.

Two modes, auto-selected by how percussive the audio is:
  - melodic: Spotify's **basic-pitch** (neural polyphonic AMT, run via ONNX) →
    note events {start,dur,midi,velocity}. Far better than the old librosa
    band-onset heuristic for real, polyphonic material; exposes tunable
    thresholds (onset/frame/min-note-length/min-max-frequency) for experiments.
  - drums:   **ADTOF** (ADTOF-pytorch, a CRNN trained on 359h of real music) →
    5-class drum transcription (kick/snare/hi-hat/toms/cymbals) mapped to our
    drum voices. Falls back to the old librosa onset + spectral-centroid banding
    if ADTOF is unavailable/fails. Hits {start,voice,velocity}.

Times are in SECONDS; the browser maps them onto the session grid at its own bpm.
Heavy deps (librosa, basic_pitch) are imported lazily so the module stays cheap
to import (and tests can stub them).

basic-pitch install note (Python 3.12 / numpy 2): the package pins TensorFlow +
an old numpy that won't build here, so it is installed WITHOUT deps and runs on
the already-present onnxruntime:
    pip install basic-pitch --no-deps
    pip install pretty_midi mir_eval        # its pure-python runtime deps
"""
from __future__ import annotations

import math

HOP = 512
SR = 22050

# basic-pitch melodic defaults (also the /transcribe endpoint defaults).
BP_ONSET_THRESHOLD = 0.5      # higher → fewer note onsets (more conservative)
BP_FRAME_THRESHOLD = 0.3      # higher → notes must be more confident to sustain
BP_MIN_NOTE_LENGTH_MS = 127.70  # drop notes shorter than this (ms)


def _percussive_ratio(y, sr) -> float:
    import numpy as np
    import librosa

    h, p = librosa.effects.hpss(y)
    eh = float((h ** 2).sum())
    ep = float((p ** 2).sum())
    return ep / (eh + ep + 1e-9)


def _tempo(y, sr):
    import librosa

    try:
        # librosa moved tempo around between versions; try both, fall back to None.
        try:
            import numpy as np  # noqa: F401
            t = librosa.feature.rhythm.tempo(y=y, sr=sr)
        except AttributeError:
            t = librosa.beat.tempo(y=y, sr=sr)
        t0 = float(t[0])
        return t0 if math.isfinite(t0) else None  # never serialize NaN (invalid JSON)
    except Exception:  # noqa: BLE001
        return None


def _velocity(amp: float, base: int, gain: float) -> int:
    return int(max(1, min(127, round(base + amp * gain))))


def _melodic(
    path: str,
    onset_threshold: float = BP_ONSET_THRESHOLD,
    frame_threshold: float = BP_FRAME_THRESHOLD,
    min_note_length_ms: float = BP_MIN_NOTE_LENGTH_MS,
    min_freq: float | None = None,
    max_freq: float | None = None,
) -> dict:
    """Polyphonic transcription via basic-pitch. Returns note events
    {start,dur,midi,velocity} in absolute seconds; silences are preserved (no
    detection ⇒ no note). basic-pitch loads + resamples `path` itself.

    note_events from predict() are tuples: (start_s, end_s, pitch_midi,
    amplitude[0..1], pitch_bends). velocity = round(amplitude * 127)."""
    import warnings
    import logging
    warnings.filterwarnings("ignore")
    logging.disable(logging.WARNING)  # silence basic-pitch's backend-availability noise
    from basic_pitch.inference import predict

    _model_out, _midi, events = predict(
        path,
        onset_threshold=onset_threshold,
        frame_threshold=frame_threshold,
        minimum_note_length=min_note_length_ms,
        minimum_frequency=min_freq,
        maximum_frequency=max_freq,
    )
    notes = []
    for ev in events:
        start, end, midi, amp = float(ev[0]), float(ev[1]), int(ev[2]), float(ev[3])
        notes.append({
            "start": start,
            "dur": max(0.02, end - start),
            "midi": midi,
            "velocity": int(max(1, min(127, round(amp * 127)))),
        })
    notes.sort(key=lambda n: (n["start"], n["midi"]))
    # tempo is metadata only (the browser maps notes at the session bpm); basic-pitch
    # doesn't load `y`, so skip the librosa estimate here.
    return {"kind": "melodic", "tempo": None, "notes": notes}


def _drums(y, sr) -> dict:
    import librosa

    onsets = librosa.onset.onset_detect(y=y, sr=sr, hop_length=HOP, backtrack=True)
    times = librosa.frames_to_time(onsets, sr=sr, hop_length=HOP)
    cent = librosa.feature.spectral_centroid(y=y, sr=sr, hop_length=HOP)[0]
    rms = librosa.feature.rms(y=y, hop_length=HOP)[0]

    notes = []
    for fr, t in zip(onsets, times):
        c = float(cent[min(fr, len(cent) - 1)])
        a = float(rms[min(fr, len(rms) - 1)])
        if c < 1500:
            voice = "kick"
        elif c < 4000:
            voice = "snare"
        else:
            voice = "closedHat"
        notes.append({"start": float(t), "voice": voice, "velocity": _velocity(a, 55, 500)})

    return {"kind": "drums", "tempo": _tempo(y, sr), "notes": notes}


# ADTOF emits a GM-drum MIDI file; map each GM note to one of our DrumMachine
# voices. ADTOF's 5 classes land on 35 (kick), 38 (snare), 42 (hi-hat), 47 (toms),
# 49 (cymbals) — we widen the buckets to be robust to nearby GM notes.
_ADTOF_PITCH_TO_VOICE = {
    35: "kick", 36: "kick",
    38: "snare", 40: "snare",
    42: "closedHat", 44: "closedHat",
    46: "openHat",
    41: "tom", 43: "tom", 45: "tom", 47: "tom", 48: "tom", 50: "tom",
    49: "ride", 51: "ride", 53: "ride", 57: "ride", 59: "ride",
}


ADTOF_FPS = 100
# Map the model's per-onset activation (0..1, its predicted onset strength) to a
# MIDI velocity. Linear with a floor so a faintly-detected hit is still audible
# but soft, and confident hits approach full velocity.
ADTOF_VEL_FLOOR = 30


def _adtof_velocity(activation: float) -> int:
    v = round(ADTOF_VEL_FLOOR + activation * (127 - ADTOF_VEL_FLOOR))
    return int(max(1, min(127, v)))


def _drums_adtof(path: str) -> dict:
    """Neural drum transcription via ADTOF-pytorch (torch-only, weights bundled).
    Runs the model to get per-frame onset activations, peak-picks onsets with the
    package's picker, and derives each hit's velocity from the activation strength
    at its frame (vs the high-level transcribe_to_midi, which hard-codes velocity).
    Raises on any failure so the caller can fall back to the librosa heuristic."""
    import os
    import tempfile
    import numpy as np
    from adtof_pytorch import transcribe_to_midi, PeakPicker, FRAME_RNN_THRESHOLDS, LABELS_5

    # return_activations short-circuits before any MIDI is written; the path is
    # required positionally but never touched.
    unused_mid = os.path.join(tempfile.gettempdir(), "_adtof_unused.mid")
    pred = transcribe_to_midi(path, unused_mid, fps=ADTOF_FPS, return_activations=True)
    acts = np.asarray(pred)
    if acts.ndim == 3:
        acts = acts[0]  # [time, classes]
    n_frames = acts.shape[0]

    peaks = PeakPicker(thresholds=FRAME_RNN_THRESHOLDS, fps=ADTOF_FPS).pick(pred, labels=LABELS_5)[0]
    col_of = {int(p): i for i, p in enumerate(LABELS_5)}

    notes = []
    for pitch, times in peaks.items():
        voice = _ADTOF_PITCH_TO_VOICE.get(int(pitch))
        if voice is None:
            continue
        col = col_of[int(pitch)]
        for t in times:
            frame = min(n_frames - 1, max(0, int(round(t * ADTOF_FPS))))
            notes.append({
                "start": float(t),
                "voice": voice,
                "velocity": _adtof_velocity(float(acts[frame, col])),
            })
    notes.sort(key=lambda x: x["start"])
    return {"kind": "drums", "tempo": None, "notes": notes}


def transcribe_file(
    path: str,
    kind: str = "auto",
    *,
    onset_threshold: float = BP_ONSET_THRESHOLD,
    frame_threshold: float = BP_FRAME_THRESHOLD,
    min_note_length_ms: float = BP_MIN_NOTE_LENGTH_MS,
    min_freq: float | None = None,
    max_freq: float | None = None,
) -> dict:
    """Load `path` and transcribe. `kind` forces the mode: 'drums' or 'melodic'.
    'auto' picks by harmonic/percussive ratio (less reliable — prefer passing the
    known stem role: the drums stem → 'drums', everything else → 'melodic').
    The bp_* params tune the melodic (basic-pitch) path only."""
    import librosa

    def melodic():
        return _melodic(path, onset_threshold, frame_threshold, min_note_length_ms, min_freq, max_freq)

    def drums():
        # Prefer ADTOF (neural, real-music-trained); fall back to the librosa
        # onset+centroid heuristic if the model is missing or errors on this input.
        try:
            return _drums_adtof(path)
        except Exception as exc:  # noqa: BLE001
            import logging
            logging.warning("ADTOF drum transcription failed (%s); using librosa fallback", exc)
            y, sr = librosa.load(path, sr=SR, mono=True)
            if y is None or y.size == 0:
                return {"kind": "drums", "tempo": None, "notes": []}
            return _drums(y, sr)

    if kind == "melodic":
        return melodic()
    if kind == "drums":
        return drums()

    # auto: pick by how percussive the signal is.
    y, sr = librosa.load(path, sr=SR, mono=True)
    if y is None or y.size == 0:
        return {"kind": "melodic", "tempo": None, "notes": []}
    return drums() if _percussive_ratio(y, sr) > 0.62 else melodic()
