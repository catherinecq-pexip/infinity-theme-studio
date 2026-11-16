// Validate a theme against Pexip Infinity's documented theme rules.
//
// Errors   = Infinity is likely to reject the upload, or the setting will not work.
// Warnings = allowed, but probably a mistake or worth a human check.

import * as rules from "./rules.js";
import { jpegInfo, parseXml, pngInfo, sniffFormat, wavInfo } from "./formats.js";
import { utf8 } from "./package.js";

export const ERROR = "error";
export const WARNING = "warning";

export class Report {
  constructor() {
    this.issues = [];
  }
  error(file, message) {
    this.issues.push({ level: ERROR, file, message });
  }
  warn(file, message) {
    this.issues.push({ level: WARNING, file, message });
  }
  get errors() {
    return this.issues.filter((i) => i.level === ERROR);
  }
  get warnings() {
    return this.issues.filter((i) => i.level === WARNING);
  }
  get ok() {
    return this.errors.length === 0;
  }
}

const F = rules.THEMECONFIG;
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isNumber = (v) => typeof v === "number" && Number.isFinite(v);
const isInt = (v) => Number.isInteger(v);
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const sorted = (set) => [...set].sort().join(", ");
const repr = (v) => JSON.stringify(v);

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Validate a theme. version: the Infinity version it will be uploaded to
 * (defaults to the latest the rules describe).
 */
export function validate(theme, { version = rules.LATEST_VERSION } = {}) {
  const report = new Report();
  let config = null;

  const names = Object.keys(theme.files).sort();
  if (!names.length) {
    report.error("(theme)", "Theme is empty.");
    return report;
  }

  if (!has(theme.files, F)) {
    report.error(F, 'Missing. New-style themes must include themeconfig.json with "theme_version": 2.');
  } else {
    config = validateConfigFile(theme, report);
  }

  const customLayoutNames = new Set();
  for (const fname of names) {
    const data = theme.files[fname];
    const lower = fname.toLowerCase();
    if (fname === F) continue;
    if (fname === rules.VENDORDATA) {
      validateJsonFile(fname, data, report);
    } else if (fname.startsWith(rules.CUSTOM_LAYOUT_PREFIX) && lower.endsWith(".json")) {
      const layoutName = validateCustomLayout(fname, data, report);
      if (layoutName) customLayoutNames.add(layoutName);
    } else if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
      validateJpg(fname, data, report);
    } else if (lower.endsWith(".png")) {
      validatePng(fname, data, report);
    } else if (lower.endsWith(".svg")) {
      validateSvg(fname, data, report);
    } else if (lower.endsWith(".wav")) {
      validateWav(fname, data, report);
    } else {
      report.warn(fname, "Unrecognised file type; Infinity may reject or ignore it.");
    }
  }

  if (config !== null) {
    validateConfig(config, theme, customLayoutNames, report);
    validateVersion(config, theme, version, report);
  }
  return report;
}

/** Custom layout names defined by custom_layout_*.json files in a theme. */
export function customLayoutNames(theme) {
  const out = [];
  for (const [fname, data] of Object.entries(theme.files)) {
    if (!fname.startsWith(rules.CUSTOM_LAYOUT_PREFIX) || !fname.toLowerCase().endsWith(".json")) continue;
    try {
      const name = JSON.parse(utf8.decode(data)).name;
      if (typeof name === "string") out.push(name);
    } catch { /* reported by validate() */ }
  }
  return out.sort();
}

// ---------------------------------------------------------------------------
// themeconfig.json
// ---------------------------------------------------------------------------

/** Turn a JSON.parse error into "line X, column Y: message" where the engine allows. */
export function describeJsonError(err, text) {
  const msg = String(err.message || err);
  let m = msg.match(/line (\d+) column (\d+)/);
  if (m) return `Invalid JSON at line ${m[1]}, column ${m[2]}: ${msg}`;
  m = msg.match(/position (\d+)/);
  if (m) {
    const before = text.slice(0, Number(m[1]));
    const line = before.split("\n").length;
    const col = before.length - before.lastIndexOf("\n");
    return `Invalid JSON at line ${line}, column ${col}: ${msg}`;
  }
  return `Invalid JSON: ${msg}`;
}

function validateConfigFile(theme, report) {
  let text;
  try {
    text = utf8.decode(theme.files[F]);
  } catch {
    report.error(F, "Must be UTF-8 encoded.");
    return null;
  }
  if (text.startsWith("\uFEFF")) {
    report.warn(F, "Starts with a byte-order mark (BOM); save as UTF-8 without BOM.");
    text = text.replace(/^\uFEFF+/, "");
  }
  let config;
  try {
    config = JSON.parse(text);
  } catch (err) {
    report.error(F, `${describeJsonError(err, text)} (common causes: missing comma, trailing comma).`);
    return null;
  }
  if (!isObject(config)) {
    report.error(F, "Top level must be a JSON object.");
    return null;
  }
  return config;
}

/** Items the target Infinity version will reject ("Unsupported field"). */
function validateVersion(config, theme, version, report) {
  const needs = (kind, n) => rules.minVersion(kind, n) === rules.NEVER
    ? `isn't accepted by Infinity ("Unsupported field"), even though Pexip's docs list it.`
    : `needs Infinity v${rules.minVersion(kind, n)} or later; v${version} will reject the theme.`;
  for (const key of Object.keys(config)) {
    if (!rules.supports(version, "setting", key)) report.error(F, `"${key}" ${needs("setting", key)}`);
  }
  if (isObject(config.indicator_color_config)) {
    for (const type of Object.keys(config.indicator_color_config)) {
      if (!rules.supports(version, "indicator", type)) report.error(F, `indicator_color_config.${type} ${needs("indicator", type)}`);
    }
  }
  if (isObject(config.dtmf_conference_control_commands)) {
    for (const cmd of Object.values(config.dtmf_conference_control_commands)) {
      if (typeof cmd === "string" && !rules.supports(version, "dtmf", cmd)) report.error(F, `Keypad command "${cmd}" ${needs("dtmf", cmd)}`);
    }
  }
  for (const fname of Object.keys(theme.files)) {
    if (!rules.supports(version, "audio", fname)) report.error(fname, `This voice prompt ${needs("audio", fname)}`);
  }
}

function validateConfig(config, theme, customLayouts, report) {
  if (config.theme_version !== 2) {
    report.error(F, '"theme_version": 2 is required, otherwise Infinity treats it as a legacy theme.');
  }

  for (const [key, value] of Object.entries(config)) {
    if (!rules.KNOWN_TOP_LEVEL.has(key)) {
      report.warn(F, `Unknown setting "${key}" (typo, or newer than Infinity v${rules.TARGET_INFINITY_VERSION}?).`);
      continue;
    }
    if (rules.BOOLEAN_SETTINGS.has(key) && typeof value !== "boolean") {
      report.error(F, `"${key}" must be true or false.`);
    } else if (rules.TEXT_SETTINGS.has(key)) {
      if (key === "reserved_slot_overlay_text" && value === null) continue;
      const max = rules.MAX_TEXT_LENGTH[key];
      if (typeof value !== "string") {
        report.error(F, `"${key}" must be a string.`);
      } else if (max !== undefined && [...value].length > max) {
        report.error(F, `"${key}" is ${[...value].length} characters; maximum is ${max}.`);
      }
    } else if (rules.NUMBER_SETTINGS.has(key)) {
      if (!isNumber(value) || value < 0) report.error(F, `"${key}" must be a non-negative number.`);
    } else if (rules.COLOR_SETTINGS.has(key)) {
      const pattern = key.startsWith("avatar_") ? rules.AVATAR_COLOR_RE : rules.COLOR_RE;
      if (typeof value !== "string" || !pattern.test(value)) {
        report.error(F, `"${key}" must be a colour like 0xRRGGBB or 0xAARRGGBB.`);
      }
    }
  }

  if (has(config, "dtmf_conference_control_commands")) validateDtmf(config.dtmf_conference_control_commands, report);
  if (has(config, "dtmf_allowed_layouts")) validateAllowedLayouts(config.dtmf_allowed_layouts, customLayouts, report);
  if (has(config, "message_box_config")) validateMessageBox(config.message_box_config, report);
  if (has(config, "indicator_color_config")) validateIndicatorColors(config.indicator_color_config, report);
  if (has(config, "clock_data") && config.clock_data !== null) validateClock(config.clock_data, report);
  if (has(config, "classification")) validateClassification(config.classification, report);
  if (has(config, "splash_screens")) validateSplashScreens(config.splash_screens, theme, report);
}

function checkColor(value, where, report) {
  if (typeof value !== "string" || !rules.COLOR_RE.test(value)) {
    report.error(F, `${where} must be a colour like 0xRRGGBB or 0xAARRGGBB (got ${repr(value)}).`);
  }
}

function validateDtmf(cmds, report) {
  if (!isObject(cmds)) {
    report.error(F, '"dtmf_conference_control_commands" must be an object.');
    return;
  }
  const seen = new Set();
  for (const [key, action] of Object.entries(cmds)) {
    if (!rules.DTMF_KEY_RE.test(key)) {
      report.error(F, `DTMF control "${key}" must be exactly two characters from 0-9, * and #.`);
    }
    if (!rules.DTMF_COMMANDS.has(action)) {
      report.error(F, `Unknown DTMF command "${action}" (editing anything other than the digits disables DTMF commands).`);
    }
    if (seen.has(action)) report.warn(F, `DTMF command "${action}" is mapped more than once.`);
    seen.add(action);
  }
  if (Object.values(cmds).includes("toggle_self_mute") && cmds["*6"] !== "toggle_self_mute") {
    report.warn(F, "Self-mute is no longer *6: if watermark_mute_icon.png mentions the code, update it.");
  }
}

function validateAllowedLayouts(layouts, custom, report) {
  if (!Array.isArray(layouts) || !layouts.every((x) => typeof x === "string")) {
    report.error(F, '"dtmf_allowed_layouts" must be a list of layout names.');
    return;
  }
  for (const name of layouts) {
    if (!rules.BUILTIN_LAYOUTS.has(name) && !custom.has(name)) {
      report.warn(F, `Layout "${name}" in dtmf_allowed_layouts is not a built-in layout or a custom layout in this theme.`);
    }
  }
}

function validateMessageBox(cfg, report) {
  if (!isObject(cfg)) {
    report.error(F, '"message_box_config" must be an object.');
    return;
  }
  for (const [key, value] of Object.entries(cfg)) {
    if (!rules.MESSAGE_BOX_COLOR_KEYS.has(key)) report.warn(F, `Unknown message_box_config key "${key}".`);
    else checkColor(value, `message_box_config.${key}`, report);
  }
}

function validateIndicatorColors(cfg, report) {
  if (!isObject(cfg)) {
    report.error(F, '"indicator_color_config" must be an object.');
    return;
  }
  for (const [indicator, colors] of Object.entries(cfg)) {
    const where = `indicator_color_config.${indicator}`;
    if (!rules.INDICATOR_TYPES.has(indicator)) report.warn(F, `Unknown indicator "${indicator}".`);
    if (!isObject(colors)) {
      report.error(F, `${where} must be an object.`);
      continue;
    }
    const missing = [...rules.INDICATOR_COLOR_KEYS].filter((k) => !has(colors, k)).sort();
    if (missing.length) {
      report.error(F, `${where} requires background, border and text (missing: ${missing.join(", ")}).`);
    }
    for (const k of [...rules.INDICATOR_COLOR_KEYS].sort()) {
      if (has(colors, k)) checkColor(colors[k], `${where}.${k}`, report);
    }
    const light = colors.light_mode;
    if (light !== undefined && light !== null) {
      if (!isObject(light) || [...rules.INDICATOR_COLOR_KEYS].some((k) => !has(light, k))) {
        report.error(F, `${where}.light_mode requires background, border and text.`);
      } else {
        for (const k of [...rules.INDICATOR_COLOR_KEYS].sort()) checkColor(light[k], `${where}.light_mode.${k}`, report);
      }
    }
  }
}

export function isValidTimezone(tz) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: String(tz) });
    return true;
  } catch {
    return false;
  }
}

function validateClock(clock, report) {
  if (!isObject(clock)) {
    report.error(F, '"clock_data" must be an object.');
    return;
  }
  const ctype = clock.type;
  if (!rules.CLOCK_TYPES.has(ctype)) {
    report.error(F, `clock_data.type must be one of ${sorted(rules.CLOCK_TYPES)}.`);
    return;
  }
  const [lo, hi] = rules.CLOCK_STARTING_VALUE_RANGE;
  if (ctype === "remaining") {
    const sv = clock.starting_value;
    if (!isInt(sv) || sv < lo || sv > hi) {
      report.error(F, `clock_data.starting_value is required for 'remaining' and must be ${lo}-${hi} seconds.`);
    }
  }
  for (const k of ["prefix", "suffix"]) {
    if (has(clock, k) && typeof clock[k] !== "string") report.error(F, `clock_data.${k} must be a string.`);
  }
  if (has(clock, "date")) {
    if (ctype !== "time") report.warn(F, "clock_data.date only applies when type is 'time'.");
    else if (!rules.CLOCK_DATE_FORMATS.has(clock.date)) {
      report.error(F, `clock_data.date must be one of ${sorted(rules.CLOCK_DATE_FORMATS)}.`);
    }
  }
  if (has(clock, "timezone")) {
    if (ctype !== "time") report.warn(F, "clock_data.timezone only applies when type is 'time'.");
    else if (!isValidTimezone(clock.timezone)) {
      report.error(F, `clock_data.timezone '${clock.timezone}' is not a valid IANA timezone (e.g. Europe/London).`);
    }
  } else if (ctype === "time") {
    report.warn(F, "clock_data has no timezone, so UTC will be shown.");
  }
}

function validateClassification(cls, report) {
  if (!isObject(cls) || !isObject(cls.levels) || !Object.keys(cls.levels).length) {
    report.error(F, 'classification must be an object with a non-empty "levels" object.');
    return;
  }
  const levels = cls.levels;
  for (const [key, value] of Object.entries(levels)) {
    if (!/^\d+$/.test(key)) {
      report.error(F, `classification level key "${key}" must be numeric (written as a string, e.g. "1").`);
    }
    if (typeof value === "string") continue;
    if (isObject(value) && typeof value.text === "string") {
      for (const ck of ["color", "bgcolor"]) {
        if (has(value, ck)) checkColor(value[ck], `classification level ${key} ${ck}`, report);
      }
      continue;
    }
    report.error(F, `classification level "${key}" must be text, or an object with "text" (and optional color/bgcolor).`);
  }
  const def = cls.default;
  if (!isInt(def) || !has(levels, String(def))) {
    report.error(F, "classification.default must be a number matching one of the level keys.");
  }
}

function validateSplashScreens(ss, theme, report) {
  if (!isObject(ss)) {
    report.error(F, '"splash_screens" must be an object.');
    return;
  }
  let labels = ss.labels ?? {};
  if (!isObject(labels) || !Object.values(labels).every((v) => typeof v === "string")) {
    report.error(F, "splash_screens.labels must map label keys to text.");
    labels = {};
  }
  const knownLabels = new Set([...rules.DEFAULT_LABELS, ...Object.keys(labels)]);
  const screens = ss.screens ?? {};
  if (!isObject(screens)) {
    report.error(F, "splash_screens.screens must be an object.");
    return;
  }
  for (const [screen, spec] of Object.entries(screens)) {
    const where = `splash_screens.screens.${screen}`;
    if (!rules.SPLASH_SCREENS.has(screen)) report.warn(F, `Unknown splash screen "${screen}".`);
    if (!isObject(spec)) {
      report.error(F, `${where} must be an object.`);
      continue;
    }
    const lt = spec.layout_type;
    if (lt !== undefined && lt !== null && !rules.LAYOUT_TYPES.has(lt)) {
      report.error(F, `${where}.layout_type must be 'vertical' or 'free_form'.`);
    }
    if (spec.background !== undefined && spec.background !== null) {
      validateBackgroundRef(spec.background, where, theme, report);
    }
    const elements = spec.elements;
    if (elements !== undefined && elements !== null) {
      if (!Array.isArray(elements)) report.error(F, `${where}.elements must be a list.`);
      else elements.forEach((el, i) => validateElement(el, `${where}.elements[${i}]`, theme, knownLabels, report));
    }
  }
}

function validateBackgroundRef(bg, where, theme, report) {
  if (!isObject(bg) || !(has(bg, "path") || has(bg, "color"))) {
    report.error(F, `${where}.background must be {"path": "background_x.jpg"} or {"color": "0xRRGGBB"}.`);
    return;
  }
  if (has(bg, "color")) checkColor(bg.color, `${where}.background.color`, report);
  if (has(bg, "path")) {
    const path = bg.path;
    if (typeof path !== "string" || !rules.BACKGROUND_PATH_RE.test(path)) {
      report.error(F, `${where}.background.path must be a .jpg whose name starts with 'background'.`);
    } else if (!has(theme.files, path) && !rules.BASE_BACKGROUNDS.has(path)) {
      report.error(F, `${where}.background.path '${path}' is not included in the theme ZIP.`);
    }
  }
}

const NUMERIC_ELEMENT_KEYS = [
  "offset_x", "offset_y", "width", "height", "font_size", "letter_spacing",
  "line_spacing", "digit_width", "digit_height", "digit_spacing",
];

function validateElement(el, where, theme, labels, report) {
  if (!isObject(el)) {
    report.error(F, `${where} must be an object.`);
    return;
  }
  const etype = el.type;
  if (!rules.ELEMENT_TYPES.has(etype)) {
    report.error(F, `${where}.type must be one of ${sorted(rules.ELEMENT_TYPES)}.`);
    return;
  }
  for (const k of NUMERIC_ELEMENT_KEYS) {
    if (has(el, k) && !isNumber(el[k])) report.error(F, `${where}.${k} must be a number (pixels).`);
  }
  if (etype === "icon" || etype === "pin_digits") {
    const path = el.path;
    if (typeof path !== "string" || !rules.ICON_PATH_RE.test(path)) {
      report.error(F, `${where}.path must look like icon_name.svg.`);
    } else if (!has(theme.files, path) && !rules.BASE_SVG_FILES.has(path)) {
      report.error(F, `${where}.path '${path}' is not a Base theme SVG and is not included in the ZIP.`);
    }
  }
  if (etype === "text") {
    const label = el.label;
    if (typeof label !== "string") report.error(F, `${where}.label is required for text elements.`);
    else if (!labels.has(label)) {
      report.warn(F, `${where}.label '${label}' is not a default label and is not defined in splash_screens.labels.`);
    }
    if (has(el, "font") && !rules.FONTS.has(el.font)) report.error(F, `${where}.font must be one of ${sorted(rules.FONTS)}.`);
    if (has(el, "align") && !rules.TEXT_ALIGN.has(el.align)) report.error(F, `${where}.align must be center, left or right.`);
    if (has(el, "color")) checkColor(el.color, `${where}.color`, report);
  }
}

// ---------------------------------------------------------------------------
// Other files
// ---------------------------------------------------------------------------

function validateJsonFile(fname, data, report) {
  let text;
  try {
    text = utf8.decode(data);
  } catch (err) {
    report.error(fname, `Invalid UTF-8 JSON: ${err.message}`);
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    report.error(fname, `Invalid UTF-8 JSON: ${describeJsonError(err, text)}`);
    return null;
  }
}

function validateCustomLayout(fname, data, report) {
  report.warn(fname, "Custom layouts require a 'customlayouts' license. Check deep structure with Pexip's layout designer tool.");
  const layout = validateJsonFile(fname, data, report);
  if (!isObject(layout)) {
    if (layout !== null) report.error(fname, "Custom layout must be a JSON object.");
    return null;
  }
  let name = layout.name;
  if (typeof name !== "string" || !rules.CUSTOM_LAYOUT_NAME_RE.test(name)) {
    report.error(fname, "'name' is required: up to 50 letters, digits or underscores, no spaces.");
    name = null;
  }
  if (!Array.isArray(layout.modes) || !layout.modes.length) {
    report.error(fname, "'modes' must be a list containing at least one valid mode.");
  }
  if (has(layout, "dual_screen_enabled") && typeof layout.dual_screen_enabled !== "boolean") {
    report.error(fname, "'dual_screen_enabled' must be true or false.");
  }
  return name;
}

function openImage(fname, data, report, expected) {
  const actual = sniffFormat(data);
  if (actual && actual !== expected) {
    report.error(fname, `File content is ${actual}, expected ${expected}.`);
    return null;
  }
  try {
    return expected === "PNG" ? pngInfo(data) : jpegInfo(data);
  } catch (err) {
    report.error(fname, `Cannot read image: ${err.message}`);
    return null;
  }
}

function validateJpg(fname, data, report) {
  if (!fname.endsWith(".jpg")) report.warn(fname, "Use the .jpg extension.");
  const img = openImage(fname, data, report, "JPEG");
  if (!img) return;
  if (img.mode !== "RGB") {
    report.error(fname, `JPG must be RGB mode (got ${img.mode}; CMYK/greyscale is not supported).`);
  }
  if (fname.startsWith("background")) {
    const [bw, bh] = rules.BACKGROUND_SIZE;
    if (img.width !== bw || img.height !== bh) {
      const msg = `Backgrounds must be ${bw}x${bh} (got ${img.width}x${img.height}).`;
      if (fname === "background_avatar_in_mix.jpg") report.warn(fname, msg);
      else report.error(fname, msg);
    }
  }
}

function validatePng(fname, data, report) {
  const img = openImage(fname, data, report, "PNG");
  if (!img) return;
  const { width: w, height: h } = img;
  const [mw, mh] = rules.WATERMARK_SIZE;
  if (rules.WATERMARK_FILES.has(fname) && (w !== mw || h !== mh)) {
    report.warn(fname, `Watermark should be ${mw}x${mh} (got ${w}x${h}); larger images are scaled down.`);
  }
  if (fname === rules.MUTE_WATERMARK_FILE && (w > mw || h > mh)) {
    report.warn(fname, `Mute watermark should be at most ${mw}x${mh} (got ${w}x${h}).`);
  }
}

function validateSvg(fname, data, report) {
  if (!fname.startsWith("icon_")) report.warn(fname, "Splash-screen SVGs are referenced as icon_<name>.svg.");
  let doc;
  try {
    doc = parseXml(utf8.decode(data));
  } catch (err) {
    report.error(fname, `Invalid SVG/XML: ${err.message}`);
    return;
  }
  if (doc.root !== "svg") {
    report.error(fname, "Root element is not <svg>.");
    return;
  }
  if (doc.elements.some((e) => e.tag === "image")) {
    report.warn(fname, "Contains an embedded bitmap <image>. Pexip advises drawing real vector SVGs (e.g. in Inkscape), not converting JPG/PNG.");
  }
  const paths = doc.elements.filter((e) => e.tag === "path");
  if (paths.length === 1 && (paths[0].attrs.d ?? "").length > 20000) {
    report.warn(fname, "One very large path; Pexip advises multiple simpler paths for reliable rendering.");
  }
}

const CONVERT_HINT = "Re-add it in the Voice prompts step to convert it automatically.";

function validateWav(fname, data, report) {
  if (!rules.BASE_AUDIO_FILES.has(fname)) {
    report.warn(fname, "Not a Base theme audio file name, so it will not replace any prompt.");
  }
  let info;
  try {
    info = wavInfo(data);
  } catch (err) {
    report.error(fname, `Not a PCM WAV file: ${err.message}. ${CONVERT_HINT}`);
    return;
  }
  const problems = [];
  if (info.format !== 1) problems.push("not PCM");
  if (info.bitsPerSample !== rules.AUDIO_SAMPLE_WIDTH_BYTES * 8) problems.push(`${info.bitsPerSample}-bit (needs 16-bit)`);
  if (info.channels !== rules.AUDIO_CHANNELS) problems.push(`${info.channels} channels (needs mono)`);
  if (info.sampleRate !== rules.AUDIO_SAMPLE_RATE) problems.push(`${info.sampleRate} Hz (needs 48000 Hz)`);
  if (problems.length) {
    report.error(fname, `Audio must be 16-bit mono 48 kHz PCM WAV: ${problems.join(", ")}. ${CONVERT_HINT}`);
  }
}
