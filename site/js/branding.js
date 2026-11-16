// Read what a user drops on the Start step: an Infinity theme ZIP, a Pexip
// branding portal export (Web App 3 branding package), or both in one ZIP.
//
// The branding portal exports web app branding, not a theme:
//   webapp3/branding/manifest.json  {"brandName", "meta": {"baseColor"},
//                                    "images": {"logo", "background", "jumbotron"},
//                                    "colorPalette": [...], "plugins": [...]}
//   webapp3/branding/<images, plugins>
// We reuse its brand name, logo, background and colours as a starting point for
// the theme, and hand the original ZIP back unchanged for the web app.
//
// Requires JSZip on globalThis (site/vendor/jszip.min.js).

import * as rules from "./rules.js";
import { loadZip, ThemePackageError } from "./package.js";

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const ignored = (path) => path.startsWith("__MACOSX/") || path.split("/").pop().startsWith(".");

export const NOT_RECOGNISED =
  "This ZIP isn't an Infinity theme or a Pexip branding portal export. " +
  "Expected a themeconfig.json, or webapp3/branding/manifest.json from the branding portal.";

function looksLikeBrandingManifest(m) {
  return isObject(m) && ("brandName" in m || isObject(m.images) || Array.isArray(m.colorPalette));
}

/** Join a manifest-relative path like "./logo.png" onto its folder. Returns null for URLs. */
function resolve(folder, ref) {
  if (typeof ref !== "string" || !ref || /^[a-z]+:/i.test(ref) || ref.startsWith("//")) return null;
  const parts = (folder + ref.replace(/^\.\//, "")).split("/");
  const out = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p !== "." && p !== "") out.push(p);
  }
  return out.join("/");
}

/** Lower-case slug suitable for a theme name, e.g. "Event Room" -> "event-room". */
export function slug(s) {
  return String(s ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

/**
 * Find and read a branding portal manifest in an already-opened JSZip.
 * Returns null when the ZIP has no branding manifest.
 */
export async function parseBranding(zip) {
  const candidates = Object.values(zip.files)
    .filter((e) => !e.dir && !ignored(e.name) && e.name.split("/").pop() === "manifest.json")
    .sort((a, b) => a.name.split("/").length - b.name.split("/").length);
  for (const entry of candidates) {
    let manifest;
    try {
      manifest = JSON.parse((await entry.async("string")).replace(/^\uFEFF/, ""));
    } catch {
      continue;
    }
    if (!looksLikeBrandingManifest(manifest)) continue;
    const folder = entry.name.slice(0, -"manifest.json".length);
    const images = {};
    for (const key of ["logo", "background", "jumbotron"]) {
      const path = resolve(folder, manifest.images?.[key]);
      const file = path ? zip.file(path) : null;
      images[key] = file ? { name: path.split("/").pop(), bytes: await file.async("uint8array") } : null;
    }
    const palette = (Array.isArray(manifest.colorPalette) ? manifest.colorPalette : [])
      .filter((c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c));
    const baseColor = /^#[0-9a-f]{6}$/i.test(manifest.meta?.baseColor ?? "") ? manifest.meta.baseColor : (palette[5] ?? null);
    return {
      manifest,
      folder,
      brandName: typeof manifest.brandName === "string" ? manifest.brandName.trim() : "",
      baseColor,
      palette,
      images,
      plugins: Array.isArray(manifest.plugins) ? manifest.plugins.length : 0,
    };
  }
  return null;
}

/**
 * Work out what a dropped ZIP contains.
 * Returns { theme: {theme, notes} | null, branding: {...} | null }; throws ThemePackageError if neither.
 */
export async function inspectZip(bytes, name) {
  let zip;
  try {
    zip = await globalThis.JSZip.loadAsync(bytes);
  } catch (err) {
    throw new ThemePackageError(`Not a valid ZIP file (${err.message}).`);
  }
  const branding = await parseBranding(zip);
  const hasThemeConfig = Object.values(zip.files)
    .some((e) => !e.dir && !ignored(e.name) && e.name.split("/").pop() === rules.THEMECONFIG);

  let theme = null;
  if (hasThemeConfig || !branding) {
    try {
      theme = await loadZip(bytes, name);
    } catch (err) {
      if (branding) theme = null;
      else throw new ThemePackageError(err.message.startsWith("Nested folders") ? NOT_RECOGNISED : err.message);
    }
  }
  if (theme && !branding && !Object.keys(theme.theme.files).length) throw new ThemePackageError(NOT_RECOGNISED);
  return { theme, branding };
}
