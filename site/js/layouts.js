// Custom layouts (custom_layout_*.json): rules, geometry and templates.
// Format: https://docs.pexip.com/admin/themes_file_requirements.htm (custom layouts section).

import { CUSTOM_LAYOUT_MAX_GRID, CUSTOM_LAYOUT_MAX_SLOTS, CUSTOM_LAYOUT_NAME_RE, CUSTOM_LAYOUT_PREFIX } from "./rules.js";

export const WATERMARK_POSITIONS = ["top-left", "top-right", "bottom-left", "bottom-right"];
export const NOTCH_COLORS = ["dark", "light"];
export const DEFAULT_SLOT_PADDING = 0.001;
export const MAX_SLOT_PADDING = 0.1;
const KNOWN_KEYS = new Set(["name", "modes", "pres_modes", "dual_screen_enabled", "dual_screen_modes", "remove_self",
  "background_color", "watermark_position", "notch_color"]);

export const layoutFileName = (name) => `${CUSTOM_LAYOUT_PREFIX}${name}.json`;
const isInt = (v) => Number.isInteger(v);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Every list of modes in a layout, with its JSON path and whether it's a presentation list. */
export function modeLists(layout) {
  const out = [];
  if (Array.isArray(layout?.modes)) out.push({ key: "modes", modes: layout.modes, pres: false });
  if (Array.isArray(layout?.pres_modes)) out.push({ key: "pres_modes", modes: layout.pres_modes, pres: true });
  const d = layout?.dual_screen_modes;
  if (isObj(d)) {
    for (const k of ["primary_modes", "secondary_modes"]) {
      if (Array.isArray(d[k])) out.push({ key: `dual_screen_modes.${k}`, modes: d[k], pres: false });
    }
  }
  return out;
}

/**
 * Check one mode. Issues carry { level, message, list, mode, slot? } so an editor can highlight them.
 * `pres` = presentation mode (first slot must be the presentation slot).
 */
export function checkMode(mode, { pres = false, list = "modes", index = 0 } = {}) {
  const issues = [];
  const where = `${list}[${index}]`;
  const add = (level, message, slot) => issues.push({ level, message: `${where}${slot !== undefined ? `.slots[${slot}]` : ""}: ${message}`, list, mode: index, slot });
  if (!isObj(mode)) { add("error", "must be an object."); return issues; }
  const g = mode.grid_size;
  let n = null;
  if (!Array.isArray(g) || g.length !== 2 || !isInt(g[0]) || g[0] !== g[1] || g[0] < 1 || g[0] > CUSTOM_LAYOUT_MAX_GRID) {
    add("error", `grid_size must be two equal whole numbers from 1 to ${CUSTOM_LAYOUT_MAX_GRID}, e.g. [4, 4].`);
  } else n = g[0];
  const c = mode.constraints;
  let max = null;
  if (!isObj(c) || !isInt(c.min_slots) || !isInt(c.max_slots) || c.min_slots < 1 || c.max_slots > CUSTOM_LAYOUT_MAX_SLOTS || c.min_slots > c.max_slots) {
    add("error", `constraints needs min_slots and max_slots from 1 to ${CUSTOM_LAYOUT_MAX_SLOTS}, with min ≤ max.`);
  } else max = c.max_slots;
  if (mode.slot_padding !== undefined && (typeof mode.slot_padding !== "number" || mode.slot_padding < 0 || mode.slot_padding > MAX_SLOT_PADDING)) {
    add("error", `slot_padding must be a number from 0 to ${MAX_SLOT_PADDING}.`);
  }
  if (!Array.isArray(mode.slots) || !mode.slots.length) { add("error", "slots must be a non-empty list."); return issues; }
  if (max !== null && mode.slots.length !== max) add("error", `has ${mode.slots.length} slots but max_slots is ${max}; they must match.`);

  const owner = n ? Array.from({ length: n }, () => new Array(n).fill(-1)) : null;
  let speakerRunEnded = false;
  mode.slots.forEach((s, i) => {
    if (!isObj(s) || !isInt(s.start_x) || !isInt(s.start_y) || !isInt(s.width) || s.start_x < 0 || s.start_y < 0 || s.width < 1) {
      add("error", "needs whole-number start_x, start_y (0 or more) and width (1 or more).", i);
      return;
    }
    if (n && (s.start_x + s.width > n || s.start_y + s.width > n)) add("error", `goes outside the ${n}×${n} grid.`, i);
    else if (owner) {
      const clash = new Set();
      for (let y = s.start_y; y < s.start_y + s.width; y++) {
        for (let x = s.start_x; x < s.start_x + s.width; x++) {
          if (owner[y][x] >= 0) clash.add(owner[y][x]);
          else owner[y][x] = i;
        }
      }
      if (clash.size) add("error", `overlaps slot ${[...clash].map((k) => k + 1).join(", ")}.`, i);
    }
    if (s.is_presentation_slot !== undefined && typeof s.is_presentation_slot !== "boolean") add("error", "is_presentation_slot must be true or false.", i);
    if (s.is_speaker_slot !== undefined && typeof s.is_speaker_slot !== "boolean") add("error", "is_speaker_slot must be true or false.", i);
    if (s.is_presentation_slot && !pres) add("error", "is_presentation_slot is only allowed in pres_modes.", i);
    if (s.is_presentation_slot && pres && i !== 0) add("error", "only the first slot can be the presentation slot.", i);
    // Speaker slots: the first participant slot must be one, and they must be consecutive.
    const firstParticipant = pres ? 1 : 0;
    if (i < firstParticipant) return;
    if (s.is_speaker_slot) {
      if (speakerRunEnded) add("error", "speaker slots must be next to each other in the slot order.", i);
    } else {
      if (i === firstParticipant) add("error", `the first ${pres ? "participant " : ""}slot must be a speaker slot.`, i);
      speakerRunEnded = true;
    }
  });
  if (pres && !mode.slots[0]?.is_presentation_slot) add("error", "the first slot must have is_presentation_slot: true.", 0);
  return issues;
}

/** Full check of a custom layout object. Returns [{ level: "error"|"warning", message, list?, mode?, slot? }]. */
export function checkLayout(layout) {
  const issues = [];
  const err = (message) => issues.push({ level: "error", message });
  const warn = (message) => issues.push({ level: "warning", message });
  if (!isObj(layout)) { err("A custom layout must be a JSON object."); return issues; }
  if (typeof layout.name !== "string" || !CUSTOM_LAYOUT_NAME_RE.test(layout.name)) {
    err("'name' is required: up to 50 letters, digits or underscores, no spaces.");
  }
  if (!Array.isArray(layout.modes) || !layout.modes.length) err("'modes' must be a list containing at least one valid mode.");
  if (layout.pres_modes !== undefined && !Array.isArray(layout.pres_modes)) err("'pres_modes' must be a list.");
  for (const k of ["dual_screen_enabled", "remove_self"]) {
    if (layout[k] !== undefined && typeof layout[k] !== "boolean") err(`'${k}' must be true or false.`);
  }
  if (layout.background_color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(String(layout.background_color))) err("'background_color' must look like #rrggbb.");
  if (layout.watermark_position !== undefined && !WATERMARK_POSITIONS.includes(layout.watermark_position)) err(`'watermark_position' must be one of ${WATERMARK_POSITIONS.join(", ")}.`);
  if (layout.notch_color !== undefined && !NOTCH_COLORS.includes(layout.notch_color)) err("'notch_color' must be dark or light.");
  if (layout.dual_screen_modes !== undefined && !isObj(layout.dual_screen_modes)) err("'dual_screen_modes' must be an object with primary_modes and secondary_modes.");
  for (const k of Object.keys(layout)) if (!KNOWN_KEYS.has(k)) warn(`Unknown field '${k}' (Infinity may reject it).`);

  for (const { key, modes, pres } of modeLists(layout)) {
    modes.forEach((m, i) => issues.push(...checkMode(m, { pres, list: key, index: i })));
  }
  const d = layout.dual_screen_modes;
  if (isObj(d) && Array.isArray(d.primary_modes) && Array.isArray(d.secondary_modes)) {
    const most = (ms) => Math.max(0, ...ms.map((m) => m?.constraints?.max_slots ?? 0));
    if (most(d.primary_modes) + most(d.secondary_modes) > CUSTOM_LAYOUT_MAX_SLOTS) {
      err(`Dual screen layouts can hold up to ${CUSTOM_LAYOUT_MAX_SLOTS} participants across both screens.`);
    }
  }
  // Participant counts with no matching mode fall back to another mode; worth knowing.
  if (Array.isArray(layout.modes) && layout.modes.length && !issues.some((i) => i.level === "error")) {
    const top = Math.max(...layout.modes.map((m) => m.constraints.max_slots));
    const gaps = [];
    for (let n = 1; n <= top; n++) if (!layout.modes.some((m) => m.constraints.min_slots <= n && n <= m.constraints.max_slots)) gaps.push(n);
    if (gaps.length) warn(`No mode covers ${gaps.length === 1 ? "1 participant count" : `${gaps.length} participant counts`} (${gaps.slice(0, 6).join(", ")}${gaps.length > 6 ? "…" : ""}).`);
  }
  return issues;
}

/** The mode Infinity would use for n participants (first match; otherwise the nearest). */
export function pickMode(modes, n) {
  if (!Array.isArray(modes) || !modes.length) return null;
  const ok = modes.filter((m) => isObj(m?.constraints));
  const hit = ok.find((m) => m.constraints.min_slots <= n && n <= m.constraints.max_slots);
  if (hit) return hit;
  if (!ok.length) return modes[0];
  return n < Math.min(...ok.map((m) => m.constraints.min_slots))
    ? ok.reduce((a, b) => (b.constraints.min_slots < a.constraints.min_slots ? b : a))
    : ok.reduce((a, b) => (b.constraints.max_slots > a.constraints.max_slots ? b : a));
}

/** Pixel rectangles for a mode's slots on a W×H (16:9) canvas. Cells are W/n wide and H/n tall. */
export function slotRects(mode, W = 1920, H = 1080) {
  const n = mode?.grid_size?.[0];
  if (!isInt(n) || n < 1 || !Array.isArray(mode.slots)) return [];
  const pad = (typeof mode.slot_padding === "number" ? mode.slot_padding : DEFAULT_SLOT_PADDING) * W;
  const cw = W / n;
  const ch = H / n;
  return mode.slots.filter(isObj).map((s, index) => ({
    index,
    x: s.start_x * cw + pad,
    y: s.start_y * ch + pad,
    w: Math.max(0, s.width * cw - 2 * pad),
    h: Math.max(0, s.width * ch - 2 * pad),
    speaker: Boolean(s.is_speaker_slot),
    presentation: Boolean(s.is_presentation_slot),
  }));
}

// ---------------------------------------------------------------------------
// Templates (also used to preview Pexip's three built-in example layouts)
// ---------------------------------------------------------------------------

const slot = (x, y, width = 1, speaker = false) => ({ start_x: x, start_y: y, width, ...(speaker ? { is_speaker_slot: true } : {}) });
const mode = (n, min, slots) => ({ grid_size: [n, n], constraints: { min_slots: min, max_slots: slots.length }, slots });
const single = () => mode(1, 1, [slot(0, 0, 1, true)]);

const ring4 = () => [
  slot(0, 0), slot(1, 0), slot(2, 0), slot(3, 0),
  slot(0, 1), slot(3, 1), slot(0, 2), slot(3, 2),
  slot(0, 3), slot(1, 3), slot(2, 3), slot(3, 3),
];

export const TEMPLATES = {
  blank: {
    title: "Blank (one participant)",
    layout: () => ({ name: "my_layout", modes: [single()] }),
  },
  one_main_twelve_around: {
    title: "1 main + 12 around",
    layout: () => ({ name: "my_main_twelve_around", modes: [single(), mode(4, 2, [slot(1, 1, 2, true), ...ring4()])] }),
  },
  two_mains_eight_around: {
    title: "2 mains + 8 around",
    layout: () => ({ name: "my_two_mains_eight_around", modes: [
      single(),
      mode(4, 2, [slot(0, 1, 2, true), slot(2, 1, 2, true)]),
      mode(4, 3, [slot(0, 1, 2, true), slot(2, 1, 2, true), slot(0, 0), slot(1, 0), slot(2, 0), slot(3, 0), slot(0, 3), slot(1, 3), slot(2, 3), slot(3, 3)]),
    ] }),
  },
  one_main_nine_around: {
    title: "1 main + 9 around",
    layout: () => ({ name: "my_main_nine_around", modes: [
      single(),
      mode(5, 2, [slot(1, 0, 4, true), slot(0, 0), slot(0, 1), slot(0, 2), slot(0, 3), slot(0, 4), slot(1, 4), slot(2, 4), slot(3, 4), slot(4, 4)]),
    ] }),
  },
  speaker_strip: {
    title: "Speaker + strip of 5",
    layout: () => ({ name: "my_speaker_strip", modes: [
      single(),
      mode(5, 2, [slot(0, 0, 4, true), slot(0, 4), slot(1, 4), slot(2, 4), slot(3, 4), slot(4, 4)]),
    ] }),
  },
};

/** Geometry for Pexip's built-in example layouts (same shapes as the templates). */
export const BUILTIN_EXAMPLES = Object.fromEntries(["one_main_twelve_around", "two_mains_eight_around", "one_main_nine_around"]
  .map((k) => [k, { ...TEMPLATES[k].layout(), name: k }]));
