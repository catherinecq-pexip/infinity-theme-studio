// Packaging, merging, building and audio helpers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTheme, deepMerge, Edits } from "../site/js/build.js";
import { encodeWav, isInfinityWav, wavDuration } from "../site/js/audio.js";
import { loadConfig, loadZip, newTheme, toZip } from "../site/js/package.js";
import { validate } from "../site/js/validate.js";
import { cfg, loadProfiles, messages, wavBytes } from "./helpers.js";

test("zip round trip wraps and unwraps folder", async () => {
  const t = newTheme("secure", { "themeconfig.json": cfg() });
  const back = await loadZip(await toZip(t), "secure");
  assert.deepEqual(back.theme.files, t.files);
  const flat = await loadZip(await toZip(t, { wrapFolder: false }), "secure");
  assert.deepEqual(flat.theme.files, t.files);
});

test("zip with several folders uses the one holding themeconfig.json", async () => {
  const zip = new globalThis.JSZip();
  zip.file("export/theme/themeconfig.json", cfg());
  zip.file("export/theme/background.jpg", new Uint8Array([1]));
  zip.file("export/webapp/manifest.json", "{}");
  zip.file("__MACOSX/export/._x", "junk");
  const { theme, notes } = await loadZip(await zip.generateAsync({ type: "uint8array" }), "x");
  assert.deepEqual(Object.keys(theme.files).sort(), ["background.jpg", "themeconfig.json"]);
  assert.match(notes[0], /export\/theme\//);
});

test("zip with nested folders and no themeconfig is rejected", async () => {
  const zip = new globalThis.JSZip();
  zip.file("a/b/c.png", "x");
  zip.file("d.png", "x");
  await assert.rejects(loadZip(await zip.generateAsync({ type: "uint8array" }), "x"), /Nested folders/);
});

test("not a zip is rejected", async () => {
  await assert.rejects(loadZip(new Uint8Array([1, 2, 3]), "x"), /Not a valid ZIP/);
});

test("deep merge", () => {
  const base = { a: { b: 1, c: 2 }, l: [1] };
  assert.deepEqual(deepMerge(base, { a: { c: 3 }, l: [2], $comment: "x" }), { a: { b: 1, c: 3 }, l: [2] });
  assert.deepEqual(base, { a: { b: 1, c: 2 }, l: [1] }, "base must not be mutated");
});

test("all profiles produce valid themes", () => {
  const profiles = loadProfiles();
  assert.deepEqual(profiles.map((p) => p.name).sort(), ["client", "event", "reception", "secure", "standard"]);
  for (const p of profiles) {
    assert.ok(p.data.$title, `${p.name} needs a $title`);
    const { theme } = buildTheme({ name: p.name, profiles: [p] });
    const r = validate(theme);
    assert.ok(r.ok, `${p.name}: ${messages(r)}`);
    assert.ok(!("$title" in loadConfig(theme)));
  }
});

test("build keeps portal settings and adds audio", () => {
  const secure = loadProfiles().find((p) => p.name === "secure");
  const base = newTheme("portal", { "themeconfig.json": cfg({ text_color: "0xff0000" }) });
  const { theme, config } = buildTheme({
    name: "secure", base, profiles: [secure],
    files: { "conf-getpin_48kHz_mono.wav": wavBytes() },
  });
  assert.equal(config.text_color, "0xff0000");
  assert.ok("classification" in config);
  assert.ok(isInfinityWav(theme.files["conf-getpin_48kHz_mono.wav"]));
  assert.equal(theme.name, "secure");
});

test("edits: set, replace and remove survive profile changes", () => {
  const secure = loadProfiles().find((p) => p.name === "secure");
  const edits = new Edits();
  edits.set(["indicator_color_config", "streaming"], { background: "0x00000000", border: "0x00000000", text: "0xFFFFFFFF" });
  edits.replace(["classification"], { levels: { 0: "Public" }, default: 0 });
  edits.remove(["disable_watermark_icon"]);
  assert.equal(edits.count, 3, "count is the number of top-level settings changed");
  const { config } = buildTheme({ name: "t", profiles: [secure], edits });
  assert.deepEqual(config.classification, { levels: { 0: "Public" }, default: 0 }, "replace drops profile levels");
  assert.ok(config.indicator_color_config.recording, "set merges with profile values");
  assert.ok(config.indicator_color_config.streaming);
  assert.ok(!("disable_watermark_icon" in config));

  // A later set() on a removed path brings it back.
  edits.set(["disable_watermark_icon"], false);
  assert.equal(buildTheme({ name: "t", profiles: [secure], edits }).config.disable_watermark_icon, false);

  // Removing a nested value prunes empty parents in the edits overlay.
  edits.remove(["indicator_color_config", "streaming"]);
  assert.ok(!("streaming" in (edits.values.indicator_color_config ?? {})));
});

test("build removes and replaces files", () => {
  const base = newTheme("p", { "themeconfig.json": cfg(), "a.png": new Uint8Array([1]), "b.png": new Uint8Array([2]) });
  const { theme, log } = buildTheme({
    name: "x", base, files: { "b.png": new Uint8Array([3]) }, removedFiles: new Set(["a.png"]),
  });
  assert.deepEqual(Object.keys(theme.files).sort(), ["b.png", "themeconfig.json"]);
  assert.deepEqual([...theme.files["b.png"]], [3]);
  assert.ok(log.some((l) => l.startsWith("Removed a.png")));
  assert.equal(Object.keys(base.files).length, 3, "base theme must not be mutated");
});

test("encodeWav produces Infinity-compliant audio", () => {
  const samples = new Float32Array(48000).map((_, i) => Math.sin(i / 10));
  const wav = encodeWav(samples);
  assert.ok(isInfinityWav(wav));
  assert.equal(wavDuration(wav), 1);
  assert.equal(isInfinityWav(wavBytes({ rate: 44100 })), false);
  assert.equal(isInfinityWav(new Uint8Array(4)), false);
});
