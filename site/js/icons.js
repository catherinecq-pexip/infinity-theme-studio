// In-conference indicator icons (icon_notch57tp_<item>.svg). Pure helpers, testable in Node.
//
// Infinity uses two versions of each icon: a black <item>.svg for the light-mode
// notch and a white <item>_dark.svg for the default dark notch. Users upload one
// (black) icon; makeDarkVariant() derives the white one when the artwork is a
// single dark colour.

import * as rules from "./rules.js";
import { parseXml } from "./formats.js";

export function notchFile(item, dark = false) {
  return `${rules.NOTCH_ICON_PREFIX}${item}${dark ? "_dark" : ""}.svg`;
}

/** "recording_dark.svg" style file name -> { item, dark } (or null if not a notch icon file). */
export function parseNotchFile(fname) {
  const m = new RegExp(`^${rules.NOTCH_ICON_PREFIX}([a-z0-9_]+?)(_dark)?\\.svg$`).exec(fname);
  return m ? { item: m[1], dark: Boolean(m[2]) } : null;
}

const NAMED = { black: [0, 0, 0], white: [255, 255, 255] };

function toRgb(c) {
  const v = c.trim().toLowerCase();
  if (v in NAMED) return NAMED[v];
  let m = /^#([0-9a-f]{3})$/.exec(v);
  if (m) return [...m[1]].map((x) => parseInt(x + x, 16));
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(v);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(v);
  if (m) return m.slice(1, 4).map(Number);
  return null;
}

/** The "black" artwork colour: black, #212121 or a dark grey (not a dark red/blue). */
export function isDarkColour(c) {
  if (/^currentcolor$/i.test(c.trim())) return true; // inherits CSS color, black by default
  const rgb = toRgb(c);
  if (!rgb) return false;
  const chroma = Math.max(...rgb) - Math.min(...rgb);
  const [r, g, b] = rgb.map((x) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.06 && chroma < 40;
}

const IGNORED = /^(none|transparent|inherit)$/i;
const ATTR_RE = /\b(fill|stroke|stop-color)\s*=\s*(["'])([^"']*)\2/gi;
const STYLE_RE = /\b(fill|stroke|stop-color)\s*:\s*([^;"']+)/gi;

/**
 * Make the white (_dark) version of a black icon.
 * Returns { svg, recoloured }. recoloured is false when the artwork has colours
 * other than dark ones (e.g. a red recording dot) and is returned unchanged.
 */
export function makeDarkVariant(svgText) {
  const colours = [];
  for (const m of svgText.matchAll(ATTR_RE)) colours.push(m[3]);
  for (const m of svgText.matchAll(STYLE_RE)) colours.push(m[2]);
  const used = colours.filter((c) => !IGNORED.test(c.trim()));
  if (used.some((c) => !isDarkColour(c))) return { svg: svgText, recoloured: false };
  if (!used.length) {
    // No colours at all: SVG paints black by default, so paint the root white.
    return { svg: svgText.replace(/<svg\b/i, '<svg fill="white"'), recoloured: true };
  }
  const swap = (c) => (IGNORED.test(c.trim()) ? c : "white");
  const svg = svgText
    .replace(ATTR_RE, (all, name, q, value) => `${name}=${q}${swap(value)}${q}`)
    .replace(STYLE_RE, (all, name, value) => `${name}:${swap(value)}`);
  return { svg, recoloured: true };
}

/** Problems with an uploaded icon: [{ level: "error" | "warning", message }]. */
export function checkNotchSvg(svgText) {
  let doc;
  try {
    doc = parseXml(svgText);
  } catch (err) {
    return [{ level: "error", message: `Not a valid SVG file (${err.message}).` }];
  }
  if (doc.root !== "svg") return [{ level: "error", message: "This file isn't an SVG (the root element isn't <svg>)." }];
  const out = [];
  const root = doc.elements[0];
  if (!root.attrs.viewBox) out.push({ level: "warning", message: "No viewBox, so the icon may not scale to the 12–48 px Infinity uses. Export with a viewBox (24×24 recommended)." });
  const tags = new Set(doc.elements.map((e) => e.tag));
  if (tags.has("image")) out.push({ level: "warning", message: "Contains an embedded bitmap. Use real vector shapes so the icon stays sharp." });
  if (tags.has("script") || tags.has("foreignObject")) out.push({ level: "error", message: "Contains scripts or HTML content, which icons must not include." });
  return out;
}
