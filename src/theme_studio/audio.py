"""Convert any audio file to Infinity's required format: PCM WAV, 16-bit, mono, 48 kHz."""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

from . import rules


class AudioConversionError(Exception):
    pass


def ffmpeg_path() -> str | None:
    return shutil.which("ffmpeg")


def convert_bytes(data: bytes, source_suffix: str = ".wav") -> bytes:
    """Convert audio bytes (any format ffmpeg understands) to Infinity WAV bytes."""
    exe = ffmpeg_path()
    if not exe:
        raise AudioConversionError(
            "ffmpeg is required for audio conversion. Install it from https://ffmpeg.org/ "
            "(Windows: 'winget install ffmpeg').")
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / f"in{source_suffix}"
        dst = Path(tmp) / "out.wav"
        src.write_bytes(data)
        cmd = [
            exe, "-hide_banner", "-loglevel", "error", "-y", "-i", str(src),
            "-ac", str(rules.AUDIO_CHANNELS),
            "-ar", str(rules.AUDIO_SAMPLE_RATE),
            "-acodec", "pcm_s16le",
            "-map_metadata", "-1",
            str(dst),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if result.returncode != 0:
            raise AudioConversionError(result.stderr.strip() or "ffmpeg failed")
        return dst.read_bytes()


def convert_file(src: str | Path, dst: str | Path) -> Path:
    src_p, dst_p = Path(src), Path(dst)
    dst_p.parent.mkdir(parents=True, exist_ok=True)
    dst_p.write_bytes(convert_bytes(src_p.read_bytes(), src_p.suffix or ".wav"))
    return dst_p
