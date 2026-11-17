// Custom layout rules, geometry and templates.

import { test } from "node:test";
import assert from "node:assert/strict";
import { BUILTIN_EXAMPLES, checkLayout, layoutFileName, pickMode, slotRects, TEMPLATES } from "../site/js/layouts.js";

const errors = (layout) => checkLayout(layout).filter((i) => i.level === "error").map((i) => i.message);
const base = () => TEMPLATES.one_main_twelve_around.layout();

test("all templates and built-in examples are valid", () => {
  for (const [key, t] of Object.entries(TEMPLATES)) assert.deepEqual(checkLayout(t.layout()), [], key);
  for (const [key, l] of Object.entries(BUILTIN_EXAMPLES)) assert.deepEqual(errors(l), [], key);
  assert.equal(layoutFileName("abc"), "custom_layout_abc.json");
});

test("the docs' presentation and dual screen options are accepted", () => {
  const l = base();
  l.pres_modes = [{ grid_size: [4, 4], constraints: { min_slots: 1, max_slots: 2 }, slots: [
    { start_x: 0, start_y: 0, width: 3, is_presentation_slot: true }, { start_x: 3, start_y: 0, width: 1, is_speaker_slot: true }] }];
  Object.assign(l, { dual_screen_enabled: true, remove_self: false, background_color: "#fffff0", watermark_position: "top-right", notch_color: "light" });
  l.dual_screen_modes = { primary_modes: [l.modes[0]], secondary_modes: [l.modes[1]] };
  assert.deepEqual(checkLayout(l), []);
});

test("catches the documented rule breaks", () => {
  const cases = {
    "bad name": (l) => { l.name = "my layout"; },
    "no modes": (l) => { l.modes = []; },
    "non-square grid": (l) => { l.modes[1].grid_size = [4, 3]; },
    "grid over 10": (l) => { l.modes[1].grid_size = [11, 11]; },
    "slots ≠ max_slots": (l) => { l.modes[1].constraints.max_slots = 12; },
    "min > max": (l) => { l.modes[1].constraints.min_slots = 14; },
    "over 26": (l) => { l.modes[1].constraints.max_slots = 27; },
    overlap: (l) => { l.modes[1].slots[1] = { start_x: 1, start_y: 1, width: 1 }; },
    "out of grid": (l) => { l.modes[1].slots[1] = { start_x: 3, start_y: 3, width: 2 }; },
    "first slot not speaker": (l) => { delete l.modes[1].slots[0].is_speaker_slot; },
    "speakers not consecutive": (l) => { l.modes[1].slots[2].is_speaker_slot = true; l.modes[1].slots[3].is_speaker_slot = true; delete l.modes[1].slots[2].is_speaker_slot; },
    padding: (l) => { l.modes[1].slot_padding = 0.2; },
    "presentation slot outside pres_modes": (l) => { l.modes[0].slots[0].is_presentation_slot = true; },
    "bad colour": (l) => { l.background_color = "white"; },
    "bad corner": (l) => { l.watermark_position = "middle"; },
  };
  for (const [label, mutate] of Object.entries(cases)) {
    const l = base();
    mutate(l);
    assert.ok(errors(l).length > 0, label);
  }
  const overlap = base();
  overlap.modes[1].slots[1] = { start_x: 1, start_y: 1, width: 1 };
  const issue = checkLayout(overlap).find((i) => /overlaps slot 1/.test(i.message));
  assert.deepEqual([issue.list, issue.mode, issue.slot], ["modes", 1, 1], "issues point at the slot");
});

test("gaps in participant counts are a warning", () => {
  const l = base();
  l.modes[1].constraints.min_slots = 5;
  const r = checkLayout(l);
  assert.equal(r.filter((i) => i.level === "error").length, 0);
  assert.match(r.map((i) => i.message).join(), /No mode covers 3 participant counts \(2, 3, 4\)/);
});

test("pickMode and slotRects", () => {
  const l = base();
  assert.equal(pickMode(l.modes, 1), l.modes[0]);
  assert.equal(pickMode(l.modes, 7), l.modes[1]);
  assert.equal(pickMode(l.modes, 40), l.modes[1], "too many: the biggest mode");
  const rects = slotRects({ ...l.modes[1], slot_padding: 0 });
  assert.deepEqual(rects[0], { index: 0, x: 480, y: 270, w: 960, h: 540, speaker: true, presentation: false });
  assert.equal(rects.length, 13);
  const padded = slotRects(l.modes[1])[0];
  assert.ok(padded.x > 480 && padded.w < 960, "default padding applied");
});
