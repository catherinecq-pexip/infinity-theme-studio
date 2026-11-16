// Read and write theme packages (ZIP files).
//
// A theme is held in memory as { name, files } where files maps file name ->
// Uint8Array. Infinity themes are flat (all files at the same level), so
// sub-folders are not supported; a single wrapping top-level folder inside a
// ZIP is unwrapped.
//
// Requires JSZip on globalThis (site/vendor/jszip.min.js).

import * as rules from "./rules.js";

export const IGNORED_NAMES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

export class ThemePackageError extends Error {}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }); // keep BOMs so validation can flag them

export const utf8 = {
  encode: (s) => encoder.encode(s),
  decode: (b) => decoder.decode(b),
};

export function newTheme(name, files = {}) {
  return { name, files: { ...files } };
}

export function copyTheme(theme, name) {
  return newTheme(name ?? theme.name, theme.files);
}

export function hasConfig(theme) {
  return rules.THEMECONFIG in theme.files;
}

/** Parse themeconfig.json (throws on bad input). Returns {} when absent. */
export function loadConfig(theme) {
  if (!hasConfig(theme)) return {};
  return JSON.parse(utf8.decode(theme.files[rules.THEMECONFIG]).replace(/^\uFEFF/, ""));
}

export function saveConfig(theme, config) {
  theme.files[rules.THEMECONFIG] = utf8.encode(JSON.stringify(config, null, 4) + "\n");
}

function clean(path) {
  const base = path.split("/").pop();
  return Boolean(base) && !IGNORED_NAMES.has(base) && !path.startsWith("__MACOSX/");
}

function jszip() {
  const JSZip = globalThis.JSZip;
  if (!JSZip) throw new Error("JSZip is not loaded");
  return JSZip;
}

/**
 * Load a theme from ZIP bytes.
 * Returns { theme, notes } where notes describe anything that was skipped.
 */
export async function loadZip(data, name) {
  let zip;
  try {
    zip = await jszip().loadAsync(data);
  } catch (err) {
    throw new ThemePackageError(`Not a valid ZIP file (${err.message}).`);
  }
  const entries = Object.values(zip.files).filter((e) => !e.dir && clean(e.name));
  const names = entries.map((e) => e.name);
  const notes = [];

  // Unwrap a single top-level folder (e.g. "secure/themeconfig.json").
  const prefixes = new Set(names.filter((n) => n.includes("/")).map((n) => n.split("/", 1)[0]));
  const flat = names.filter((n) => !n.includes("/"));
  let prefix = "";
  if (prefixes.size === 1 && flat.length === 0) prefix = [...prefixes][0] + "/";

  let selected = entries;
  const nested = entries.filter((e) => e.name.slice(prefix.length).includes("/"));
  if (nested.length) {
    // More than one folder level: use the folder that holds themeconfig.json, if any.
    const configs = names.filter((n) => n.split("/").pop() === rules.THEMECONFIG);
    if (configs.length !== 1) {
      throw new ThemePackageError(
        `Nested folders are not supported in themes: ${nested[0].name}` +
        (configs.length > 1 ? " (found more than one themeconfig.json)" : ""));
    }
    prefix = configs[0].slice(0, -rules.THEMECONFIG.length);
    selected = entries.filter((e) => e.name.startsWith(prefix) && !e.name.slice(prefix.length).includes("/"));
    const skipped = entries.length - selected.length;
    notes.push(`Used the theme in folder "${prefix}"` + (skipped ? ` and ignored ${skipped} other file(s).` : "."));
  }

  const files = {};
  for (const entry of selected) {
    files[entry.name.slice(prefix.length)] = await entry.async("uint8array");
  }
  return { theme: newTheme(name, files), notes };
}

/**
 * Serialise a theme to ZIP bytes.
 *
 * Pexip's manual-theme instructions say to "create a ZIP file of the new
 * folder", so by default files are placed inside a folder named after the theme.
 */
export async function toZip(theme, { wrapFolder = true } = {}) {
  const zip = new (jszip())();
  const folder = wrapFolder ? `${theme.name}/` : "";
  for (const fname of Object.keys(theme.files).sort()) {
    zip.file(folder + fname, theme.files[fname]);
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
