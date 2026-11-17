// Validation rules (ported from the original Python test suite).

import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "../site/js/validate.js";
import { bytes, cfg, jpgBytes, messages, pngBytes, theme, wavBytes } from "./helpers.js";

const v = (files) => validate(theme(files));

test("minimal theme is valid", () => {
  const r = v({ "themeconfig.json": cfg() });
  assert.ok(r.ok, messages(r));
});

test("missing config and theme_version", () => {
  assert.equal(v({ "watermark_icon.png": bytes("x") }).ok, false);
  const r = v({ "themeconfig.json": bytes("{}") });
  assert.match(messages(r), /theme_version/);
});

test("empty theme", () => {
  assert.equal(v({}).ok, false);
});

test("bad JSON reports position", () => {
  const r = v({ "themeconfig.json": bytes('{"theme_version": 2,}') });
  assert.equal(r.ok, false);
  assert.match(messages(r), /line 1/);
});

test("BOM is a warning, not an error", () => {
  const r = v({ "themeconfig.json": bytes('\uFEFF{"theme_version": 2}') });
  assert.ok(r.ok, messages(r));
  assert.equal(r.warnings.length, 1);
});

test("unknown key is a warning", () => {
  const r = v({ "themeconfig.json": cfg({ disable_watermark_icn: true }) });
  assert.ok(r.ok);
  assert.equal(r.warnings.length, 1);
});

test("types and lengths", () => {
  const r = v({ "themeconfig.json": cfg({
    disable_watermark_icon: "yes",
    conference_locked_indicator_text: "x".repeat(21),
    text_color: "red",
  }) });
  assert.equal(r.errors.length, 3, messages(r));
});

test("avatar colours accept # notation", () => {
  const r = v({ "themeconfig.json": cfg({ avatar_in_mix_text_color: "#ffffff", avatar_in_mix_shape_color: "0x112233" }) });
  assert.ok(r.ok, messages(r));
});

test("dtmf", () => {
  const r = v({ "themeconfig.json": cfg({ dtmf_conference_control_commands: {
    "*6": "toggle_self_mute", "123": "toggle_lock", "*8": "dance" } }) });
  assert.equal(r.errors.length, 2, messages(r));
});

test("dtmf self-mute moved warns about mute icon", () => {
  const r = v({ "themeconfig.json": cfg({ dtmf_conference_control_commands: { "*5": "toggle_self_mute" } }) });
  assert.ok(r.ok);
  assert.match(messages(r), /watermark_mute_icon/);
});

test("classification", () => {
  const good = { levels: { 0: "Internal", 1: { text: "Secret", bgcolor: "0xff0000" } }, default: 1 };
  assert.ok(v({ "themeconfig.json": cfg({ classification: good }) }).ok);
  const bad = { levels: { a: "x", 1: { bgcolor: "red" } }, default: 5 };
  const r = v({ "themeconfig.json": cfg({ classification: bad }) });
  assert.ok(r.errors.length >= 3, messages(r));
});

test("clock", () => {
  const ok = [{ type: "elapsed" }, { type: "remaining", starting_value: 600 },
    { type: "time", timezone: "Europe/London", date: "dd/mm/yyyy" }];
  for (const c of ok) {
    const r = v({ "themeconfig.json": cfg({ clock_data: c }) });
    assert.ok(r.ok, messages(r));
  }
  const bad = [{ type: "stopwatch" }, { type: "remaining" }, { type: "time", timezone: "Mars/Base" }];
  for (const c of bad) assert.equal(v({ "themeconfig.json": cfg({ clock_data: c }) }).ok, false, JSON.stringify(c));
});

test("indicator colours require all keys", () => {
  const r = v({ "themeconfig.json": cfg({ indicator_color_config: {
    recording: { background: "0x33D73332", text: "0xFFFFFFFF" } } }) });
  assert.equal(r.ok, false);
});

test("splash screens", () => {
  const ss = { labels: { my_label: "Hello" },
    screens: { welcome: { background: { path: "background_welcome.jpg" },
      elements: [{ type: "text", label: "my_label", font: "Inter" }, { type: "icon", path: "icon_welcome.svg" }] } } };
  let r = v({ "themeconfig.json": cfg({ splash_screens: ss }) });
  assert.match(messages(r), /background_welcome\.jpg/); // referenced but not in ZIP
  ss.screens.welcome.elements[0].font = "Comic Sans";
  ss.screens.welcome.background = { color: "0x323232" };
  r = v({ "themeconfig.json": cfg({ splash_screens: ss }) });
  assert.equal(r.errors.length, 1, messages(r));
});

test("audio", () => {
  const name = "conf-getpin_48kHz_mono.wav";
  assert.ok(v({ "themeconfig.json": cfg(), [name]: wavBytes() }).ok);
  for (const bad of [wavBytes({ channels: 2 }), wavBytes({ rate: 44100 }), wavBytes({ bits: 8 }), wavBytes({ format: 3, bits: 32 }), bytes("not audio")]) {
    assert.equal(v({ "themeconfig.json": cfg(), [name]: bad }).ok, false);
  }
  const r = v({ "themeconfig.json": cfg(), "hello.wav": wavBytes() });
  assert.ok(r.ok);
  assert.match(messages(r), /will not replace/);
});

test("images", () => {
  const ok = v({ "themeconfig.json": cfg(), "background.jpg": jpgBytes(), "watermark_icon.png": pngBytes() });
  assert.ok(ok.ok, messages(ok));
  for (const files of [{ "background.jpg": jpgBytes(1280, 720) },
    { "background.jpg": jpgBytes(1920, 1080, 1) },
    { "background.jpg": jpgBytes(1920, 1080, 4) },
    { "background.jpg": pngBytes() },
    { "background.jpg": bytes("garbage") }]) {
    files["themeconfig.json"] = cfg();
    assert.equal(v(files).ok, false, Object.keys(files).join());
  }
  // Wrong-size watermark and avatar background are only warnings.
  const w = v({ "themeconfig.json": cfg(), "watermark_icon.png": pngBytes(400, 200), "background_avatar_in_mix.jpg": jpgBytes(800, 600) });
  assert.ok(w.ok, messages(w));
  assert.equal(w.warnings.length, 2, messages(w));
});

test("svg", () => {
  const good = bytes('<?xml version="1.0"?><!-- c --><svg xmlns="http://www.w3.org/2000/svg"><g><path d="M0 0L1 1"/></g></svg>');
  assert.ok(v({ "themeconfig.json": cfg(), "icon_x.svg": good }).ok);
  assert.equal(v({ "themeconfig.json": cfg(), "icon_x.svg": bytes("<svg") }).ok, false);
  assert.equal(v({ "themeconfig.json": cfg(), "icon_x.svg": bytes("<svg><g></svg>") }).ok, false);
  assert.equal(v({ "themeconfig.json": cfg(), "icon_x.svg": bytes("<html></html>") }).ok, false);
  const bitmap = v({ "themeconfig.json": cfg(), "icon_x.svg": bytes('<svg xmlns:xlink="x"><image xlink:href="a.png"/></svg>') });
  assert.ok(bitmap.ok);
  assert.match(messages(bitmap), /bitmap/);
});

test("custom layout", () => {
  const layout = bytes(JSON.stringify({ name: "my layout", modes: [] }));
  const r = v({ "themeconfig.json": cfg(), "custom_layout_x.json": layout });
  assert.equal(r.errors.length, 2, messages(r));
});

test("custom layouts count as known for dtmf_allowed_layouts", () => {
  const layout = bytes(JSON.stringify({ name: "mine", modes: [{ grid_size: [1, 1], constraints: { min_slots: 1, max_slots: 1 }, slots: [{ start_x: 0, start_y: 0, width: 1, is_speaker_slot: true }] }] }));
  const r = v({ "themeconfig.json": cfg({ dtmf_allowed_layouts: ["mine", "2x2"] }), "custom_layout_x.json": layout });
  assert.ok(r.ok, messages(r));
  assert.ok(!messages(r).includes("dtmf_allowed_layouts"), messages(r));
});

test("presence avatar and PowerPoint Live placeholder", () => {
  assert.ok(v({ "themeconfig.json": cfg(), "presence_avatar_image.jpg": jpgBytes(128, 128) }).issues.length === 0);
  const r = v({ "themeconfig.json": cfg(), "presence_avatar_image.jpg": jpgBytes(300, 300), "no_powerpoint_live.jpg": jpgBytes(1280, 720) });
  assert.ok(r.ok, messages(r));
  assert.match(messages(r), /Presence avatar should be 128x128/);
  assert.match(messages(r), /PowerPoint Live placeholder should be 1920x1080/);
  assert.equal(r.warnings.length, 2, messages(r));
  assert.equal(v({ "themeconfig.json": cfg(), "no_powerpoint_live.jpg": jpgBytes(1920, 1080) }).issues.length, 0);
  assert.equal(v({ "themeconfig.json": cfg(), "presence_avatar_image.jpg": jpgBytes(128, 128, 4) }).ok, false, "CMYK rejected");
});

test("fonts given as CSS-style lists (as in Pexip's defaults)", () => {
  const screen = (font) => ({ splash_screens: { screens: { welcome: { elements: [{ type: "text", label: "welcome", font }] } } } });
  assert.ok(v({ "themeconfig.json": cfg(screen("inter medium,noto-sans,sans")) }).ok);
  assert.ok(v({ "themeconfig.json": cfg(screen("Roboto Condensed")) }).ok);
  assert.equal(v({ "themeconfig.json": cfg(screen("Comic Sans, sans")) }).ok, false);
});

test("custom layout deep checks (overlaps, built-in name clash)", () => {
  const slot = (x, y, w, sp) => ({ start_x: x, start_y: y, width: w, ...(sp ? { is_speaker_slot: true } : {}) });
  const bad = { name: "mine", modes: [{ grid_size: [2, 2], constraints: { min_slots: 1, max_slots: 2 }, slots: [slot(0, 0, 2, true), slot(1, 1, 1)] }] };
  const r = v({ "themeconfig.json": cfg(), "custom_layout_x.json": bytes(JSON.stringify(bad)) });
  assert.match(messages(r), /overlaps slot 1/);
  const clash = { ...bad, name: "one_main_twelve_around", modes: [{ grid_size: [1, 1], constraints: { min_slots: 1, max_slots: 1 }, slots: [slot(0, 0, 1, true)] }] };
  const c = v({ "themeconfig.json": cfg(), "custom_layout_x.json": bytes(JSON.stringify(clash)) });
  assert.ok(c.ok, messages(c));
  assert.match(messages(c), /built into Infinity/);
});
