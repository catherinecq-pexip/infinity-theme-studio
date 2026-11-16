# Keeping rules up to date

Pexip adds theme settings in new Infinity releases (e.g. `clock_data` and
`breakout_transfer_delay` arrived in v42). When you upgrade Infinity:

1. Read the release notes and "Rules and requirements for customized themes":
   https://docs.pexip.com/admin/themes_file_requirements.htm
2. Download the new Base theme (**Services > Themes > Download Base theme**) and compare
   `themeconfig.json`, audio and SVG file lists with `src/theme_studio/rules.py`.
3. Update `rules.py` (and `TARGET_INFINITY_VERSION`), add tests, run `pytest`.
4. Re-validate your themes: `theme-studio validate dist/*.zip`.
