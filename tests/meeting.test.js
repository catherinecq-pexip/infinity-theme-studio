// In-meeting preview geometry.

import { test } from "node:test";
import assert from "node:assert/strict";
import { BUILTIN_LAYOUTS } from "../site/js/rules.js";
import { TEMPLATES } from "../site/js/layouts.js";
import { builtinTiles, H, meetingTiles, W, watermarkRect } from "../site/js/meeting.js";

const inside = (t) => t.x >= 0 && t.y >= 0 && t.x + t.w <= W + 0.01 && t.y + t.h <= H + 0.01;

test("every built-in layout gives sensible tiles", () => {
  for (const layout of BUILTIN_LAYOUTS) {
    for (const n of [1, 2, 5, 9, 30]) {
      const tiles = builtinTiles(layout, n);
      assert.ok(tiles.length >= 1 && tiles.length <= n, `${layout} n=${n}: ${tiles.length}`);
      assert.ok(tiles.every(inside), `${layout} n=${n} inside the screen`);
      assert.equal(tiles.filter((t) => t.main).length, 1, `${layout}: one main tile`);
    }
  }
  assert.equal(builtinTiles("1:0", 10).length, 1);
  assert.equal(builtinTiles("1:7", 20).length, 8);
  assert.equal(builtinTiles("2:21", 30).length, 23);
  assert.equal(builtinTiles("3x3", 20).length, 9);
});

test("custom layouts from the theme are used by name", () => {
  const layout = TEMPLATES.speaker_strip.layout();
  const tiles = meetingTiles(layout.name, 4, { [layout.name]: layout });
  assert.equal(tiles.length, 4);
  assert.ok(tiles[0].w > 1500 && tiles[0].main, "speaker tile spans 4 of 5 columns");
  assert.equal(meetingTiles("2x2", 4, { [layout.name]: layout }).length, 4);
});

test("watermark sits 56/40 px from the main video, or in the layout's corner", () => {
  const tiles = builtinTiles("1:0", 1);
  assert.deepEqual(watermarkRect(tiles), { x: 56, y: 40, w: 200, h: 100 });
  assert.deepEqual(watermarkRect(tiles, "bottom-right"), { x: W - 256, y: H - 140, w: 200, h: 100 });
});
