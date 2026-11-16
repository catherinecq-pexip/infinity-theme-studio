"""Validate a theme against Pexip Infinity's documented theme rules.

Errors   = Infinity is likely to reject the upload, or the setting will not work.
Warnings = allowed, but probably a mistake or worth a human check.
"""

from __future__ import annotations

import io
import json
import wave
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Any, Iterable

from . import rules
from .package import Theme

try:  # Pillow is optional; image checks are skipped without it.
    from PIL import Image
except ImportError:  # pragma: no cover
    Image = None  # type: ignore[assignment]

try:
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
except ImportError:  # pragma: no cover
    ZoneInfo = None  # type: ignore[assignment]


ERROR = "error"
WARNING = "warning"


@dataclass(frozen=True)
class Issue:
    level: str
    file: str
    message: str

    def __str__(self) -> str:
        return f"[{self.level.upper():7}] {self.file}: {self.message}"


class Report:
    def __init__(self) -> None:
        self.issues: list[Issue] = []

    def error(self, file: str, message: str) -> None:
        self.issues.append(Issue(ERROR, file, message))

    def warn(self, file: str, message: str) -> None:
        self.issues.append(Issue(WARNING, file, message))

    @property
    def errors(self) -> list[Issue]:
        return [i for i in self.issues if i.level == ERROR]

    @property
    def warnings(self) -> list[Issue]:
        return [i for i in self.issues if i.level == WARNING]

    @property
    def ok(self) -> bool:
        return not self.errors


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def validate(theme: Theme) -> Report:
    report = Report()
    config: dict[str, Any] | None = None

    if not theme.files:
        report.error("(theme)", "Theme is empty.")
        return report

    if not theme.has_config():
        report.error(rules.THEMECONFIG,
                     'Missing. New-style themes must include themeconfig.json with "theme_version": 2.')
    else:
        config = _validate_config_file(theme, report)

    custom_layout_names: set[str] = set()
    for fname, data in sorted(theme.files.items()):
        lower = fname.lower()
        if fname == rules.THEMECONFIG:
            continue
        if fname == rules.VENDORDATA:
            _validate_json_file(fname, data, report)
        elif fname.startswith(rules.CUSTOM_LAYOUT_PREFIX) and lower.endswith(".json"):
            layout_name = _validate_custom_layout(fname, data, report)
            if layout_name:
                custom_layout_names.add(layout_name)
        elif lower.endswith(".jpg") or lower.endswith(".jpeg"):
            _validate_jpg(fname, data, report)
        elif lower.endswith(".png"):
            _validate_png(fname, data, report)
        elif lower.endswith(".svg"):
            _validate_svg(fname, data, report)
        elif lower.endswith(".wav"):
            _validate_wav(fname, data, report)
        else:
            report.warn(fname, "Unrecognised file type; Infinity may reject or ignore it.")

    if config is not None:
        _validate_config(config, theme, custom_layout_names, report)
    return report


# ---------------------------------------------------------------------------
# themeconfig.json
# ---------------------------------------------------------------------------

def _validate_config_file(theme: Theme, report: Report) -> dict[str, Any] | None:
    raw = theme.files[rules.THEMECONFIG]
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        report.error(rules.THEMECONFIG, "Must be UTF-8 encoded.")
        return None
    if text.startswith("﻿"):
        report.warn(rules.THEMECONFIG, "Starts with a byte-order mark (BOM); save as UTF-8 without BOM.")
        text = text.lstrip("﻿")
    try:
        config = json.loads(text)
    except json.JSONDecodeError as exc:
        report.error(rules.THEMECONFIG,
                     f"Invalid JSON at line {exc.lineno}, column {exc.colno}: {exc.msg} "
                     "(common causes: missing comma, trailing comma).")
        return None
    if not isinstance(config, dict):
        report.error(rules.THEMECONFIG, "Top level must be a JSON object.")
        return None
    return config


def _validate_config(config: dict[str, Any], theme: Theme,
                     custom_layouts: set[str], report: Report) -> None:
    f = rules.THEMECONFIG

    if config.get("theme_version") != 2:
        report.error(f, '"theme_version": 2 is required, otherwise Infinity treats it as a legacy theme.')

    for key, value in config.items():
        if key not in rules.KNOWN_TOP_LEVEL:
            report.warn(f, f'Unknown setting "{key}" (typo, or newer than Infinity v{rules.TARGET_INFINITY_VERSION}?).')
            continue
        if key in rules.BOOLEAN_SETTINGS and not isinstance(value, bool):
            report.error(f, f'"{key}" must be true or false.')
        elif key in rules.TEXT_SETTINGS:
            if key == "reserved_slot_overlay_text" and value is None:
                continue
            if not isinstance(value, str):
                report.error(f, f'"{key}" must be a string.')
            elif key in rules.MAX_TEXT_LENGTH and len(value) > rules.MAX_TEXT_LENGTH[key]:
                report.error(f, f'"{key}" is {len(value)} characters; maximum is {rules.MAX_TEXT_LENGTH[key]}.')
        elif key in rules.NUMBER_SETTINGS:
            if not _is_number(value) or value < 0:
                report.error(f, f'"{key}" must be a non-negative number.')
        elif key in rules.COLOR_SETTINGS:
            pattern = rules.AVATAR_COLOR_RE if key.startswith("avatar_") else rules.COLOR_RE
            if not isinstance(value, str) or not pattern.match(value):
                report.error(f, f'"{key}" must be a colour like 0xRRGGBB or 0xAARRGGBB.')

    if "dtmf_conference_control_commands" in config:
        _validate_dtmf(config["dtmf_conference_control_commands"], report)
    if "dtmf_allowed_layouts" in config:
        _validate_allowed_layouts(config["dtmf_allowed_layouts"], custom_layouts, report)
    if "message_box_config" in config:
        _validate_message_box(config["message_box_config"], report)
    if "indicator_color_config" in config:
        _validate_indicator_colors(config["indicator_color_config"], report)
    if "clock_data" in config and config["clock_data"] is not None:
        _validate_clock(config["clock_data"], report)
    if "classification" in config:
        _validate_classification(config["classification"], report)
    if "splash_screens" in config:
        _validate_splash_screens(config["splash_screens"], theme, report)


def _is_number(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _check_color(value: Any, where: str, report: Report) -> None:
    if not isinstance(value, str) or not rules.COLOR_RE.match(value):
        report.error(rules.THEMECONFIG, f"{where} must be a colour like 0xRRGGBB or 0xAARRGGBB (got {value!r}).")


def _validate_dtmf(cmds: Any, report: Report) -> None:
    f = rules.THEMECONFIG
    if not isinstance(cmds, dict):
        report.error(f, '"dtmf_conference_control_commands" must be an object.')
        return
    seen: set[str] = set()
    for key, action in cmds.items():
        if not rules.DTMF_KEY_RE.match(key):
            report.error(f, f'DTMF control "{key}" must be exactly two characters from 0-9, * and #.')
        if action not in rules.DTMF_COMMANDS:
            report.error(f, f'Unknown DTMF command "{action}" (editing anything other than the digits disables DTMF commands).')
        if action in seen:
            report.warn(f, f'DTMF command "{action}" is mapped more than once.')
        seen.add(action)
    if "toggle_self_mute" in cmds.values() and cmds.get("*6") != "toggle_self_mute":
        report.warn(f, "Self-mute is no longer *6: update watermark_mute_icon.png so it shows the new code.")


def _validate_allowed_layouts(layouts: Any, custom: set[str], report: Report) -> None:
    f = rules.THEMECONFIG
    if not isinstance(layouts, list) or not all(isinstance(x, str) for x in layouts):
        report.error(f, '"dtmf_allowed_layouts" must be a list of layout names.')
        return
    for name in layouts:
        if name not in rules.BUILTIN_LAYOUTS and name not in custom:
            report.warn(f, f'Layout "{name}" in dtmf_allowed_layouts is not a built-in layout or a custom layout in this theme.')


def _validate_message_box(cfg: Any, report: Report) -> None:
    if not isinstance(cfg, dict):
        report.error(rules.THEMECONFIG, '"message_box_config" must be an object.')
        return
    for key, value in cfg.items():
        if key not in rules.MESSAGE_BOX_COLOR_KEYS:
            report.warn(rules.THEMECONFIG, f'Unknown message_box_config key "{key}".')
        else:
            _check_color(value, f"message_box_config.{key}", report)


def _validate_indicator_colors(cfg: Any, report: Report) -> None:
    f = rules.THEMECONFIG
    if not isinstance(cfg, dict):
        report.error(f, '"indicator_color_config" must be an object.')
        return
    for indicator, colors in cfg.items():
        where = f"indicator_color_config.{indicator}"
        if indicator not in rules.INDICATOR_TYPES:
            report.warn(f, f'Unknown indicator "{indicator}".')
        if not isinstance(colors, dict):
            report.error(f, f"{where} must be an object.")
            continue
        missing = rules.INDICATOR_COLOR_KEYS - colors.keys()
        if missing:
            report.error(f, f"{where} requires background, border and text (missing: {', '.join(sorted(missing))}).")
        for k in rules.INDICATOR_COLOR_KEYS & colors.keys():
            _check_color(colors[k], f"{where}.{k}", report)
        light = colors.get("light_mode")
        if light is not None:
            if not isinstance(light, dict) or rules.INDICATOR_COLOR_KEYS - light.keys():
                report.error(f, f"{where}.light_mode requires background, border and text.")
            else:
                for k in rules.INDICATOR_COLOR_KEYS:
                    _check_color(light[k], f"{where}.light_mode.{k}", report)


def _validate_clock(clock: Any, report: Report) -> None:
    f = rules.THEMECONFIG
    if not isinstance(clock, dict):
        report.error(f, '"clock_data" must be an object.')
        return
    ctype = clock.get("type")
    if ctype not in rules.CLOCK_TYPES:
        report.error(f, f'clock_data.type must be one of {sorted(rules.CLOCK_TYPES)}.')
        return
    lo, hi = rules.CLOCK_STARTING_VALUE_RANGE
    if ctype == "remaining":
        sv = clock.get("starting_value")
        if not isinstance(sv, int) or isinstance(sv, bool) or not lo <= sv <= hi:
            report.error(f, f"clock_data.starting_value is required for 'remaining' and must be {lo}-{hi} seconds.")
    for k in ("prefix", "suffix"):
        if k in clock and not isinstance(clock[k], str):
            report.error(f, f"clock_data.{k} must be a string.")
    if "date" in clock:
        if ctype != "time":
            report.warn(f, "clock_data.date only applies when type is 'time'.")
        elif clock["date"] not in rules.CLOCK_DATE_FORMATS:
            report.error(f, f"clock_data.date must be one of {sorted(rules.CLOCK_DATE_FORMATS)}.")
    if "timezone" in clock:
        if ctype != "time":
            report.warn(f, "clock_data.timezone only applies when type is 'time'.")
        elif ZoneInfo is not None:
            try:
                ZoneInfo(str(clock["timezone"]))
            except (ZoneInfoNotFoundError, ValueError):
                report.error(f, f"clock_data.timezone '{clock['timezone']}' is not a valid IANA timezone (e.g. Europe/London).")
    elif ctype == "time":
        report.warn(f, "clock_data has no timezone, so UTC will be shown.")


def _validate_classification(cls: Any, report: Report) -> None:
    f = rules.THEMECONFIG
    if not isinstance(cls, dict) or not isinstance(cls.get("levels"), dict) or not cls["levels"]:
        report.error(f, 'classification must be an object with a non-empty "levels" object.')
        return
    levels = cls["levels"]
    for key, value in levels.items():
        if not key.isdigit():
            report.error(f, f'classification level key "{key}" must be numeric (written as a string, e.g. "1").')
        if isinstance(value, str):
            continue
        if isinstance(value, dict) and isinstance(value.get("text"), str):
            for ck in ("color", "bgcolor"):
                if ck in value:
                    _check_color(value[ck], f"classification level {key} {ck}", report)
            continue
        report.error(f, f'classification level "{key}" must be text, or an object with "text" (and optional color/bgcolor).')
    default = cls.get("default")
    if not isinstance(default, int) or isinstance(default, bool) or str(default) not in levels:
        report.error(f, "classification.default must be a number matching one of the level keys.")


def _validate_splash_screens(ss: Any, theme: Theme, report: Report) -> None:
    f = rules.THEMECONFIG
    if not isinstance(ss, dict):
        report.error(f, '"splash_screens" must be an object.')
        return
    labels = ss.get("labels", {})
    if not isinstance(labels, dict) or not all(isinstance(v, str) for v in labels.values()):
        report.error(f, "splash_screens.labels must map label keys to text.")
        labels = {}
    known_labels = set(rules.DEFAULT_LABELS) | set(labels)
    screens = ss.get("screens", {})
    if not isinstance(screens, dict):
        report.error(f, "splash_screens.screens must be an object.")
        return
    for screen, spec in screens.items():
        where = f"splash_screens.screens.{screen}"
        if screen not in rules.SPLASH_SCREENS:
            report.warn(f, f'Unknown splash screen "{screen}".')
        if not isinstance(spec, dict):
            report.error(f, f"{where} must be an object.")
            continue
        lt = spec.get("layout_type")
        if lt is not None and lt not in rules.LAYOUT_TYPES:
            report.error(f, f"{where}.layout_type must be 'vertical' or 'free_form'.")
        bg = spec.get("background")
        if bg is not None:
            _validate_background_ref(bg, where, theme, report)
        elements = spec.get("elements")
        if elements is not None:
            if not isinstance(elements, list):
                report.error(f, f"{where}.elements must be a list.")
            else:
                for i, el in enumerate(elements):
                    _validate_element(el, f"{where}.elements[{i}]", theme, known_labels, report)


def _validate_background_ref(bg: Any, where: str, theme: Theme, report: Report) -> None:
    f = rules.THEMECONFIG
    if not isinstance(bg, dict) or not ({"path", "color"} & bg.keys()):
        report.error(f, f'{where}.background must be {{"path": "background_x.jpg"}} or {{"color": "0xRRGGBB"}}.')
        return
    if "color" in bg:
        _check_color(bg["color"], f"{where}.background.color", report)
    if "path" in bg:
        path = bg["path"]
        if not isinstance(path, str) or not rules.BACKGROUND_PATH_RE.match(path):
            report.error(f, f"{where}.background.path must be a .jpg whose name starts with 'background'.")
        elif path not in theme.files and path not in rules.BASE_BACKGROUNDS:
            report.error(f, f"{where}.background.path '{path}' is not included in the theme ZIP.")


def _validate_element(el: Any, where: str, theme: Theme, labels: set[str], report: Report) -> None:
    f = rules.THEMECONFIG
    if not isinstance(el, dict):
        report.error(f, f"{where} must be an object.")
        return
    etype = el.get("type")
    if etype not in rules.ELEMENT_TYPES:
        report.error(f, f"{where}.type must be one of {sorted(rules.ELEMENT_TYPES)}.")
        return
    for k in ("offset_x", "offset_y", "width", "height", "font_size", "letter_spacing",
              "line_spacing", "digit_width", "digit_height", "digit_spacing"):
        if k in el and not _is_number(el[k]):
            report.error(f, f"{where}.{k} must be a number (pixels).")
    if etype in ("icon", "pin_digits"):
        path = el.get("path")
        if not isinstance(path, str) or not rules.ICON_PATH_RE.match(path):
            report.error(f, f"{where}.path must look like icon_name.svg.")
        elif path not in theme.files and path not in rules.BASE_SVG_FILES:
            report.error(f, f"{where}.path '{path}' is not a Base theme SVG and is not included in the ZIP.")
    if etype == "text":
        label = el.get("label")
        if not isinstance(label, str):
            report.error(f, f"{where}.label is required for text elements.")
        elif label not in labels:
            report.warn(f, f"{where}.label '{label}' is not a default label and is not defined in splash_screens.labels.")
        if "font" in el and el["font"] not in rules.FONTS:
            report.error(f, f"{where}.font must be one of {sorted(rules.FONTS)}.")
        if "align" in el and el["align"] not in rules.TEXT_ALIGN:
            report.error(f, f"{where}.align must be center, left or right.")
        if "color" in el:
            _check_color(el["color"], f"{where}.color", report)


# ---------------------------------------------------------------------------
# Other files
# ---------------------------------------------------------------------------

def _validate_json_file(fname: str, data: bytes, report: Report) -> Any:
    try:
        return json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        report.error(fname, f"Invalid UTF-8 JSON: {exc}")
        return None


def _validate_custom_layout(fname: str, data: bytes, report: Report) -> str | None:
    report.warn(fname, "Custom layouts require a 'customlayouts' license. Check deep structure with Pexip's layout designer tool.")
    layout = _validate_json_file(fname, data, report)
    if not isinstance(layout, dict):
        if layout is not None:
            report.error(fname, "Custom layout must be a JSON object.")
        return None
    name = layout.get("name")
    if not isinstance(name, str) or not rules.CUSTOM_LAYOUT_NAME_RE.match(name):
        report.error(fname, "'name' is required: up to 50 letters, digits or underscores, no spaces.")
        name = None
    modes = layout.get("modes")
    if not isinstance(modes, list) or not modes:
        report.error(fname, "'modes' must be a list containing at least one valid mode.")
    if "dual_screen_enabled" in layout and not isinstance(layout["dual_screen_enabled"], bool):
        report.error(fname, "'dual_screen_enabled' must be true or false.")
    return name


def _validate_jpg(fname: str, data: bytes, report: Report) -> None:
    if not fname.endswith(".jpg"):
        report.warn(fname, "Use the .jpg extension.")
    img = _open_image(fname, data, report, expected="JPEG")
    if img is None:
        return
    if img.mode != "RGB":
        report.error(fname, f"JPG must be RGB mode (got {img.mode}; CMYK/greyscale is not supported).")
    if fname.startswith("background"):
        if img.size != rules.BACKGROUND_SIZE:
            level = report.warn if fname == "background_avatar_in_mix.jpg" else report.error
            level(fname, f"Backgrounds must be {rules.BACKGROUND_SIZE[0]}x{rules.BACKGROUND_SIZE[1]} (got {img.size[0]}x{img.size[1]}).")


def _validate_png(fname: str, data: bytes, report: Report) -> None:
    img = _open_image(fname, data, report, expected="PNG")
    if img is None:
        return
    w, h = img.size
    mw, mh = rules.WATERMARK_SIZE
    if fname in rules.WATERMARK_FILES and (w, h) != (mw, mh):
        report.warn(fname, f"Watermark should be {mw}x{mh} (got {w}x{h}); larger images are scaled down.")
    if fname == rules.MUTE_WATERMARK_FILE and (w > mw or h > mh):
        report.warn(fname, f"Mute watermark should be at most {mw}x{mh} (got {w}x{h}).")


def _open_image(fname: str, data: bytes, report: Report, expected: str):
    if Image is None:
        report.warn(fname, "Pillow not installed; image checks skipped (pip install pillow).")
        return None
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception as exc:  # noqa: BLE001
        report.error(fname, f"Cannot read image: {exc}")
        return None
    if img.format != expected:
        report.error(fname, f"File content is {img.format}, expected {expected}.")
    return img


def _validate_svg(fname: str, data: bytes, report: Report) -> None:
    if not fname.startswith("icon_"):
        report.warn(fname, "Splash-screen SVGs are referenced as icon_<name>.svg.")
    try:
        root = ET.fromstring(data)
    except ET.ParseError as exc:
        report.error(fname, f"Invalid SVG/XML: {exc}")
        return
    if not root.tag.endswith("svg"):
        report.error(fname, "Root element is not <svg>.")
        return
    tags = [el.tag.rsplit("}", 1)[-1] for el in root.iter()]
    if "image" in tags:
        report.warn(fname, "Contains an embedded bitmap <image>. Pexip advises drawing real vector SVGs (e.g. in Inkscape), not converting JPG/PNG.")
    paths = [el for el in root.iter() if el.tag.rsplit("}", 1)[-1] == "path"]
    if len(paths) == 1 and len(paths[0].attrib.get("d", "")) > 20000:
        report.warn(fname, "One very large path; Pexip advises multiple simpler paths for reliable rendering.")


def _validate_wav(fname: str, data: bytes, report: Report) -> None:
    if fname not in rules.BASE_AUDIO_FILES:
        report.warn(fname, "Not a Base theme audio file name, so it will not replace any prompt.")
    try:
        with wave.open(io.BytesIO(data)) as w:
            channels, width, rate, comp = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getcomptype()
    except (wave.Error, EOFError) as exc:
        report.error(fname, f"Not a PCM WAV file: {exc}. Convert with: theme-studio audio <in> <out>")
        return
    problems = []
    if comp != "NONE":
        problems.append("not PCM")
    if width != rules.AUDIO_SAMPLE_WIDTH_BYTES:
        problems.append(f"{width * 8}-bit (needs 16-bit)")
    if channels != rules.AUDIO_CHANNELS:
        problems.append(f"{channels} channels (needs mono)")
    if rate != rules.AUDIO_SAMPLE_RATE:
        problems.append(f"{rate} Hz (needs 48000 Hz)")
    if problems:
        report.error(fname, "Audio must be 16-bit mono 48 kHz PCM WAV: " + ", ".join(problems)
                     + ". Convert with: theme-studio audio <in> <out>")


def format_report(report: Report, theme_name: str = "") -> str:
    lines: Iterable[str] = (str(i) for i in sorted(report.issues, key=lambda i: (i.level != ERROR, i.file)))
    head = f"Theme '{theme_name}': " if theme_name else ""
    summary = f"{head}{len(report.errors)} error(s), {len(report.warnings)} warning(s)"
    body = "\n".join(lines)
    return f"{body}\n{summary}" if body else summary
