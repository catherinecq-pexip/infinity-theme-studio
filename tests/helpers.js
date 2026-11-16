// Shared test helpers: build minimal files without any image/audio libraries.

import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { encodeWav } from "../site/js/audio.js";
import { newTheme } from "../site/js/package.js";

const require = createRequire(import.meta.url);
globalThis.JSZip = require("../site/vendor/jszip.min.js");

export const PROFILES_DIR = fileURLToPath(new URL("../site/profiles/", import.meta.url));

export function loadProfiles() {
  return readdirSync(PROFILES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ name: f.replace(/\.json$/, ""), data: JSON.parse(readFileSync(PROFILES_DIR + f, "utf8")) }));
}

const enc = new TextEncoder();
export const bytes = (s) => enc.encode(s);

export function cfg(extra = {}) {
  return bytes(JSON.stringify({ theme_version: 2, ...extra }));
}

export function theme(files) {
  return newTheme("t", files);
}

export function messages(report) {
  return report.issues.map((i) => `[${i.level}] ${i.file}: ${i.message}`).join("\n");
}

/** A WAV with arbitrary format fields (sample data is silence). */
export function wavBytes({ channels = 1, bits = 16, rate = 48000, frames = 480, format = 1 } = {}) {
  if (channels === 1 && bits === 16 && format === 1) {
    const w = encodeWav(new Float32Array(frames), rate);
    return w;
  }
  const blockAlign = channels * (bits / 8);
  const dataLength = frames * blockAlign;
  const buf = new ArrayBuffer(44 + dataLength);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); v.setUint32(4, 36 + dataLength, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, format, true);
  v.setUint16(22, channels, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * blockAlign, true); v.setUint16(32, blockAlign, true); v.setUint16(34, bits, true);
  str(36, "data"); v.setUint32(40, dataLength, true);
  return new Uint8Array(buf);
}

/** Minimal PNG header (signature + IHDR) — enough for header-based checks. */
export function pngBytes(width = 200, height = 100, colorType = 6) {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(b.buffer);
  v.setUint32(16, width);
  v.setUint32(20, height);
  b[24] = 8;
  b[25] = colorType;
  return b;
}

/** Minimal JPEG (SOI + APP0 + SOF0 + EOI) with the given size and component count. */
export function jpgBytes(width = 1920, height = 1080, components = 3) {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const sofLen = 8 + components * 3;
  const sof = [0xff, 0xc0, sofLen >> 8, sofLen & 0xff, 8, height >> 8, height & 0xff, width >> 8, width & 0xff, components];
  for (let c = 0; c < components; c++) sof.push(c + 1, 0x11, 0);
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof, 0xff, 0xd9]);
}
