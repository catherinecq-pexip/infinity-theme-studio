// Browser-only image helpers: previews and "fix it for me" resizing/conversion.

const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", svg: "image/svg+xml", gif: "image/gif", webp: "image/webp", bmp: "image/bmp" };

export function mimeFor(fname) {
  return MIME[fname.split(".").pop().toLowerCase()] ?? "application/octet-stream";
}

/** Object URL for previewing bytes. Caller should revoke it when done. */
export function objectUrl(bytes, fname) {
  return URL.createObjectURL(new Blob([bytes], { type: mimeFor(fname) }));
}

function loadImage(bytes, mime) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("This browser could not read that image.")); };
    img.src = url;
  });
}

/**
 * Resize/convert an image to exactly w×h.
 * mode "cover" crops to fill (backgrounds); "contain" fits inside with transparent padding (logos).
 * type: "image/jpeg" (always RGB, flattened on white) or "image/png".
 */
export async function fitImage(bytes, sourceName, { w: fw, h: fh, mode, type }) {
  const img = await loadImage(bytes, mimeFor(sourceName));
  // No target size given: keep the image's own size (format/colour conversion only).
  const w = fw ?? img.naturalWidth;
  const h = fh ?? img.naturalHeight;
  const iw = img.naturalWidth || w;
  const ih = img.naturalHeight || h;
  const scale = mode === "cover" ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (type === "image/jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.92));
  if (!blob) throw new Error("Could not convert the image.");
  return new Uint8Array(await blob.arrayBuffer());
}
