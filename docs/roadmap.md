# Roadmap

## v0.1: Theme finisher (Python CLI, retired)
- [x] Validation engine based on Pexip's documented theme rules (Infinity v42)
- [x] Theme finisher: merge profiles/overlays, add files, convert voice prompts
- [x] Experience profiles: standard, secure, event, client, reception

## v0.2: Browser portal (this release)
- [x] Static web portal on GitHub Pages, no install, files never leave the browser
- [x] Six-step wizard: branding ZIP → profiles → settings → images → voice prompts → review
- [x] Form editor for every simple themeconfig setting, indicators with live colour previews,
      classification banner, clock/timer, keypad codes and layouts, splash screen wording
- [x] Automatic image fixing (size, format, RGB) and audio conversion; record prompts in the browser
- [x] Validation in the browser, JSON import, downloadable ZIP

## Next
- [ ] Splash-screen designer with 1920×1080 canvas, 4:3 crop guides and live preview
- [ ] Custom layout grid designer (10×10, 26 slots) and deeper layout validation
- [ ] Web app branding packages (Webapp3 `manifest.json`) and path mapping (`/meet`, `/secure`, …)
- [ ] Voice prompts via text-to-speech
- [ ] Direct upload to Infinity (needs a small backend proxy for the Management API; credentials kept server-side)
- [ ] Compare with / back up the theme currently live in Infinity
