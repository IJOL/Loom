"""Audio → notes transcription for remixing a stem.

Two modes, auto-selected by how percussive the audio is:
  - melodic: monophonic pitch tracking (librosa pYIN) → note events {start,dur,midi,velocity}
  - drums:   onset detection + spectral-centroid banding → hits {start,voice,velocity}

Times are in SECONDS; the browser maps them onto the session grid at its own bpm.
librosa is imported lazily so the module stays cheap to import (and tests can stub)."""
from __future__ import annotations

import math

HOP = 512
SR = 22050


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


def _melodic(y, sr) -> dict:
    import numpy as np
    import librosa

    fmin = librosa.note_to_hz("C2")
    fmax = librosa.note_to_hz("C7")
    f0, voiced, _ = librosa.pyin(y, fmin=fmin, fmax=fmax, sr=sr, hop_length=HOP)
    times = librosa.times_like(f0, sr=sr, hop_length=HOP)
    rms = librosa.feature.rms(y=y, hop_length=HOP)[0]

    notes = []
    cur = None  # {midi, start_i, last_i, amp_sum, n}

    def finish(c):
        start = float(times[c["start_i"]])
        end = float(times[min(c["last_i"] + 1, len(times) - 1)])
        amp = c["amp_sum"] / max(1, c["n"])
        return {
            "start": start,
            "dur": max(0.05, end - start),
            "midi": int(c["midi"]),
            "velocity": _velocity(amp, 45, 600),
        }

    for i, f in enumerate(f0):
        midi = None
        if bool(voiced[i]) and not np.isnan(f):
            midi = int(round(float(librosa.hz_to_midi(f))))
        if midi is None:
            if cur:
                notes.append(finish(cur))
                cur = None
            continue
        a = float(rms[i]) if i < len(rms) else 0.0
        if cur and midi == cur["midi"]:
            cur["last_i"] = i
            cur["amp_sum"] += a
            cur["n"] += 1
        else:
            if cur:
                notes.append(finish(cur))
            cur = {"midi": midi, "start_i": i, "last_i": i, "amp_sum": a, "n": 1}
    if cur:
        notes.append(finish(cur))

    notes = [n for n in notes if n["dur"] >= 0.06]  # drop blips
    return {"kind": "melodic", "tempo": _tempo(y, sr), "notes": notes}


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


def transcribe_file(path: str, kind: str = "auto") -> dict:
    """Load `path` and transcribe. `kind` forces the mode: 'drums' or 'melodic'.
    'auto' picks by harmonic/percussive ratio (less reliable — prefer passing the
    known stem role: the drums stem → 'drums', everything else → 'melodic')."""
    import librosa

    y, sr = librosa.load(path, sr=SR, mono=True)
    if y is None or y.size == 0:
        return {"kind": "melodic", "tempo": None, "notes": []}
    if kind == "drums":
        return _drums(y, sr)
    if kind == "melodic":
        return _melodic(y, sr)
    return _drums(y, sr) if _percussive_ratio(y, sr) > 0.62 else _melodic(y, sr)
