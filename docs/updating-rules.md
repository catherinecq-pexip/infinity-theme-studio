# Keeping rules up to date

Pexip adds theme settings in new Infinity releases (e.g. `clock_data` and
`breakout_transfer_delay` arrived in v42). When you upgrade Infinity:

1. Read the release notes and "Rules and requirements for customized themes":
   https://docs.pexip.com/admin/themes_file_requirements.htm
2. Download the new Base theme (**Services > Themes > Download Base theme**) and compare
   `themeconfig.json`, audio and SVG file lists with `site/js/rules.js`.
3. Update `site/js/rules.js` (and `TARGET_INFINITY_VERSION`). Add the new version to
   `SUPPORTED_VERSIONS`, and list every new setting, indicator colour, voice prompt or keypad
   command in `MIN_VERSION` with the version that introduced it. That stops users on older
   systems from getting "Unsupported field" errors.
   Compare versioned docs at `https://docs.pexip.com/v<NN>/admin/themes_file_requirements.htm`.
   The docs aren't always exact. A v41 system rejected `indicator_color_config.external_media_proc`
   even though the v41 docs list it, so record real upload errors in `MIN_VERSION` too.
4. Describe any new setting, prompt or label in `site/js/catalog.js` so it appears in the portal.
   `npm test` fails until every setting in `rules.js` is covered there.
5. Add tests in `tests/`, run `npm test`, then push to `main` to publish.
6. Re-check your themes by loading them on the portal's Start step.
