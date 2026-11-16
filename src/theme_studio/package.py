"""Read and write theme packages (ZIP files or folders).

A theme is held in memory as a :class:`Theme`: a mapping of file name -> bytes.
Infinity themes are flat (all files at the same level), so sub-folders are not
supported; a single wrapping top-level folder inside a ZIP is unwrapped.
"""

from __future__ import annotations

import io
import json
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import rules

IGNORED_NAMES = {".DS_Store", "Thumbs.db", "desktop.ini"}


class ThemePackageError(Exception):
    """Raised when a theme package cannot be read."""


@dataclass
class Theme:
    name: str
    files: dict[str, bytes] = field(default_factory=dict)

    # -- themeconfig helpers -------------------------------------------------
    def has_config(self) -> bool:
        return rules.THEMECONFIG in self.files

    def load_config(self) -> dict[str, Any]:
        """Parse themeconfig.json (raises ValueError/UnicodeDecodeError on bad input)."""
        if not self.has_config():
            return {}
        return json.loads(self.files[rules.THEMECONFIG].decode("utf-8"))

    def save_config(self, config: dict[str, Any]) -> None:
        text = json.dumps(config, indent=4, ensure_ascii=False) + "\n"
        self.files[rules.THEMECONFIG] = text.encode("utf-8")

    def copy(self, name: str | None = None) -> "Theme":
        return Theme(name=name or self.name, files=dict(self.files))


def _clean(name: str) -> bool:
    base = name.rsplit("/", 1)[-1]
    return bool(base) and base not in IGNORED_NAMES and not name.startswith("__MACOSX/")


def load(path: str | Path, name: str | None = None) -> Theme:
    """Load a theme from a ZIP file or a folder."""
    p = Path(path)
    if not p.exists():
        raise ThemePackageError(f"Not found: {p}")
    theme_name = name or p.stem
    if p.is_dir():
        files: dict[str, bytes] = {}
        for child in sorted(p.iterdir()):
            if child.is_dir():
                raise ThemePackageError(
                    f"Sub-folders are not supported in themes: {child.name}/")
            if _clean(child.name):
                files[child.name] = child.read_bytes()
        return Theme(theme_name, files)
    if zipfile.is_zipfile(p):
        return load_zip_bytes(p.read_bytes(), theme_name)
    raise ThemePackageError(f"Not a ZIP file or folder: {p}")


def load_zip_bytes(data: bytes, name: str) -> Theme:
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        entries = [i for i in zf.infolist() if not i.is_dir() and _clean(i.filename)]
        names = [i.filename for i in entries]
        # Unwrap a single top-level folder (e.g. "secure/themeconfig.json").
        prefixes = {n.split("/", 1)[0] for n in names if "/" in n}
        flat = [n for n in names if "/" not in n]
        prefix = ""
        if len(prefixes) == 1 and not flat:
            prefix = prefixes.pop() + "/"
        files: dict[str, bytes] = {}
        for info in entries:
            rel = info.filename[len(prefix):] if prefix else info.filename
            if "/" in rel:
                raise ThemePackageError(
                    f"Nested folders are not supported in themes: {info.filename}")
            files[rel] = zf.read(info)
    return Theme(name, files)


def to_zip_bytes(theme: Theme, wrap_folder: bool = True) -> bytes:
    """Serialise a theme to ZIP bytes.

    Pexip's manual-theme instructions say to "create a ZIP file of the new
    folder", so by default files are placed inside a folder named after the theme.
    """
    buf = io.BytesIO()
    folder = f"{theme.name}/" if wrap_folder else ""
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for fname in sorted(theme.files):
            zf.writestr(folder + fname, theme.files[fname])
    return buf.getvalue()


def save(theme: Theme, out: str | Path, wrap_folder: bool = True) -> Path:
    """Write a theme to a ZIP file (if out ends with .zip) or a folder."""
    out_path = Path(out)
    if out_path.suffix.lower() == ".zip":
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(to_zip_bytes(theme, wrap_folder=wrap_folder))
    else:
        out_path.mkdir(parents=True, exist_ok=True)
        for fname, data in theme.files.items():
            (out_path / fname).write_bytes(data)
    return out_path
