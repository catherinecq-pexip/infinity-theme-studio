// Keep the UI catalogue in sync with the rules and the profiles folder.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as rules from "../site/js/rules.js";
import * as catalog from "../site/js/catalog.js";
import { loadProfiles } from "./helpers.js";

test("every simple setting appears in the portal", () => {
  const shown = new Set();
  for (const s of catalog.GENERAL_SECTIONS) for (const f of s.fields) shown.add(f.key);
  for (const i of catalog.INDICATORS) {
    if (i.hide) shown.add(i.hide);
    for (const t of i.texts) shown.add(t.key);
  }
  shown.add("enable_dtmf_conference_control"); // Keypad section
  for (const key of [...rules.BOOLEAN_SETTINGS, ...rules.TEXT_SETTINGS, ...rules.NUMBER_SETTINGS, ...rules.COLOR_SETTINGS]) {
    assert.ok(shown.has(key), `${key} is not in catalog.js`);
  }
  for (const key of shown) assert.ok(rules.KNOWN_TOP_LEVEL.has(key), `${key} in catalog.js is not in rules.js`);
});

test("indicator colours cover every indicator type", () => {
  assert.deepEqual(new Set(catalog.INDICATORS.map((i) => i.color)), rules.INDICATOR_TYPES);
});

test("keypad commands and layouts are all labelled", () => {
  assert.deepEqual(new Set(Object.keys(catalog.DTMF_COMMAND_LABELS)), rules.DTMF_COMMANDS);
  assert.deepEqual(new Set(Object.keys(catalog.LAYOUT_LABELS)), rules.BUILTIN_LAYOUTS);
});

test("every splash screen label is described", () => {
  const labels = catalog.LABEL_GROUPS.flatMap((g) => Object.keys(g.labels));
  assert.equal(labels.length, new Set(labels).size, "duplicate label");
  assert.deepEqual(new Set(labels), rules.DEFAULT_LABELS);
});

test("every voice prompt is described", () => {
  const prompts = catalog.AUDIO_GROUPS.flatMap((g) => Object.keys(g.prompts));
  assert.equal(prompts.length, new Set(prompts).size, "duplicate prompt");
  assert.deepEqual(new Set(prompts), rules.BASE_AUDIO_FILES);
});

test("profile list matches the profiles folder", () => {
  assert.deepEqual(new Set(catalog.PROFILE_NAMES), new Set(loadProfiles().map((p) => p.name)));
});

test("Infinity's default wording is known for every splash screen label", () => {
  assert.deepEqual(new Set(Object.keys(catalog.DEFAULT_LABEL_TEXT)), rules.DEFAULT_LABELS);
  for (const [k, v] of Object.entries(catalog.DEFAULT_LABEL_TEXT)) assert.ok(typeof v === "string" && v.length, k);
});
