// Splash screen previews: layout maths and defaults.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as rules from "../site/js/rules.js";
import * as catalog from "../site/js/catalog.js";
import { argbToCss, effectiveScreens, fillPlaceholders, layoutScreen, screenBackground, screenIcons, screenLabels } from "../site/js/splash.js";
import { validate } from "../site/js/validate.js";
import { bytes, messages, theme } from "./helpers.js";

const DEFAULTS = JSON.parse(readFileSync(new URL("../site/defaults/theme_screen_defaults_v41.json", import.meta.url), "utf8").replace(/^\uFEFF/, ""));
const screens = DEFAULTS.splash_screens.screens;

test("defaults file covers every splash screen and matches the default wording", () => {
  assert.deepEqual(new Set(Object.keys(screens)), rules.SPLASH_SCREENS);
  assert.deepEqual(DEFAULTS.splash_screens.labels, catalog.DEFAULT_LABEL_TEXT);
});

test("Pexip's own screen defaults pass validation", () => {
  const r = validate(theme({ "themeconfig.json": bytes(JSON.stringify({ theme_version: 2, splash_screens: DEFAULTS.splash_screens })) }));
  assert.equal(r.issues.length, 0, messages(r));
});

test("vertical layout stacks elements (welcome)", () => {
  const [icon, text] = layoutScreen(screens.welcome, DEFAULTS.splash_screens.labels);
  assert.deepEqual([icon.kind, icon.x, icon.y, icon.w, icon.h, icon.path], ["icon", 0, 300, 1920, 300, "icon_welcome.svg"]);
  assert.deepEqual([text.kind, text.y, text.h, text.text], ["text", 650, 200, "Welcome"]);
  assert.equal(text.style.fontSize, 60);
  assert.equal(text.style.lineHeight, 55);
  assert.equal(text.style.color, "rgba(255, 255, 255, 1)");
});

test("vertical layout centres narrower boxes and applies offset_x", () => {
  const [box] = layoutScreen({ elements: [{ type: "icon", path: "icon_x.svg", width: 500, height: 100, offset_x: 40, offset_y: 10 }] });
  assert.deepEqual([box.x, box.y], [(1920 - 500) / 2 + 40, 10]);
});

test("free_form layout uses absolute positions (test_call_welcome)", () => {
  const boxes = layoutScreen(screens.test_call_welcome, DEFAULTS.splash_screens.labels);
  const header = boxes.find((b) => b.label === "test_call_welcome_header");
  assert.deepEqual([header.x, header.y, header.style.align, header.text], [314, 254, "left", "Live Test"]);
  const icon = boxes.find((b) => b.path === "icon_test_call_welcome.svg");
  assert.deepEqual([icon.x, icon.y, icon.w, icon.h], [1113, 339, 517, 411]);
});

test("pin digits, placeholders and backgrounds", () => {
  const digits = layoutScreen(screens.pin_entry).find((b) => b.kind === "digits");
  assert.deepEqual([digits.count, digits.digitW, digits.spacing, digits.path], [4, 42, 10, "icon_pin_entry_digit.svg"]);
  assert.equal(fillPlaceholders("{conference_name} / {conference_id} / {unknown}"), "Board Room / 1234 / {unknown}");
  assert.deepEqual(screenBackground(screens.welcome), { path: "background.jpg" });
  assert.deepEqual(screenBackground(screens.no_main_video), { color: "rgba(50, 50, 50, 1)" });
  const numeric = Object.values(screens).find((s) => typeof s.background?.color === "number");
  assert.deepEqual(screenBackground(numeric), { color: "rgba(0, 0, 0, 1)" }, "4278190080 = 0xFF000000");
  assert.equal(argbToCss("0x7f323232"), "rgba(50, 50, 50, 0.498)");
  assert.equal(argbToCss("nonsense", "x"), "x");
});

test("theme screens replace defaults; labels merge", () => {
  const config = { splash_screens: { labels: { welcome: "Hi" }, screens: { welcome: { layout_type: "free_form", elements: [] } } } };
  const eff = effectiveScreens(config, DEFAULTS);
  assert.deepEqual(eff.screens.welcome, { layout_type: "free_form", elements: [] });
  assert.equal(eff.screens.connecting, screens.connecting);
  assert.equal(eff.labels.welcome, "Hi");
  assert.equal(eff.labels.connecting, "Connecting...");
  assert.deepEqual(screenLabels(screens.test_call_welcome), ["test_call_welcome_header", "test_call_welcome_text"]);
  assert.deepEqual(screenIcons(screens.pin_entry), ["icon_pin_entry.svg", "icon_pin_entry_digit.svg"]);
});

test("every screen is in exactly one gallery group", () => {
  const all = catalog.SCREEN_GROUPS.flatMap((g) => g.screens);
  assert.equal(all.length, new Set(all).size, "duplicate screen");
  assert.deepEqual(new Set(all), rules.SPLASH_SCREENS);
  for (const s of all) assert.ok(catalog.SCREEN_NAMES[s], `${s} needs a name`);
});
