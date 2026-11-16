# Roadmap

## v0.1 — Theme finisher (this release)
- [x] Validation engine based on Pexip's documented theme rules (Infinity v42)
- [x] Theme finisher: merge profiles/overlays, add files, convert voice prompts
- [x] Experience profiles: standard, secure, event, client, reception
- [x] Management API upload + assign (create-or-update by theme name)
- [x] CI: tests + build every profile

## v0.2 — Safer deployments
- [ ] `diff` command: compare a local theme with the one live in Infinity
- [ ] `download` command: back up live themes before replacing them
- [ ] Version history (git-friendly theme source folders + `build` command)
- [ ] Deeper custom layout validation (grid, slots, overlaps)

## v0.3 — Web app branding
- [ ] Build/validate Webapp3 branding packages (`manifest.json`)
- [ ] Upload branding packages and map them to web app paths (`/meet`, `/secure`, `/events`, `/connect`)

## v1.0 — Theme Studio editor (browser UI)
- [ ] Form editor for every themeconfig setting
- [ ] Splash-screen designer with 1920×1080 canvas, 4:3 crop guides and live preview
- [ ] Custom layout grid designer (10×10, 26 slots)
- [ ] Voice prompts via text-to-speech (e.g. Azure AI Speech) + automatic conversion
- [ ] "Preview on test VMR" button (upload to a preview theme assigned to a test VMR)
- [ ] Entra ID sign-in; Management API credentials kept server-side
