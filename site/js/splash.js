// Splash screen layout, for previews. Pure functions, testable in Node.
//
// Layout rules from Pexip's theme documentation:
// - vertical (default): elements stack top to bottom. offset_y is the gap below
//   the previous element (or the top edge); boxes are centred horizontally and
//   offset_x shifts them from the centre. Box width defaults to 1920.
// - free_form: offset_x / offset_y are absolute coordinates.
// - direct_media (used by Pexip's own defaults): treated like vertical.
// Icons are centred in their box and scaled to fit; text is drawn in its box.

export const SCREEN_W = 1920;
export const SCREEN_H = 1080;

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const num = (v, fallback) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** Sample values for placeholders Infinity fills in. */
export const SAMPLE_VALUES = { conference_id: "1234", conference_name: "Board Room", number_of_waiting_participants: "2" };

export function fillPlaceholders(text) {
  return String(text).replace(/\{(\w+)\}/g, (all, key) => SAMPLE_VALUES[key] ?? all);
}

/** Infinity colour (0xRRGGBB, 0xAARRGGBB, #RRGGBB or an ARGB integer) -> CSS rgba(), or fallback. */
export function argbToCss(value, fallback = null) {
  let a = 255;
  let rgb;
  if (Number.isInteger(value) && value >= 0 && value <= 0xffffffff) {
    a = Math.floor(value / 0x1000000);
    rgb = value % 0x1000000;
  } else {
    const m = /^(?:0x|#)([0-9a-f]{6}|[0-9a-f]{8})$/i.exec(String(value ?? ""));
    if (!m) return fallback;
    const hex = m[1];
    if (hex.length === 8) a = parseInt(hex.slice(0, 2), 16);
    rgb = parseInt(hex.slice(-6), 16);
  }
  return `rgba(${(rgb >> 16) & 255}, ${(rgb >> 8) & 255}, ${rgb & 255}, ${+(a / 255).toFixed(3)})`;
}

/**
 * Screens and labels as Infinity will use them: a theme's screen spec replaces
 * that screen's default; labels merge over the defaults.
 */
export function effectiveScreens(config, defaults) {
  const def = defaults?.splash_screens ?? {};
  const theme = isObject(config?.splash_screens) ? config.splash_screens : {};
  return {
    screens: { ...(def.screens ?? {}), ...(isObject(theme.screens) ? theme.screens : {}) },
    labels: { ...(def.labels ?? {}), ...(isObject(theme.labels) ? theme.labels : {}) },
  };
}

/** Background of a screen: { path } or { color } (CSS), defaulting to background.jpg. */
export function screenBackground(spec) {
  const bg = spec?.background;
  if (isObject(bg) && typeof bg.path === "string") return { path: bg.path };
  if (isObject(bg) && "color" in bg) return { color: argbToCss(bg.color, "rgb(50, 50, 50)") };
  return { path: "background.jpg" };
}

/**
 * Position every element of a screen in 1920x1080 space.
 * Returns [{ kind: "icon" | "text" | "digits", x, y, w, h, ... }].
 */
export function layoutScreen(spec, labels = {}) {
  const free = spec?.layout_type === "free_form";
  let bottom = 0;
  const out = [];
  for (const el of Array.isArray(spec?.elements) ? spec.elements : []) {
    if (!isObject(el)) continue;
    const isText = el.type === "text";
    const fontSize = num(el.font_size, 60);
    const w = num(el.width, SCREEN_W);
    const h = num(el.height, isText ? Math.round(fontSize * 1.4) : 200);
    const x = free ? num(el.offset_x, 0) : (SCREEN_W - w) / 2 + num(el.offset_x, 0);
    const y = free ? num(el.offset_y, 0) : bottom + num(el.offset_y, 0);
    bottom = y + h;
    const box = { x, y, w, h };
    if (el.type === "icon") {
      out.push({ kind: "icon", ...box, path: el.path });
    } else if (el.type === "pin_digits") {
      out.push({
        kind: "digits", ...box, path: el.path, count: 4,
        digitW: num(el.digit_width, 42), digitH: num(el.digit_height, 42), spacing: num(el.digit_spacing, 10),
      });
    } else if (isText) {
      const key = el.label;
      const raw = typeof key === "string" ? (labels[key] ?? key) : "";
      out.push({
        kind: "text", ...box, label: key, text: fillPlaceholders(raw),
        style: {
          fontSize,
          lineHeight: Math.max(1, fontSize + num(el.line_spacing, 0)),
          letterSpacing: num(el.letter_spacing, 0),
          align: ["left", "right", "center"].includes(el.align) ? el.align : "center",
          color: argbToCss(el.color, "rgba(255, 255, 255, 1)"),
          font: typeof el.font === "string" ? el.font : "Inter Medium",
        },
      });
    }
  }
  return out;
}

/** Label keys a screen spec shows, in order. */
export function screenLabels(spec) {
  return (Array.isArray(spec?.elements) ? spec.elements : [])
    .filter((e) => isObject(e) && e.type === "text" && typeof e.label === "string")
    .map((e) => e.label);
}

/** Icon files (icon / pin_digits paths) a screen spec uses, in order, without duplicates. */
export function screenIcons(spec) {
  return [...new Set((Array.isArray(spec?.elements) ? spec.elements : [])
    .filter((e) => isObject(e) && typeof e.path === "string")
    .map((e) => e.path))];
}
