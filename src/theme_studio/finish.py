"""The "theme finisher": merge extra settings, files and audio into a theme.

Typical use: take the ZIP produced by Pexip's branding portal and add what the
portal can't do (classification banners, voice prompts, clock, DTMF changes,
custom layouts), then validate and package it.
"""

from __future__ import annotations

import io
import json
import wave
from pathlib import Path
from typing import Any

from . import audio, rules
from .package import Theme

AUDIO_SOURCE_SUFFIXES = {".wav", ".mp3", ".m4a", ".aac", ".ogg", ".flac", ".wma", ".aiff", ".aif"}


def deep_merge(base: dict[str, Any], overlay: dict[str, Any]) -> dict[str, Any]:
    """Recursively merge overlay into base. Objects merge; everything else (incl. lists) replaces."""
    out = dict(base)
    for key, value in overlay.items():
        if key.startswith("$"):  # "$comment" etc. are documentation only
            continue
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = deep_merge(out[key], value)
        else:
            out[key] = value
    return out


def load_overlay(path: str | Path) -> dict[str, Any]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"Overlay must be a JSON object: {path}")
    return data


def is_infinity_wav(data: bytes) -> bool:
    try:
        with wave.open(io.BytesIO(data)) as w:
            return (w.getcomptype() == "NONE"
                    and w.getnchannels() == rules.AUDIO_CHANNELS
                    and w.getsampwidth() == rules.AUDIO_SAMPLE_WIDTH_BYTES
                    and w.getframerate() == rules.AUDIO_SAMPLE_RATE)
    except (wave.Error, EOFError):
        return False


def finish(
    base: Theme | None,
    name: str,
    overlays: list[dict[str, Any]] | None = None,
    add_files: list[str | Path] | None = None,
    audio_dir: str | Path | None = None,
) -> tuple[Theme, list[str]]:
    """Build a finished theme. Returns (theme, log lines)."""
    log: list[str] = []
    theme = base.copy(name) if base else Theme(name)

    config = theme.load_config() if theme.has_config() else {}
    if config.get("theme_version") != 2:
        log.append('Set "theme_version": 2')
    config["theme_version"] = 2
    for overlay in overlays or []:
        config = deep_merge(config, overlay)
        log.append(f"Merged overlay settings: {', '.join(k for k in overlay if not k.startswith('$'))}")
    theme.save_config(config)

    for f in add_files or []:
        p = Path(f)
        theme.files[p.name] = p.read_bytes()
        log.append(f"Added file {p.name}")

    if audio_dir:
        for src in sorted(Path(audio_dir).iterdir()):
            if not src.is_file() or src.suffix.lower() not in AUDIO_SOURCE_SUFFIXES:
                continue
            target = src.stem + ".wav"
            data = src.read_bytes()
            if src.suffix.lower() == ".wav" and is_infinity_wav(data):
                theme.files[target] = data
                log.append(f"Added audio {target} (already 16-bit mono 48 kHz)")
            else:
                theme.files[target] = audio.convert_bytes(data, src.suffix)
                log.append(f"Converted audio {src.name} -> {target} (16-bit mono 48 kHz)")
    return theme, log
