// Lightweight file-format inspection (no browser APIs, so it is testable in Node).
//
// Replaces Pillow (image size/mode), Python's `wave` module and the XML parser
// used by the original Python tool.

/** Identify common file types from their magic bytes. */
export function sniffFormat(b) {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "PNG";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "JPEG";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "GIF";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "WEBP";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WAVE") return "WAV";
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return "BMP";
  return null;
}

function ascii(b, off, len) {
  return String.fromCharCode(...b.subarray(off, off + len));
}

const be16 = (b, o) => (b[o] << 8) | b[o + 1];
const be32 = (b, o) => ((b[o] << 24) >>> 0) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
const le16 = (b, o) => b[o] | (b[o + 1] << 8);
const le32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + ((b[o + 3] << 24) >>> 0);

const PNG_MODES = { 0: "L", 2: "RGB", 3: "P", 4: "LA", 6: "RGBA" };

/** PNG header: { width, height, mode } or throws. */
export function pngInfo(b) {
  if (sniffFormat(b) !== "PNG" || b.length < 26 || ascii(b, 12, 4) !== "IHDR") {
    throw new Error("not a valid PNG file");
  }
  return { width: be32(b, 16), height: be32(b, 20), mode: PNG_MODES[b[25]] ?? `type ${b[25]}` };
}

const JPEG_MODES = { 1: "L", 3: "RGB", 4: "CMYK" };

/** JPEG header: { width, height, mode, progressive } or throws. */
export function jpegInfo(b) {
  if (sniffFormat(b) !== "JPEG") throw new Error("not a valid JPEG file");
  let o = 2;
  while (o + 4 <= b.length) {
    if (b[o] !== 0xff) throw new Error("corrupt JPEG marker");
    const marker = b[o + 1];
    if (marker === 0xff) { o += 1; continue; } // fill byte
    if (marker === 0xd9 || marker === 0xda) break; // end of image / start of scan
    const len = be16(b, o + 2);
    const isSOF = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isSOF) {
      if (o + 10 > b.length) break;
      const comps = b[o + 9];
      return {
        height: be16(b, o + 5),
        width: be16(b, o + 7),
        mode: JPEG_MODES[comps] ?? `${comps} components`,
        progressive: marker === 0xc2,
      };
    }
    o += 2 + len;
  }
  throw new Error("JPEG has no frame header (truncated file?)");
}

/** WAV header: { format, channels, sampleRate, bitsPerSample, dataOffset, dataLength } or throws. */
export function wavInfo(b) {
  if (b.length < 12 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WAVE") {
    throw new Error("file does not start with RIFF/WAVE id");
  }
  let o = 12;
  let fmt = null;
  while (o + 8 <= b.length) {
    const id = ascii(b, o, 4);
    const size = le32(b, o + 4);
    const body = o + 8;
    if (id === "fmt ") {
      if (size < 16 || body + 16 > b.length) throw new Error("fmt chunk too short");
      let format = le16(b, body);
      if (format === 0xfffe && size >= 40) format = le16(b, body + 24); // WAVE_FORMAT_EXTENSIBLE
      fmt = {
        format,
        channels: le16(b, body + 2),
        sampleRate: le32(b, body + 4),
        bitsPerSample: le16(b, body + 14),
      };
    } else if (id === "data") {
      if (!fmt) throw new Error("data chunk before fmt chunk");
      return { ...fmt, dataOffset: body, dataLength: Math.min(size, b.length - body) };
    }
    o = body + size + (size % 2);
  }
  throw new Error(fmt ? "missing data chunk" : "missing fmt chunk");
}

/**
 * Minimal XML well-formedness check. Returns { root, elements } or throws.
 * root: local name of the document element; elements: [{ tag, attrs: {name: value} }].
 */
export function parseXml(text) {
  const src = text
    .replace(/^\uFEFF/, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>/i, "");
  const tagRe = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[^\s=\/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  const attrRe = /([^\s=\/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  const stack = [];
  const elements = [];
  let root = null;
  let last = 0;
  let m;
  while ((m = tagRe.exec(src))) {
    if (src.slice(last, m.index).includes("<")) throw new Error(`malformed tag near character ${last}`);
    last = tagRe.lastIndex;
    const [, closing, name, attrText, selfClosing] = m;
    const local = name.split(":").pop();
    if (closing) {
      const open = stack.pop();
      if (open !== name) throw new Error(`mismatched tag </${name}>` + (open ? ` (expected </${open}>)` : ""));
      continue;
    }
    if (!root) root = local;
    else if (!stack.length) throw new Error("junk after document element");
    const attrs = {};
    for (const a of attrText.matchAll(attrRe)) attrs[a[1]] = a[2] ?? a[3];
    elements.push({ tag: local, attrs });
    if (!selfClosing) stack.push(name);
  }
  if (src.slice(last).includes("<")) throw new Error("malformed or unclosed tag");
  if (!root) throw new Error("no element found");
  if (stack.length) throw new Error(`unclosed tag <${stack[stack.length - 1]}>`);
  return { root, elements };
}
