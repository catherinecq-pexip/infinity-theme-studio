# Infinity Theme Studio

**Open the portal: https://catherinecq-pexip.github.io/infinity-theme-studio/**

Themes can change almost everything callers see and hear on Pexip Infinity's side: splash screens, watermarks, in-call indicators, classification banners, clocks, keypad controls and voice prompts, for **browsers and room systems alike**.

Infinity Theme Studio is a web portal that takes the ZIP from Pexip's branding portal (or nothing at all), lets you walk through every theme capability, checks the result against Infinity's rules, and gives you a finished theme ZIP to upload.

- **Nothing to install.** It runs in any current browser (Chrome, Edge, Firefox, Safari).
- **Private.** Your files are processed on your own computer and never uploaded anywhere.

> **Unofficial tool.** Not a Pexip product and not supported by Pexip. Always test themes on a non-production meeting room first.

## How to use it

1. **Start.** Drop in the ZIP from Pexip's branding portal, an existing Infinity theme ZIP, or start from scratch.
   The branding portal ZIP is *web app branding* (`webapp3/branding/manifest.json`), not a theme. Theme Studio reuses its brand name (as the theme name), logo (as the watermark), background (as the splash screen background) and brand colours (one click colours all in-call indicators), and gives the ZIP back unchanged at the end.
2. **Experience.** Optionally pick ready-made profiles: Standard, Secure, Events, Client-facing, Virtual Reception.
3. **Settings.** Fine-tune indicators (wording, colours, visibility), the classification banner, the clock/timer, keypad (DTMF) codes and layouts, splash screen wording, avatars, watermarks and more. Every change shows a live preview.
4. **Images.** Upload logos and backgrounds. Wrong sizes or formats are fixed automatically.
5. **Voice prompts.** Replace any of the 44 spoken prompts. Upload any audio file or record with your microphone; it's converted to Infinity's format (16-bit mono 48 kHz WAV) automatically.
6. **Review & download.** See any problems, then download your packages:
   - the **Infinity theme** ZIP: upload it in the Infinity Administrator interface (**Services > Themes**)
   - the **web app branding** ZIP (only if you started from the branding portal): the same file, unchanged, to upload as web app branding

Uploading a ZIP **replaces the whole theme** in Infinity, so always upload the complete, finished theme.

## Profiles

Profiles are `themeconfig.json` snippets in [`site/profiles/`](site/profiles/). Objects merge; other values (including lists) replace. Keys starting with `$` are comments (`$title` is the name shown in the portal).

| Profile | Highlights |
|---|---|
| `standard` | No Pexip watermark, avatars for audio-only/camera-off participants |
| `secure` | Classification banner (Internal / Confidential / Strictly Confidential), mute hint, lock wording, red recording indicator |
| `event` | "Live broadcast" wording, elapsed-time clock |
| `client` | Friendly waiting-room text |
| `reception` | Virtual Reception wording (add re-recorded `2sd-*` prompts) |

To add a profile: create `site/profiles/<name>.json` with a `$title` and `$comment`, and add `<name>` to `PROFILE_NAMES` in [`site/js/catalog.js`](site/js/catalog.js).

## For maintainers

The portal is a static site (plain HTML, CSS and JavaScript, with no build step) in [`site/`](site/). Every push to `main` runs the tests and publishes `site/` to GitHub Pages.

```
site/
  index.html, css/styles.css
  js/rules.js      # Pexip theme rules (single source of truth; update per Infinity release)
  js/validate.js   # validation engine
  js/build.js      # theme finisher: merge profiles, settings and files
  js/package.js    # ZIP read/write (JSZip)
  js/branding.js   # reads branding portal exports (web app branding)
  js/formats.js    # PNG/JPEG/WAV/SVG header checks
  js/audio.js      # audio conversion (Web Audio API)
  js/imaging.js    # image resize/convert
  js/catalog.js    # names and descriptions shown in the portal
  js/app.js        # the wizard UI
  profiles/        # experience profiles
  vendor/          # JSZip 3.10.1 (MIT)
tests/             # node:test suite
tools/serve.js     # local preview server
```

Run locally (needs [Node.js](https://nodejs.org/) 20+, maintainers only):

```bash
npm test     # run the tests
npm start    # preview at http://localhost:8080
```

The page must be served over HTTP; opening `index.html` directly from disk won't work.

**One-time GitHub setup:** repository **Settings > Pages > Build and deployment > Source: GitHub Actions**.

See [docs/updating-rules.md](docs/updating-rules.md) when a new Infinity release changes theme settings, and [docs/roadmap.md](docs/roadmap.md) for what's next.

## References

- [Rules and requirements for customized themes](https://docs.pexip.com/admin/themes_file_requirements.htm)
- [Creating and applying themes](https://docs.pexip.com/admin/themes_creating_editing.htm)
- [Pexip layout designer tool](https://cdn.pexip.com/layout/)

## License

To be decided by the repository owner. JSZip is used under the MIT license.
