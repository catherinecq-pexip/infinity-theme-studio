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

test("Pexip's Base assets are bundled for every file the default screens use", async () => {
  const { readdirSync } = await import("node:fs");
  const base = new URL("../site/defaults/base/", import.meta.url);
  const bundled = new Set(readdirSync(base));
  for (const spec of Object.values(screens)) {
    const bg = screenBackground(spec);
    if (bg.path) assert.ok(bundled.has(bg.path), `${bg.path} missing from site/defaults/base`);
    for (const icon of screenIcons(spec)) assert.ok(bundled.has(icon), `${icon} missing from site/defaults/base`);
  }
  for (const slot of catalog.IMAGE_SLOTS) assert.ok(bundled.has(slot.file), `${slot.file} default missing`);
  // The bundled assets themselves pass the validator (sizes, RGB JPGs, well-formed SVGs).
  const files = Object.fromEntries([...bundled].filter((f) => f !== "themeconfig.json").map((f) => [f, new Uint8Array(readFileSync(new URL(f, base)))]));
  const r = validate(theme({ ...files, "themeconfig.json": readFileSync(new URL("themeconfig.json", base)) }));
  assert.equal(r.errors.length, 0, messages(r));
  assert.equal(r.warnings.length, 0, messages(r));
});

test("Base theme settings match the defaults shown in the portal", () => {
  const baseCfg = JSON.parse(readFileSync(new URL("../site/defaults/base/themeconfig.json", import.meta.url), "utf8").replace(/^\uFEFF/, ""));
  // The docs also list a few keys Base leaves out (e.g. disable_external_media_proc_indicator); compare what Base sets.
  for (const [key, value] of Object.entries(baseCfg)) if (key !== "theme_version") assert.deepEqual(catalog.DEFAULT_CONFIG[key], value, key);
});

test("BLANK_DEFAULT_ICONS lists exactly the empty Base splash icons", async () => {
  const { readdirSync } = await import("node:fs");
  const base = new URL("../site/defaults/base/", import.meta.url);
  const blank = readdirSync(base).filter((f) => f.endsWith(".svg"))
    .filter((f) => !/<(path|rect|circle|ellipse|line|polyline|polygon|text|use|g)\b/.test(readFileSync(new URL(f, base), "utf8")));
  assert.deepEqual(new Set(blank), catalog.BLANK_DEFAULT_ICONS);
});
