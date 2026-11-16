// Targeting older Infinity versions.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as rules from "../site/js/rules.js";
import { buildTheme, Edits } from "../site/js/build.js";
import { validate } from "../site/js/validate.js";
import { cfg, loadProfiles, messages, theme, wavBytes } from "./helpers.js";

const allIndicators = () => Object.fromEntries([...rules.INDICATOR_TYPES].map((t) => [t, { background: "0xCCB762B4", border: "0xB762B4", text: "0xFFFFFF" }]));

test("version table only names things the rules know", () => {
  const known = {
    setting: rules.KNOWN_TOP_LEVEL, indicator: rules.INDICATOR_TYPES,
    audio: rules.BASE_AUDIO_FILES, dtmf: rules.DTMF_COMMANDS,
  };
  for (const [kind, table] of Object.entries(rules.MIN_VERSION)) {
    for (const [name, v] of Object.entries(table)) {
      assert.ok(known[kind].has(name), `${kind} ${name} is not in rules.js`);
      assert.ok(v > Math.min(...rules.SUPPORTED_VERSIONS) - 1 && v <= rules.LATEST_VERSION, `${name}: ${v}`);
    }
  }
  assert.equal(rules.SUPPORTED_VERSIONS[0], rules.LATEST_VERSION);
});

test("v41 rejects the external media processing indicator colour (field report)", () => {
  const t = theme({ "themeconfig.json": cfg({ indicator_color_config: allIndicators() }) });
  assert.ok(validate(t).ok, "fine on the latest version");
  const r = validate(t, { version: 41 });
  assert.match(messages(r), /indicator_color_config\.external_media_proc needs Infinity v42/);
  assert.match(messages(r), /gms_smart_notes/);
  assert.equal(r.errors.length, 2, messages(r));
});

test("validator flags newer settings, keypad commands and prompts", () => {
  const t = theme({
    "themeconfig.json": cfg({ clock_data: { type: "elapsed" }, enable_avatars_in_mix: true, dtmf_conference_control_commands: { "*9": "cycle_personal_layout" } }),
    "call_about_to_be_transferred.wav": wavBytes(),
  });
  assert.equal(validate(t, { version: 41 }).errors.length, 2, "clock + breakout prompt");
  assert.equal(validate(t, { version: 39 }).errors.length, 3, "+ avatars");
  assert.equal(validate(t, { version: 38 }).errors.length, 3, "cycle_personal_layout is fine on 38");
});

test("brand colours on every indicator build cleanly for v41", () => {
  const edits = new Edits();
  for (const [type, c] of Object.entries(allIndicators())) edits.replace(["indicator_color_config", type], c);
  const { theme: t, config, log } = buildTheme({ name: "event-room", edits, version: 41 });
  assert.ok(!("external_media_proc" in config.indicator_color_config));
  assert.ok(!("gms_smart_notes" in config.indicator_color_config));
  assert.ok("recording" in config.indicator_color_config);
  assert.ok(log.some((l) => l.includes("Left out indicator_color_config.external_media_proc")));
  const r = validate(t, { version: 41 });
  assert.ok(r.ok, messages(r));
});

test("every profile builds a valid theme for every supported version", () => {
  for (const version of rules.SUPPORTED_VERSIONS) {
    for (const p of loadProfiles()) {
      const { theme: t } = buildTheme({ name: p.name, profiles: [p], version });
      const r = validate(t, { version });
      assert.ok(r.ok, `${p.name} v${version}: ${messages(r)}`);
    }
  }
});

test("event profile on v41 drops the clock and keeps the rest", () => {
  const event = loadProfiles().find((p) => p.name === "event");
  const { config, log } = buildTheme({ name: "e", profiles: [event], version: 41 });
  assert.ok(!("clock_data" in config));
  assert.equal(config.streaming_indicator_text, "Live broadcast");
  assert.ok(log.some((l) => l === "Left out clock_data (needs Infinity v42)"));
});

test("unsupported prompts and keypad commands are left out of the build", () => {
  const edits = new Edits();
  edits.replace(["dtmf_conference_control_commands"], { "*6": "toggle_self_mute", "*9": "cycle_personal_layout" });
  const { theme: t, config } = buildTheme({
    name: "x", edits, version: 38,
    files: { "conf-smart_notes_started_48kHz_mono.wav": wavBytes(), "conf-getpin_48kHz_mono.wav": wavBytes() },
  });
  assert.deepEqual(config.dtmf_conference_control_commands, { "*6": "toggle_self_mute", "*9": "cycle_personal_layout" });
  assert.ok(!("conf-smart_notes_started_48kHz_mono.wav" in t.files));
  assert.ok("conf-getpin_48kHz_mono.wav" in t.files);
});
