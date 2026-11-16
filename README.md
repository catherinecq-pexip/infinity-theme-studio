# Infinity Theme Studio

Themes can change almost everything callers see and hear on Pexip Infinity's side — splash screens, overlays, classification banners, clocks, layouts, voice prompts and keypad controls — for **browsers and room systems alike**.

Infinity Theme Studio is a toolkit for building, validating and deploying those themes, including the settings Pexip's branding portal doesn't cover.

> **Unofficial tool.** Not a Pexip product and not supported by Pexip. Always test themes on a non-production VMR first.

## What it does (v0.1)

| Command | Purpose |
|---|---|
| `theme-studio validate` | Checks theme ZIPs/folders against Infinity's documented rules — JSON structure, `theme_version`, colours, DTMF codes, classification, clock, splash screens, image sizes/modes, SVG sanity, audio format, custom layouts |
| `theme-studio finish` | The **theme finisher**: takes a branding-portal ZIP (or nothing) and merges in profiles, extra settings, files and voice prompts, then validates and packages it |
| `theme-studio audio` | Converts any audio file to Infinity's format (PCM WAV, 16-bit, mono, 48 kHz) via ffmpeg |
| `theme-studio upload` | Uploads a theme through the Management API and optionally assigns it to VMRs/Auditoriums/Receptions |
| `theme-studio profiles` | Lists built-in experience profiles: `standard`, `secure`, `event`, `client`, `reception` |
| `theme-studio rules` | Prints the key file requirements |

## Install

Requires Python 3.10+. ffmpeg is optional (only for audio conversion).

```bash
git clone https://github.com/catherinecq-pexip/infinity-theme-studio.git
cd infinity-theme-studio
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install -e .
theme-studio --version
```

## Quick start

**1. Validate a theme**
```bash
theme-studio validate my-theme.zip
```

**2. Finish a branding-portal theme with the Secure profile and custom voice prompts**
```bash
theme-studio finish portal-export.zip --name secure \
  --profile secure \
  --add watermark_icon.png \
  --audio-dir prompts/secure \
  --out dist/secure.zip
```
Name each audio file after the prompt it replaces (any format ffmpeg reads), e.g. `prompts/secure/conf-classification-changed_48kHz_mono.mp3`.

**3. Build a theme from a profile only (no artwork yet)**
```bash
theme-studio finish --name event --profile event --out dist/event.zip
```

**4. Upload and assign**
```bash
# Set credentials as environment variables (never commit them)
export INFINITY_MGR_HOST=manager.example.com
export INFINITY_MGR_USER=admin
export INFINITY_MGR_PASSWORD='...'

theme-studio upload dist/secure.zip --name secure --assign "Secure Test" --dry-run
theme-studio upload dist/secure.zip --name secure --assign "Secure Test"
```
PowerShell: `$env:INFINITY_MGR_HOST="manager.example.com"` etc.

Uploading a ZIP **replaces the whole theme** in Infinity — always upload the complete, finished theme.

## Profiles

Profiles are `themeconfig.json` overlays in `src/theme_studio/profiles/`. Objects merge; other values (including lists) replace. Keys starting with `$` are comments.

| Profile | Highlights |
|---|---|
| `standard` | No Pexip watermark, avatars for audio-only/camera-off participants |
| `secure` | Classification banner (Internal / Confidential / Strictly Confidential), mute icon, lock wording, red recording indicator |
| `event` | "Live broadcast" wording, elapsed-time clock |
| `client` | Friendly waiting-room text |
| `reception` | Virtual Reception wording (add re-recorded `2sd-*.wav` prompts) |

You can stack them and add your own: `--profile standard --overlay my-tweaks.json`.

## Project layout

```
src/theme_studio/
  rules.py      # Pexip theme rules (single source of truth — update per Infinity release)
  validate.py   # validation engine
  finish.py     # theme finisher (merge overlays/files/audio)
  package.py    # ZIP/folder read & write
  audio.py      # ffmpeg conversion
  api.py        # Management API: upload + assign themes
  cli.py        # command-line interface
  profiles/     # experience profile overlays
tests/          # unittest suite (runs with pytest too)
docs/           # rules reference, roadmap, maintenance notes
```

## Development

```bash
pip install -e ".[dev]"
pytest            # or: python -m unittest discover -s tests
```

## Roadmap

See [docs/roadmap.md](docs/roadmap.md). Next up: web app branding packages, a browser-based editor with splash-screen preview, custom layout designer, and text-to-speech voice prompts.

## References

- [Rules and requirements for customized themes](https://docs.pexip.com/admin/themes_file_requirements.htm)
- [Creating and applying themes](https://docs.pexip.com/admin/themes_creating_editing.htm)
- [Management configuration API](https://docs.pexip.com/api_manage/api_configuration.htm)
- [Pexip layout designer tool](https://cdn.pexip.com/layout/)

## License

To be decided by the repository owner.
