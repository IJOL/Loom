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
    """Transcribe by COARSE REGISTER BANDS (one band per octave, C2..C7).

    For each band we run onset detection on that band's energy envelope, so a
    note STARTS on the real transient/attack (not where a monophonic pitch
    tracker happens to lock — the old pYIN path started notes late and merged
    runs, which is why they "didn't play at the right moment"). Per onset the
    pitch is the dominant frequency inside the band (approximate, snapped to a
    semitone). Bands fire independently → polyphony by register, and silences
    are preserved (no onset in a band ⇒ no note). Times are absolute seconds."""
    import numpy as np
    import librosa

    S = np.abs(librosa.stft(y, hop_length=HOP))
    if S.size == 0 or S.shape[1] < 2:
        return {"kind": "melodic", "tempo": _tempo(y, sr), "notes": []}
    freqs = librosa.fft_frequencies(sr=sr)
    times = librosa.frames_to_time(np.arange(S.shape[1]), sr=sr, hop_length=HOP)

    fmin = float(librosa.note_to_hz("C2"))
    fmax = min(float(librosa.note_to_hz("C7")), sr / 2.0)
    edges = []
    f = fmin
    while f < fmax:
        edges.append(f)
        f *= 2.0  # one band per octave
    edges.append(fmax)

    notes = []
    for b in range(len(edges) - 1):
        mask = (freqs >= edges[b]) & (freqs < edges[b + 1])
        if not mask.any():
            continue
        band = S[mask, :]
        band_freqs = freqs[mask]
        env = band.sum(axis=0)
        peak = float(env.max())
        if peak <= 1e-6:
            continue
        onsets = librosa.onset.onset_detect(
            onset_envelope=env, sr=sr, hop_length=HOP, backtrack=True,
        )
        if len(onsets) == 0:
            continue
        thresh = 0.15 * peak  # drop weak hits in this band (noise / bleed)
        for k, fr in enumerate(onsets):
            fr = int(fr)
            if env[fr] < thresh:
                continue
            pf = float(band_freqs[int(np.argmax(band[:, fr]))])  # dominant pitch in band
            if pf <= 0:
                continue
            start = float(times[fr])
            nxt = int(onsets[k + 1]) if k + 1 < len(onsets) else S.shape[1] - 1
            dur = max(0.08, min(float(times[nxt]) - start, 2.0))
            notes.append({
                "start": start,
                "dur": dur,
                "midi": int(round(float(librosa.hz_to_midi(pf)))),
                "velocity": _velocity(float(env[fr]) / (peak + 1e-9), 50, 70),
            })

    notes.sort(key=lambda n: (n["start"], n["midi"]))
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
