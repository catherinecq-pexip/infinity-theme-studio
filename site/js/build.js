// Build a finished theme: the "theme finisher".
//
// Starting point (optional): the ZIP produced by Pexip's branding portal.
// Then, in order:
//   1. experience profiles and imported JSON overlays are deep-merged,
//   2. settings the user removed in the portal are deleted,
//   3. settings the user edited in the portal are deep-merged on top,
//   4. files (images, voice prompts, layouts) are added/replaced/removed,
//   5. anything the target Infinity version doesn't accept is left out.

import * as rules from "./rules.js";
import { copyTheme, loadConfig, newTheme, saveConfig } from "./package.js";

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** Recursively merge overlay into base. Objects merge; everything else (incl. lists) replaces. */
export function deepMerge(base, overlay) {
  const out = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    if (key.startsWith("$")) continue; // "$comment", "$title" etc. are documentation only
    out[key] = isObject(value) && isObject(out[key]) ? deepMerge(out[key], value) : clone(value);
  }
  return out;
}

// -- path helpers (paths are arrays of keys) ----------------------------------

export function getPath(obj, path) {
  let cur = obj;
  for (const k of path) {
    if (!isObject(cur) || !(k in cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}

export function setPath(obj, path, value) {
  let cur = obj;
  path.slice(0, -1).forEach((k) => {
    if (!isObject(cur[k])) cur[k] = {};
    cur = cur[k];
  });
  cur[path[path.length - 1]] = value;
}

/** Delete obj[path], pruning parent objects that become empty. */
export function deletePath(obj, path) {
  const parents = [];
  let cur = obj;
  for (const k of path.slice(0, -1)) {
    if (!isObject(cur[k])) return;
    parents.push([cur, k]);
    cur = cur[k];
  }
  delete cur[path[path.length - 1]];
  for (const [parent, k] of parents.reverse()) {
    if (isObject(parent[k]) && !Object.keys(parent[k]).length) delete parent[k];
    else break;
  }
}

// -- user edits ---------------------------------------------------------------

/**
 * The changes a user makes in the portal, kept separate from the base theme and
 * profiles so profiles can be changed later without losing edits.
 */
export class Edits {
  constructor() {
    this.values = {};          // overlay deep-merged last
    this.removed = new Set();  // JSON-encoded paths deleted before the overlay is applied
  }

  /** Set a value (objects merge with what is already there). */
  set(path, value) {
    setPath(this.values, path, clone(value));
  }

  /** Replace a value completely (nothing from the base/profiles survives underneath). */
  replace(path, value) {
    this.removed.add(JSON.stringify(path));
    setPath(this.values, path, clone(value));
  }

  /** Remove a setting so Infinity's default applies. */
  remove(path) {
    this.removed.add(JSON.stringify(path));
    deletePath(this.values, path);
  }

  reset() {
    this.values = {};
    this.removed.clear();
  }

  /** Number of top-level settings the user has changed. */
  get count() {
    const keys = new Set(Object.keys(this.values));
    for (const p of this.removed) keys.add(JSON.parse(p)[0]);
    return keys.size;
  }

  apply(config) {
    let out = clone(config);
    for (const p of this.removed) deletePath(out, JSON.parse(p));
    return deepMerge(out, this.values);
  }
}

// -- building -----------------------------------------------------------------

/**
 * Build the merged themeconfig.json.
 * profiles: [{ name, data }] in the order they should be applied.
 */
export function buildConfig({ baseConfig = {}, profiles = [], edits = null }) {
  const log = [];
  let config = clone(baseConfig) ?? {};
  if (config.theme_version !== 2) log.push('Set "theme_version": 2');
  config.theme_version = 2;
  for (const { name, data } of profiles) {
    config = deepMerge(config, data);
    const keys = Object.keys(data).filter((k) => !k.startsWith("$"));
    log.push(`Applied ${name}: ${keys.join(", ")}`);
  }
  if (edits && edits.count) {
    config = edits.apply(config);
    log.push(`Applied ${edits.count} change(s) made in the portal`);
  }
  config.theme_version = 2;
  return { config, log };
}

/**
 * Build the finished theme.
 * base: theme from the branding-portal ZIP (or null)
 * files: { name: Uint8Array } added or replaced in the portal
 * removedFiles: Set of base file names the user removed
 */
/**
 * Remove settings, indicator colours, keypad commands and voice prompts that
 * the given Infinity version would reject. Mutates config/files; returns log lines.
 */
export function stripUnsupported(config, files, version) {
  const log = [];
  const needs = (kind, n) => `needs Infinity v${rules.minVersion(kind, n)}`;
  for (const key of Object.keys(config)) {
    if (!rules.supports(version, "setting", key)) {
      delete config[key];
      log.push(`Left out ${key} (${needs("setting", key)})`);
    }
  }
  const colors = config.indicator_color_config;
  if (isObject(colors)) {
    for (const type of Object.keys(colors)) {
      if (!rules.supports(version, "indicator", type)) {
        delete colors[type];
        log.push(`Left out indicator_color_config.${type} (${needs("indicator", type)})`);
      }
    }
    if (!Object.keys(colors).length) delete config.indicator_color_config;
  }
  const dtmf = config.dtmf_conference_control_commands;
  if (isObject(dtmf)) {
    for (const [code, cmd] of Object.entries(dtmf)) {
      if (typeof cmd === "string" && !rules.supports(version, "dtmf", cmd)) {
        delete dtmf[code];
        log.push(`Left out keypad command ${cmd} (${needs("dtmf", cmd)})`);
      }
    }
  }
  for (const fname of Object.keys(files)) {
    if (!rules.supports(version, "audio", fname)) {
      delete files[fname];
      log.push(`Left out ${fname} (${needs("audio", fname)})`);
    }
  }
  return log;
}

export function buildTheme({ name, base = null, profiles = [], edits = null, files = {}, removedFiles = new Set(), version = rules.LATEST_VERSION }) {
  const theme = base ? copyTheme(base, name) : newTheme(name);
  let baseConfig = {};
  try {
    baseConfig = loadConfig(theme);
  } catch {
    // An unreadable themeconfig.json in the base is reported by the Start step; start fresh.
  }
  const { config, log } = buildConfig({ baseConfig, profiles, edits });
  for (const f of removedFiles) {
    if (f in theme.files) {
      delete theme.files[f];
      log.push(`Removed ${f}`);
    }
  }
  for (const [fname, data] of Object.entries(files)) {
    log.push(`${fname in theme.files ? "Replaced" : "Added"} ${fname}`);
    theme.files[fname] = data;
  }
  log.push(...stripUnsupported(config, theme.files, version));
  saveConfig(theme, config);
  return { theme, config, log };
}
