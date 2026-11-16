# Keeping rules up to date

Pexip adds theme settings in new Infinity releases (e.g. `clock_data` and
`breakout_transfer_delay` arrived in v42). When you upgrade Infinity:

1. Read the release notes and "Rules and requirements for customized themes":
   https://docs.pexip.com/admin/themes_file_requirements.htm
2. Download the new Base theme (**Services > Themes > Download Base theme**) and compare
   `themeconfig.json`, audio and SVG file lists with `site/js/rules.js`.
3. Update `site/js/rules.js` (and `TARGET_INFINITY_VERSION`).
4. Describe any new setting, prompt or label in `site/js/catalog.js` so it appears in the portal.
   `npm test` fails until every setting in `rules.js` is covered there.
5. Add tests in `tests/`, run `npm test`, then push to `main` to publish.
6. Re-check your themes by loading them on the portal's Start step.
