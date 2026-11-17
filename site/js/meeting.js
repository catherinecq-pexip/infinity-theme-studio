// In-meeting preview geometry: where participant tiles go for a layout (approximate for built-ins).

import { BUILTIN_EXAMPLES, pickMode, slotRects } from "./layouts.js";

export const W = 1920;
export const H = 1080;
const GAP = 4;
/** Height of the white footer band in the 1 + 33 layout (holds watermark_footer_icon.png). */
export const FOOTER_H = 120;

/** Watermark area from Pexip's docs: 200x100, 56 px across and 40 px down from the main video's top-left. */
export const WATERMARK = { w: 200, h: 100, dx: 56, dy: 40 };

const fit169 = (w, h) => (w / h > 16 / 9 ? { w: (h * 16) / 9, h } : { w, h: (w * 9) / 16 });

/** Equal grid, centred, partial last row centred (Adaptive Composition / NxN look). */
function equalGrid(count, cols, rows = Math.ceil(count / cols)) {
  const cell = fit169(W / cols, H / rows);
  const top = (H - cell.h * rows) / 2;
  const tiles = [];
  for (let i = 0; i < count; i++) {
    const r = Math.floor(i / cols);
    const inRow = Math.min(cols, count - r * cols);
    const left = (W - cell.w * inRow) / 2;
    tiles.push({ x: left + (i % cols) * cell.w + GAP / 2, y: top + r * cell.h + GAP / 2, w: cell.w - GAP, h: cell.h - GAP });
  }
  return tiles;
}

/** Main speaker(s) on top, rows of small tiles underneath. */
function mainsAndStrip(n, mains, perRow, maxThumbs, area = H) {
  const thumbs = Math.max(0, Math.min(n - mains, maxThumbs));
  const shownMains = Math.min(mains, n);
  const tw = W / perRow;
  const th = (tw * 9) / 16;
  const rows = Math.ceil(thumbs / perRow);
  const stripH = rows * th;
  const tiles = [];
  const main = fit169(W / shownMains, area - stripH);
  const mainsW = main.w * shownMains;
  for (let i = 0; i < shownMains; i++) {
    tiles.push({ x: (W - mainsW) / 2 + i * main.w + GAP / 2, y: GAP / 2, w: main.w - GAP, h: main.h - GAP, speaker: true });
  }
  for (let i = 0; i < thumbs; i++) {
    const r = Math.floor(i / perRow);
    const inRow = Math.min(perRow, thumbs - r * perRow);
    tiles.push({ x: (W - inRow * tw) / 2 + (i % perRow) * tw + GAP / 2, y: area - stripH + r * th + GAP / 2, w: tw - GAP, h: th - GAP });
  }
  return tiles;
}

/** Approximate tiles for Infinity's built-in layouts. The first tile is the main speaker. */
export function builtinTiles(layout, n) {
  n = Math.max(1, Math.floor(n));
  let tiles;
  switch (layout) {
    case "1:0": tiles = [{ x: 0, y: 0, w: W, h: H, speaker: true }]; break;
    case "1:7": tiles = mainsAndStrip(n, 1, 7, 7); break;
    case "1:21": tiles = mainsAndStrip(n, 1, 7, 21); break;
    case "2:21": tiles = mainsAndStrip(n, 2, 7, 21); break;
    case "1:33": tiles = mainsAndStrip(n, 1, 11, 33, H - FOOTER_H); break;
    case "2x2": case "3x3": case "4x4": case "5x5": {
      const k = Number(layout[0]);
      tiles = equalGrid(Math.min(n, k * k), k, k);
      break;
    }
    default: {
      if (BUILTIN_EXAMPLES[layout]) return customTiles(BUILTIN_EXAMPLES[layout], n);
      // Adaptive Composition and anything unknown: an equal grid that grows with the meeting.
      const count = Math.min(n, 25);
      tiles = equalGrid(count, Math.ceil(Math.sqrt(count)));
    }
  }
  return tiles.map((t, i) => ({ ...t, main: i === 0 }));
}

/** Tiles for a custom layout object with n participants. */
export function customTiles(layout, n) {
  const mode = pickMode(layout?.modes, n);
  if (!mode) return [];
  return slotRects(mode, W, H).slice(0, Math.max(1, n)).map((r, i) => ({ x: r.x, y: r.y, w: r.w, h: r.h, speaker: r.speaker, main: i === 0 }));
}

/**
 * Tiles for a layout name: a custom layout from the theme (by its "name"), else a built-in.
 * `customLayouts` maps layout name -> parsed custom layout JSON.
 */
export function meetingTiles(layoutName, n, customLayouts = {}) {
  const custom = customLayouts[layoutName];
  return custom ? customTiles(custom, n) : builtinTiles(layoutName, n);
}

/** Watermark rectangle for the main tile, or a layout corner when the custom layout sets watermark_position. */
export function watermarkRect(tiles, position) {
  if (position) {
    const right = position.endsWith("right");
    const bottom = position.startsWith("bottom");
    return { x: right ? W - WATERMARK.dx - WATERMARK.w : WATERMARK.dx, y: bottom ? H - WATERMARK.dy - WATERMARK.h : WATERMARK.dy, w: WATERMARK.w, h: WATERMARK.h };
  }
  const main = tiles.find((t) => t.main) ?? { x: 0, y: 0, w: W, h: H };
  return { x: main.x + WATERMARK.dx, y: main.y + WATERMARK.dy, w: WATERMARK.w, h: WATERMARK.h };
}
