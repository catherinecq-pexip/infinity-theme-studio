// Indicator (notch) icons.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as rules from "../site/js/rules.js";
import { checkNotchSvg, isDarkColour, makeDarkVariant, notchFile, parseNotchFile } from "../site/js/icons.js";
import { validate } from "../site/js/validate.js";
import { bytes, cfg, messages, theme } from "./helpers.js";

const DEFAULTS = fileURLToPath(new URL("../site/defaults/notch/", import.meta.url));
const colours = (svg) => [...new Set([...svg.matchAll(/(?:fill|stroke)="([^"]*)"/g)].map((m) => m[1].toLowerCase().replace("#ffffff", "white")))].sort();

test("bundled default icons match the rules (14 icons x light/dark)", () => {
  assert.deepEqual(new Set(readdirSync(DEFAULTS)), rules.NOTCH_ICON_FILES);
  assert.equal(rules.NOTCH_ICON_FILES.size, 28);
  assert.equal(notchFile("recording"), "icon_notch57tp_recording.svg");
  assert.equal(notchFile("recording", true), "icon_notch57tp_recording_dark.svg");
  assert.deepEqual(parseNotchFile("icon_notch57tp_conference_locked_dark.svg"), { item: "conference_locked", dark: true });
  assert.equal(parseNotchFile("icon_welcome.svg"), null);
});

test("makeDarkVariant reproduces Pexip's own white icons", () => {
  for (const item of rules.NOTCH_ICONS) {
    const black = readFileSync(DEFAULTS + notchFile(item), "utf8");
    const white = readFileSync(DEFAULTS + notchFile(item, true), "utf8");
    const { svg, recoloured } = makeDarkVariant(black);
    assert.deepEqual(colours(svg), colours(white), item);
    assert.equal(recoloured, !["recording", "transcribing"].includes(item), `${item}: red icons stay red`);
    assert.deepEqual(checkNotchSvg(svg), [], `${item} passes the icon checks`);
  }
});

test("makeDarkVariant handles style attributes, currentColor and colourless icons", () => {
  const styled = makeDarkVariant('<svg viewBox="0 0 24 24"><path style="fill:#212121;stroke:none" d="M0 0"/></svg>');
  assert.equal(styled.recoloured, true);
  assert.match(styled.svg, /fill:white;stroke:none/);
  assert.match(makeDarkVariant('<svg><path fill="currentColor" d="M0 0"/></svg>').svg, /fill="white"/);
  const bare = makeDarkVariant('<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>');
  assert.equal(bare.recoloured, true);
  assert.match(bare.svg, /^<svg fill="white"/);
  const multi = makeDarkVariant('<svg><path fill="#000" d="M0"/><path fill="#2f6fde" d="M1"/></svg>');
  assert.equal(multi.recoloured, false, "multi-colour artwork is left alone");
  assert.ok(isDarkColour("#333") && isDarkColour("black") && !isDarkColour("#D73332") && !isDarkColour("#ffffff"));
});

test("checkNotchSvg", () => {
  assert.deepEqual(checkNotchSvg('<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>'), []);
  assert.match(checkNotchSvg('<svg><path d="M0 0"/></svg>')[0].message, /viewBox/);
  assert.match(checkNotchSvg('<svg viewBox="0 0 1 1"><image href="a.png"/></svg>')[0].message, /bitmap/);
  assert.equal(checkNotchSvg('<svg viewBox="0 0 1 1"><script>x</script></svg>')[0].level, "error");
  assert.equal(checkNotchSvg("<html></html>")[0].level, "error");
  assert.equal(checkNotchSvg("not xml <")[0].level, "error");
});

test("validator: notch icon names, viewBox and empty indicator text", () => {
  const good = bytes('<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>');
  assert.equal(validate(theme({ "themeconfig.json": cfg(), "icon_notch57tp_recording.svg": good })).issues.length, 0);
  const r = validate(theme({
    "themeconfig.json": cfg({ recording_indicator_text: "" }),
    "icon_notch57tp_foo.svg": good,
    "icon_notch57tp_ai.svg": bytes('<svg><path d="M0 0"/></svg>'),
  }));
  assert.ok(r.ok, messages(r));
  assert.match(messages(r), /icon_notch57tp_foo\.svg: Not one of Infinity's indicator icon names/);
  assert.match(messages(r), /icon_notch57tp_ai\.svg: Indicator icon has no viewBox/);
  assert.match(messages(r), /"recording_indicator_text" is empty \("icon only"\)/);
});
