"""Command-line interface: `theme-studio <command>`."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import __version__, audio, package, rules
from .finish import finish, load_overlay
from .validate import format_report, validate

PROFILES_DIR = Path(__file__).resolve().parent / "profiles"


def _profile_path(name: str) -> Path:
    p = Path(name)
    if p.exists():
        return p
    candidate = PROFILES_DIR / f"{name}.json"
    if candidate.exists():
        return candidate
    raise SystemExit(f"Profile not found: {name} (available: {', '.join(list_profiles())})")


def list_profiles() -> list[str]:
    return sorted(p.stem for p in PROFILES_DIR.glob("*.json"))


# -- commands ------------------------------------------------------------------

def cmd_validate(args: argparse.Namespace) -> int:
    worst = 0
    for src in args.themes:
        theme = package.load(src)
        report = validate(theme)
        print(format_report(report, theme.name))
        if report.errors or (args.strict and report.warnings):
            worst = 1
    return worst


def cmd_finish(args: argparse.Namespace) -> int:
    base = package.load(args.base) if args.base else None
    name = args.name or (base.name if base else None)
    if not name:
        raise SystemExit("--name is required when no base theme is given")
    overlays = [load_overlay(_profile_path(p)) for p in args.profile or []]
    overlays += [load_overlay(o) for o in args.overlay or []]
    theme, log = finish(base, name, overlays, args.add, args.audio_dir)
    for line in log:
        print(f"  - {line}")
    report = validate(theme)
    print(format_report(report, theme.name))
    if report.errors and not args.force:
        print("Not written because of errors (use --force to write anyway).")
        return 1
    out = args.out or f"dist/{name}.zip"
    package.save(theme, out)
    print(f"Wrote {out}")
    return 0


def cmd_audio(args: argparse.Namespace) -> int:
    out = audio.convert_file(args.src, args.dst)
    print(f"Wrote {out} (16-bit mono 48 kHz PCM WAV)")
    return 0


def cmd_upload(args: argparse.Namespace) -> int:
    from .api import Connection, ThemeClient

    theme = package.load(args.zip)
    name = args.name or theme.name
    report = validate(theme)
    if report.errors and not args.force:
        print(format_report(report, name))
        print("Upload cancelled because of validation errors (use --force to upload anyway).")
        return 1
    zip_bytes = package.to_zip_bytes(theme.copy(name))
    if args.dry_run:
        print(f"[dry run] Would upload theme '{name}' ({len(zip_bytes)} bytes)"
              + (f" and assign it to: {', '.join(args.assign)}" if args.assign else ""))
        return 0
    client = ThemeClient(Connection.from_env(verify_tls=not args.insecure))
    theme_path = client.upload_theme(name, zip_bytes)
    print(f"Uploaded theme '{name}' -> {theme_path} (replicates to Conferencing Nodes in ~1 minute)")
    for service in args.assign or []:
        client.assign_theme(theme_path, service)
        print(f"Assigned '{name}' to service '{service}'")
    return 0


def cmd_profiles(args: argparse.Namespace) -> int:
    for name in list_profiles():
        print(name)
    return 0


def cmd_rules(args: argparse.Namespace) -> int:
    print(f"Rules target Pexip Infinity v{rules.TARGET_INFINITY_VERSION}")
    print(f"Backgrounds: {rules.BACKGROUND_SIZE[0]}x{rules.BACKGROUND_SIZE[1]} RGB JPG")
    print(f"Watermark: {rules.WATERMARK_SIZE[0]}x{rules.WATERMARK_SIZE[1]} PNG")
    print("Audio: PCM WAV, 16-bit, mono, 48 kHz")
    print(f"Splash screens: {len(rules.SPLASH_SCREENS)}  Base audio prompts: {len(rules.BASE_AUDIO_FILES)}")
    print(f"Fonts: {', '.join(sorted(rules.FONTS))}")
    return 0


# -- parser --------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="theme-studio",
                                description="Build, validate and upload Pexip Infinity themes.")
    p.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    sub = p.add_subparsers(dest="command", required=True)

    v = sub.add_parser("validate", help="Check theme ZIPs/folders against Infinity's theme rules")
    v.add_argument("themes", nargs="+", help="Theme ZIP files or folders")
    v.add_argument("--strict", action="store_true", help="Treat warnings as failures")
    v.set_defaults(func=cmd_validate)

    f = sub.add_parser("finish", help="Merge profiles/overlays/files/audio into a theme and package it")
    f.add_argument("base", nargs="?", help="Base theme ZIP/folder (e.g. from the branding portal)")
    f.add_argument("--name", help="Theme name (defaults to the base file name)")
    f.add_argument("--profile", action="append", help="Built-in profile name or JSON path (repeatable)")
    f.add_argument("--overlay", action="append", help="Extra themeconfig JSON to merge (repeatable)")
    f.add_argument("--add", action="append", help="Extra file to include, e.g. watermark_icon.png (repeatable)")
    f.add_argument("--audio-dir", help="Folder of voice prompts named after the prompt they replace")
    f.add_argument("--out", help="Output .zip or folder (default dist/<name>.zip)")
    f.add_argument("--force", action="store_true", help="Write even if validation finds errors")
    f.set_defaults(func=cmd_finish)

    a = sub.add_parser("audio", help="Convert an audio file to 16-bit mono 48 kHz WAV (needs ffmpeg)")
    a.add_argument("src")
    a.add_argument("dst")
    a.set_defaults(func=cmd_audio)

    u = sub.add_parser("upload", help="Upload a theme via the Management API (and optionally assign it)")
    u.add_argument("zip", help="Theme ZIP or folder")
    u.add_argument("--name", help="Theme name in Infinity (defaults to file name)")
    u.add_argument("--assign", action="append", help="Service name to assign the theme to (repeatable)")
    u.add_argument("--dry-run", action="store_true")
    u.add_argument("--insecure", action="store_true", help="Skip TLS verification (lab use only)")
    u.add_argument("--force", action="store_true")
    u.set_defaults(func=cmd_upload)

    pr = sub.add_parser("profiles", help="List built-in experience profiles")
    pr.set_defaults(func=cmd_profiles)

    r = sub.add_parser("rules", help="Show the key file requirements")
    r.set_defaults(func=cmd_rules)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except package.ThemePackageError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    except Exception as exc:  # noqa: BLE001
        name = type(exc).__name__
        if name in {"InfinityAPIError", "AudioConversionError", "ValueError"}:
            print(f"error: {exc}", file=sys.stderr)
            return 2
        raise


if __name__ == "__main__":
    sys.exit(main())
