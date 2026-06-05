"""Wraps audio-separator (the headless engine behind UVR) to split a file into
4 Demucs stems. Kept tiny and import-light so the FastAPI app and tests can import
the module without loading Demucs until separate_file() is actually called."""
from __future__ import annotations
import os

MODEL_FILENAME = "htdemucs.yaml"  # Demucs 4-stem (vocals/drums/bass/other)

# Map a stem to substrings audio-separator puts in output filenames (case-insensitive).
_STEM_MATCHERS = {
    "vocals": ("vocals", "vocal"),
    "drums": ("drums", "drum"),
    "bass": ("bass",),
    "other": ("other", "instrumental", "no vocals"),
}


def _classify(filename: str) -> str | None:
    low = filename.lower()
    for stem, needles in _STEM_MATCHERS.items():
        if any(n in low for n in needles):
            return stem
    return None


def separate_file(in_path: str, out_dir: str) -> dict[str, str]:
    """Run Demucs htdemucs and return {stem_name: absolute_wav_path}.
    Imports audio-separator lazily so importing this module is cheap."""
    from audio_separator.separator import Separator  # lazy, heavy

    os.makedirs(out_dir, exist_ok=True)
    sep = Separator(output_dir=out_dir, output_format="WAV")
    sep.load_model(model_filename=MODEL_FILENAME)
    outputs = sep.separate(in_path)  # list of output file paths (or names in out_dir)

    result: dict[str, str] = {}
    for path in outputs:
        abs_path = path if os.path.isabs(path) else os.path.join(out_dir, path)
        stem = _classify(os.path.basename(abs_path))
        if stem and stem not in result:
            result[stem] = abs_path
    return result
