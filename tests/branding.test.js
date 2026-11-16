// Branding portal exports (Web App 3 branding packages) on the Start step.

import { test } from "node:test";
import assert from "node:assert/strict";
import { inspectZip, NOT_RECOGNISED, slug } from "../site/js/branding.js";
import { cfg, jpgBytes, pngBytes } from "./helpers.js";

const zipOf = async (files) => {
  const zip = new globalThis.JSZip();
  for (const [name, data] of Object.entries(files)) zip.file(name, data);
  return zip.generateAsync({ type: "uint8array" });
};

const MANIFEST = {
  version: 0,
  meta: { name: "DEFAULT", brandVersion: "n/a", baseColor: "#b762b4" },
  brandName: "Event Room",
  images: { logo: "./Screenshot 2026-11-16 131223.png", jumbotron: "./jumbo.jpg", background: "./bg.jpg" },
  colorPalette: ["#F7EEF7", "#E9CEE8", "#DAAFD9", "#CC8FCB", "#BD70BC", "#AF50AD", "#934391", "#773776", "#5B2A5A", "#3F1D3E", "#231023"],
  backgroundColor: "#ffffff",
  overlayOpacity: 0.5,
  overlay: "dark",
};

test("reads a branding portal export (brand.zip layout)", async () => {
  const bytes = await zipOf({
    "webapp3/branding/manifest.json": JSON.stringify(MANIFEST),
    "webapp3/branding/Screenshot 2026-11-16 131223.png": pngBytes(640, 200),
    "webapp3/branding/bg.jpg": jpgBytes(2400, 1600),
    "webapp3/branding/jumbo.jpg": jpgBytes(),
  });
  const { theme, branding } = await inspectZip(bytes, "brand");
  assert.equal(theme, null);
  assert.equal(branding.brandName, "Event Room");
  assert.equal(branding.baseColor, "#b762b4");
  assert.equal(branding.palette.length, 11);
  assert.equal(branding.folder, "webapp3/branding/");
  assert.equal(branding.images.logo.name, "Screenshot 2026-11-16 131223.png");
  assert.ok(branding.images.background.bytes.length > 0);
  assert.ok(branding.images.jumbotron);
});

test("ignores plugins, .DS_Store and plugin PWA manifests (multi-plugin layout)", async () => {
  const manifest = { ...MANIFEST, brandName: "DVZ - MV", images: { logo: "./dvz.png", background: "./missing.jpg" },
    plugins: [{ src: "./polling-plugin/index.html" }, { src: "./reactions-plugin/index.html" }] };
  const bytes = await zipOf({
    "webapp3/branding/polling-plugin/manifest.json": JSON.stringify({ short_name: "Poll", icons: [] }),
    "webapp3/branding/manifest.json": JSON.stringify(manifest),
    "webapp3/branding/.DS_Store": "junk",
    "webapp3/branding/dvz.png": pngBytes(),
    "webapp3/branding/polling-plugin/index.html": "<html></html>",
    "__MACOSX/webapp3/branding/._manifest.json": "junk",
  });
  const { branding } = await inspectZip(bytes, "x");
  assert.equal(branding.brandName, "DVZ - MV");
  assert.equal(branding.plugins, 2);
  assert.ok(branding.images.logo);
  assert.equal(branding.images.background, null, "missing image files are skipped");
});

test("theme and branding in one ZIP", async () => {
  const bytes = await zipOf({
    "theme/themeconfig.json": cfg({ text_color: "0x112233" }),
    "webapp3/branding/manifest.json": JSON.stringify(MANIFEST),
  });
  const { theme, branding } = await inspectZip(bytes, "both");
  assert.deepEqual(Object.keys(theme.theme.files), ["themeconfig.json"]);
  assert.equal(branding.brandName, "Event Room");
});

test("plain theme ZIPs still work", async () => {
  const { theme, branding } = await inspectZip(await zipOf({ "secure/themeconfig.json": cfg() }), "secure");
  assert.equal(branding, null);
  assert.ok("themeconfig.json" in theme.theme.files);
});

test("unrelated ZIPs get a friendly error", async () => {
  await assert.rejects(inspectZip(await zipOf({ "a/b/readme.txt": "hi", "c.txt": "x" }), "x"), (err) => err.message === NOT_RECOGNISED);
  await assert.rejects(inspectZip(new Uint8Array([1, 2, 3]), "x"), /Not a valid ZIP/);
});

test("slug", () => {
  assert.equal(slug("Event Room"), "event-room");
  assert.equal(slug("DVZ - MV Démo!"), "dvz-mv-demo");
  assert.equal(slug(""), "");
});
