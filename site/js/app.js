// Infinity Theme Studio — browser wizard.
//
// Everything runs locally: files are read, converted, validated and zipped in
// the browser and never uploaded anywhere.

import * as rules from "./rules.js";
import * as catalog from "./catalog.js";
import { buildTheme, Edits, getPath } from "./build.js";
import { loadConfig, toZip, utf8 } from "./package.js";
import { inspectZip, slug } from "./branding.js";
import { customLayoutNames, describeJsonError, validate } from "./validate.js";
import { AUDIO_SOURCE_EXTENSIONS, toInfinityWav, wavDuration } from "./audio.js";
import { fitImage, objectUrl } from "./imaging.js";
import { sniffFormat, jpegInfo, pngInfo } from "./formats.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

function loadVersion() {
  const v = Number(globalThis.localStorage?.getItem("its.infinityVersion"));
  return rules.SUPPORTED_VERSIONS.includes(v) ? v : rules.LATEST_VERSION;
}

/** Does the chosen Infinity version accept this item? kind: setting | indicator | audio | dtmf */
const ok = (kind, name) => rules.supports(state.version, kind, name);

const state = {
  step: "start",
  settingsTab: "general",
  name: "my-theme",
  nameTouched: false,
  base: null,             // Infinity theme from the Start ZIP
  branding: null,         // web app branding from the branding portal ZIP
  fileSources: {},        // file name -> "branding" for files imported from it
  baseFileName: "",
  baseNotes: [],
  baseError: "",
  profileData: {},        // name -> JSON
  profiles: [],           // selected profile names, in order
  overlays: [],           // [{ name, data }] imported JSON
  edits: new Edits(),
  files: {},              // added / replaced files
  removedFiles: new Set(),
  allowErrors: false,
  dirty: false,
  recording: null,        // { file, recorder, stream }
  version: loadVersion(), // Infinity version the theme is for
};

let cache = null;

function build() {
  if (!cache) {
    const profiles = [
      ...state.profiles.map((n) => ({ name: `${state.profileData[n].$title ?? n} profile`, data: state.profileData[n] })),
      ...state.overlays.map((o) => ({ name: `imported ${o.name}`, data: o.data })),
    ];
    const built = buildTheme({
      name: state.name || "theme",
      base: state.base,
      profiles,
      edits: state.edits,
      files: state.files,
      removedFiles: state.removedFiles,
      version: state.version,
    });
    built.report = validate(built.theme, { version: state.version });
    cache = built;
  }
  return cache;
}

const current = () => build().config;

let previewUpdaters = [];
let checkTimer = null;

/** Call after any change to the theme. */
function changed({ rerender = false } = {}) {
  cache = null;
  state.dirty = true;
  if (rerender) renderMain();
  else previewUpdaters.forEach((fn) => fn());
  clearTimeout(checkTimer);
  checkTimer = setTimeout(renderSidebar, 150);
}

// ---------------------------------------------------------------------------
// Tiny DOM helpers
// ---------------------------------------------------------------------------

const PROPS = new Set(["checked", "disabled", "selected", "multiple", "open", "indeterminate"]);

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "value") value = v;
    else if (PROPS.has(k)) el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  if (value !== undefined) el.value = value;
  return el;
}

let uid = 0;
const nextId = () => `f${++uid}`;

function toast(message, kind = "info") {
  const el = h("div", { class: `toast ${kind}`, role: kind === "error" ? "alert" : "status" }, message);
  document.getElementById("toasts").append(el);
  setTimeout(() => el.classList.add("hide"), 4500);
  setTimeout(() => el.remove(), 5000);
}

function pickFiles({ accept = "", multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = h("input", { type: "file", accept, multiple });
    input.addEventListener("change", () => resolve([...input.files]));
    input.click();
  });
}

const readBytes = async (file) => new Uint8Array(await file.arrayBuffer());
const stem = (fname) => fname.replace(/\.[^.]+$/, "");
const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const safeFileName = (s) => (s || "theme").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "theme";

function docsLink(text = "Pexip documentation", href = catalog.DOCS.rules) {
  return h("a", { href, target: "_blank", rel: "noopener" }, text, " ↗");
}

// ---------------------------------------------------------------------------
// Colours (Infinity uses 0xRRGGBB or 0xAARRGGBB)
// ---------------------------------------------------------------------------

function parseColor(s) {
  const m = /^(?:0x|#)([0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s ?? "");
  if (!m) return null;
  const hex = m[1];
  return hex.length === 8
    ? { a: parseInt(hex.slice(0, 2), 16), rgb: `#${hex.slice(2)}`.toLowerCase() }
    : { a: 255, rgb: `#${hex}`.toLowerCase() };
}

function formatColor(rgb, a) {
  const hex = rgb.slice(1).toUpperCase();
  return a >= 255 ? `0x${hex}` : `0x${a.toString(16).padStart(2, "0").toUpperCase()}${hex}`;
}

function cssColor(s, fallback = "transparent") {
  const c = parseColor(s);
  if (!c) return fallback;
  const n = parseInt(c.rgb.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${(c.a / 255).toFixed(3)})`;
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------

function field(label, key, control, help, id) {
  return h("div", { class: "field" },
    h("div", { class: "field-label" },
      h("label", { for: id }, label),
      key && h("code", { class: "key", title: "Setting name in themeconfig.json" }, key)),
    control,
    help && h("p", { class: "help" }, help));
}

function triSelect(id, value, labels, onChange) {
  const sel = h("select", { id, onchange: (e) => onChange(e.target.value) },
    h("option", { value: "" }, labels[0]),
    h("option", { value: "true" }, labels[1]),
    h("option", { value: "false" }, labels[2]));
  sel.value = value === true ? "true" : value === false ? "false" : "";
  return sel;
}

function boolField({ key, label, help }) {
  const id = nextId();
  const sel = triSelect(id, current()[key], ["Infinity default", "Yes", "No"], (v) => {
    if (v === "") state.edits.remove([key]);
    else state.edits.set([key], v === "true");
    changed();
  });
  return field(label, key, sel, help, id);
}

function textField(path, label, { help, max, multiline, placeholder = "Infinity default" } = {}) {
  const id = nextId();
  const value = getPath(current(), path);
  const counter = max ? h("span", { class: "counter" }) : null;
  const update = (v) => {
    if (counter) {
      const n = [...v].length;
      counter.textContent = `${n}/${max}`;
      counter.classList.toggle("over", n > max);
    }
  };
  const props = {
    id, placeholder,
    value: typeof value === "string" ? value : "",
    oninput: (e) => {
      const v = e.target.value;
      if (v === "") state.edits.remove(path);
      else state.edits.set(path, v);
      update(v);
      changed();
    },
  };
  const input = multiline ? h("textarea", { ...props, rows: 2 }) : h("input", { ...props, type: "text" });
  update(input.value);
  return field(label, path.join("."), counter ? h("div", { class: "with-counter" }, input, counter) : input, help, id);
}

function numberField({ key, label, help }) {
  const id = nextId();
  const value = current()[key];
  const input = h("input", {
    id, type: "number", min: 0, step: "any", placeholder: "Infinity default",
    value: typeof value === "number" ? String(value) : "",
    oninput: (e) => {
      const v = e.target.value;
      if (v === "") state.edits.remove([key]);
      else if (Number.isFinite(Number(v))) state.edits.set([key], Number(v));
      changed();
    },
  });
  return field(label, key, input, help, id);
}

/**
 * Colour control. Writes 0xRRGGBB (opaque) or 0xAARRGGBB (with transparency).
 * - The swatch is the colour picker (click it) and shows the real colour,
 *   including transparency, over a checkerboard.
 * - alpha: show an "Opacity" slider. Use it where Infinity draws the colour over
 *   video (indicators, message box). Without it, any existing alpha is kept.
 * - optional: shows a "clear" button that removes the setting.
 */
function colorControl(path, { optional = true, alpha: withAlpha = false, fallback = "#ffffff", label = "Colour" } = {}) {
  const value = getPath(current(), path);
  const parsed = parseColor(value);
  let rgb = parsed?.rgb ?? fallback;
  let a = parsed?.a ?? 255;

  const fill = h("span", { class: "swatch-fill" });
  const picker = h("input", { type: "color", value: rgb, list: state.branding?.palette.length ? "brand-palette" : null, "aria-label": `${label}: choose colour` });
  const swatch = h("span", { class: "swatch checker", title: "Click to choose a colour" }, fill, picker);
  const text = h("input", {
    type: "text", class: "color-text", value: value ?? "", spellcheck: "false",
    placeholder: optional ? "Infinity default" : "0xRRGGBB", "aria-label": `${label}: colour code`,
  });
  const slider = h("input", { type: "range", min: 0, max: 100, "aria-label": `${label}: opacity` });
  const pct = h("span", { class: "alpha-label" });
  const wrap = h("div", { class: "color-control" });

  const paint = (unset) => {
    wrap.classList.toggle("unset", unset);
    fill.style.background = unset ? "transparent" : cssColor(formatColor(rgb, a));
    slider.value = String(Math.round((a / 255) * 100));
    pct.textContent = `${slider.value}%`;
    slider.style.setProperty("--swatch", rgb);
  };
  const commit = () => {
    const code = formatColor(rgb, a);
    text.value = code;
    text.classList.remove("invalid");
    state.edits.set(path, code);
    paint(false);
    changed();
  };
  picker.addEventListener("input", () => { rgb = picker.value; commit(); });
  slider.addEventListener("input", () => { a = Math.round((Number(slider.value) / 100) * 255); commit(); });
  text.addEventListener("input", () => {
    const v = text.value.trim();
    if (v === "" && optional) {
      state.edits.remove(path);
      text.classList.remove("invalid");
      paint(true);
      changed();
      return;
    }
    const c = parseColor(v);
    text.classList.toggle("invalid", !c);
    if (!c) return;
    rgb = c.rgb;
    a = c.a;
    picker.value = rgb;
    state.edits.set(path, v);
    paint(false);
    changed();
  });
  paint(!parsed);

  wrap.append(h("div", { class: "color-row" }, swatch, text,
    optional ? h("button", {
      type: "button", class: "icon-btn", title: "Use Infinity's default", "aria-label": `${label}: use Infinity's default`,
      onclick: () => { text.value = ""; text.dispatchEvent(new Event("input")); },
    }, "✕") : null));
  if (withAlpha) {
    wrap.append(h("label", { class: "alpha-row" }, h("span", { class: "alpha-name" }, "Opacity"), slider, pct));
  }
  return wrap;
}

function colorField(path, label, opts = {}) {
  return field(label, path.join("."), colorControl(path, { label, ...opts }), opts.help);
}

/** "Hidden for your version" note listing [label, minVersion] pairs. */
function hiddenNote(items) {
  if (!items.length) return null;
  return h("p", { class: "muted small version-note" },
    `Hidden for Infinity v${state.version}: `,
    items.map(([label, v]) => `${label} (v${v}+)`).join(", "), ".");
}

function section(title, help, ...content) {
  return h("section", { class: "card" },
    h("h3", {}, title),
    help && h("p", { class: "muted" }, help),
    ...content);
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

const STEPS = [
  { id: "start", title: "Start", sub: "Branding ZIP & name" },
  { id: "profiles", title: "Experience", sub: "Ready-made profiles" },
  { id: "settings", title: "Settings", sub: "Indicators, banner, clock, keypad…" },
  { id: "images", title: "Images", sub: "Logos & backgrounds" },
  { id: "voice", title: "Voice prompts", sub: "Upload or record audio" },
  { id: "review", title: "Review & download", sub: "Check and get the ZIP" },
];

function stepBadge(id) {
  const files = Object.keys(build().theme.files);
  switch (id) {
    case "start": return state.branding ? (state.branding.brandName || "Branding loaded") : state.base ? "Theme ZIP loaded" : "";
    case "profiles": return state.profiles.length ? `${state.profiles.length} selected` : "";
    case "settings": return state.edits.count ? `${state.edits.count} changed` : "";
    case "images": {
      const n = files.filter((f) => /\.(png|jpe?g|svg)$/i.test(f)).length;
      return n ? `${n} image${n === 1 ? "" : "s"}` : "";
    }
    case "voice": {
      const n = files.filter((f) => rules.BASE_AUDIO_FILES.has(f)).length;
      return n ? `${n} custom` : "";
    }
    default: return "";
  }
}

function renderSidebar() {
  const { report } = build();
  const nav = document.getElementById("sidebar");
  nav.replaceChildren(
    h("ol", { class: "steps" }, STEPS.map((s, i) => h("li", {},
      h("button", {
        type: "button",
        class: `step ${state.step === s.id ? "active" : ""}`,
        "aria-current": state.step === s.id ? "step" : null,
        onclick: () => go(s.id),
      },
      h("span", { class: "num" }, i + 1),
      h("span", { class: "step-text" },
        h("span", { class: "step-title" }, s.title),
        h("span", { class: "step-sub" }, stepBadge(s.id) || s.sub)))))),
    h("button", {
      type: "button",
      class: `check ${report.errors.length ? "bad" : report.warnings.length ? "warn" : "good"}`,
      onclick: () => go("review"),
    },
    report.errors.length
      ? `✗ ${report.errors.length} error${report.errors.length === 1 ? "" : "s"}`
      : "✓ Ready to download",
    report.warnings.length ? h("span", { class: "check-sub" }, `${report.warnings.length} warning${report.warnings.length === 1 ? "" : "s"}`) : null),
  );
  const box = document.getElementById("config-issues");
  if (box) box.replaceChildren(...issueList(report.issues.filter((i) => i.file === rules.THEMECONFIG)));
}

function go(step) {
  state.step = step;
  renderSidebar();
  renderMain({ resetScroll: true });
}

// ---------------------------------------------------------------------------
// Main area
// ---------------------------------------------------------------------------

const RENDERERS = {};

function renderMain({ resetScroll = false } = {}) {
  const main = document.getElementById("main");
  const scroll = resetScroll ? 0 : window.scrollY;
  previewUpdaters = [];
  const idx = STEPS.findIndex((s) => s.id === state.step);
  main.replaceChildren(
    RENDERERS[state.step](),
    state.branding?.palette.length
      ? h("datalist", { id: "brand-palette" }, [state.branding.baseColor, ...state.branding.palette].filter(Boolean).map((c) => h("option", { value: c.toLowerCase() })))
      : null,
    h("div", { class: "nav-buttons" },
      idx > 0 ? h("button", { type: "button", class: "btn", onclick: () => go(STEPS[idx - 1].id) }, `← ${STEPS[idx - 1].title}`) : h("span"),
      idx < STEPS.length - 1 ? h("button", { type: "button", class: "btn primary", onclick: () => go(STEPS[idx + 1].id) }, `${STEPS[idx + 1].title} →`) : h("span")),
  );
  window.scrollTo(0, scroll);
  if (resetScroll) main.focus({ preventScroll: true });
}

function issueList(issues) {
  return issues.map((i) => h("div", { class: `issue ${i.level}` },
    h("span", { class: "issue-level" }, i.level === "error" ? "Error" : "Warning"),
    h("span", { class: "issue-file" }, i.file),
    h("span", { class: "issue-msg" }, i.message)));
}

// -- Step 1: Start ------------------------------------------------------------

/** Forget the Start ZIP (theme and/or web app branding) and anything imported from it. */
function clearStart() {
  for (const [f, src] of Object.entries(state.fileSources)) {
    if (src === "branding") delete state.files[f];
  }
  Object.assign(state, {
    base: null, branding: null, baseFileName: "", baseNotes: [], baseError: "",
    fileSources: {}, removedFiles: new Set(),
  });
}

const slotFor = (file) => catalog.IMAGE_SLOTS.find((s) => s.file === file);

/** Use the branding portal's logo and background as the theme's watermark and splash background. */
async function importBranding(branding) {
  const notes = [];
  const imports = [
    ["logo", "watermark_icon.png", "Logo"],
    ["background", "background.jpg", "Background"],
  ];
  for (const [key, target, label] of imports) {
    const img = branding.images[key];
    if (!img) continue;
    if (target in state.files) {
      notes.push(`${label} not imported: you already added your own ${target}.`);
      continue;
    }
    const slot = slotFor(target);
    try {
      const bytes = needsFit(img.bytes, slot) ? await fitImage(img.bytes, img.name, slot.fit) : img.bytes;
      setFile(target, bytes, "branding");
      notes.push(`${label} → ${target} (${slot.fit.w}×${slot.fit.h})`);
    } catch (err) {
      notes.push(`${label} could not be converted (${err.message}). Add it in the Images step.`);
    }
  }
  if (branding.images.jumbotron) notes.push("The jumbotron image is used by the web app only.");
  return notes;
}

async function loadStartZip(file) {
  try {
    const bytes = await readBytes(file);
    const { theme: found, branding } = await inspectZip(bytes, stem(file.name));
    clearStart();
    state.baseFileName = file.name;
    if (found) {
      const { theme, notes } = found;
      if (!(rules.THEMECONFIG in theme.files)) {
        notes.push("No themeconfig.json found, so one will be created.");
      } else {
        try { loadConfig(theme); } catch (err) {
          const text = new TextDecoder().decode(theme.files[rules.THEMECONFIG]);
          state.baseError = `themeconfig.json in this ZIP can't be read (${describeJsonError(err, text)}). Its settings will be ignored and replaced.`;
        }
      }
      state.base = theme;
      state.baseNotes.push(...notes);
    }
    if (branding) {
      state.branding = { ...branding, fileName: file.name, bytes };
      state.baseNotes.push(...await importBranding(branding));
    }
    if (!state.nameTouched) state.name = safeFileName(slug(branding?.brandName) || stem(file.name));
    toast(branding ? `Loaded web app branding “${branding.brandName || file.name}”` : `Loaded ${file.name} (${Object.keys(found.theme.files).length} files)`, "success");
  } catch (err) {
    toast(err.message, "error");
  }
  changed({ rerender: true });
}

/** Give every in-call indicator the brand colour (solid border, slightly transparent background). */
function applyBrandColour() {
  const base = state.branding?.baseColor;
  if (!base) return;
  const types = [...rules.INDICATOR_TYPES].filter((t) => ok("indicator", t));
  for (const type of types) {
    state.edits.replace(["indicator_color_config", type], {
      background: formatColor(base, 0xcc),
      border: formatColor(base, 0xff),
      text: formatColor("#ffffff", 0xff),
    });
  }
  toast(`Brand colour applied to ${types.length} indicators`, "success");
  changed({ rerender: true });
}

function brandColourButton() {
  return state.branding?.baseColor
    ? h("button", { type: "button", class: "btn", onclick: applyBrandColour },
      h("span", { class: "dot", style: { background: state.branding.baseColor } }), " Apply brand colour to indicators")
    : null;
}

function brandingSummary() {
  const b = state.branding;
  return h("div", { class: "brand-summary" },
    b.images.logo ? h("span", { class: "brand-logo checker" }, thumb(b.images.logo.name, b.images.logo.bytes)) : null,
    h("div", {},
      h("div", { class: "muted small" }, "Web app branding from the branding portal"),
      h("strong", {}, b.brandName || "(no brand name)"),
      b.palette.length ? h("div", { class: "palette", title: "Brand colour palette" },
        b.palette.map((c) => h("span", { class: "dot", style: { background: c }, title: c }))) : null,
      b.plugins ? h("div", { class: "muted small" }, `Includes ${b.plugins} web app plugin(s); they stay in the web app package.`) : null));
}

function baseSummary() {
  const names = Object.keys(state.base.files);
  const count = (re) => names.filter((n) => re.test(n)).length;
  const parts = [
    rules.THEMECONFIG in state.base.files ? "themeconfig.json" : null,
    count(/\.(png|jpe?g)$/i) ? `${count(/\.(png|jpe?g)$/i)} images` : null,
    count(/\.svg$/i) ? `${count(/\.svg$/i)} icons` : null,
    count(/\.wav$/i) ? `${count(/\.wav$/i)} voice prompts` : null,
  ].filter(Boolean);
  return parts.join(" · ") || `${names.length} files`;
}

async function chooseBaseZip() {
  const [f] = await pickFiles({ accept: ".zip,application/zip" });
  if (f) loadStartZip(f);
}

RENDERERS.start = () => {
  const nameId = nextId();
  const drop = h("div", {
    class: "dropzone", tabindex: 0, role: "button",
    "aria-label": "Choose a branding portal ZIP",
    onclick: chooseBaseZip,
    onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } },
    ondragover: (e) => { e.preventDefault(); e.currentTarget.classList.add("over"); },
    ondragleave: (e) => e.currentTarget.classList.remove("over"),
    ondrop: (e) => {
      e.preventDefault();
      e.currentTarget.classList.remove("over");
      const f = e.dataTransfer.files[0];
      if (f) loadStartZip(f);
    },
  },
  h("div", { class: "dz-icon" }, "⬆"),
  h("strong", {}, "Drop your branding portal ZIP here"),
  h("span", { class: "muted" }, "or click to choose a file. An existing Infinity theme ZIP works too."));

  return h("div", {},
    h("div", { class: "hero" },
      h("h1", {}, "Build a Pexip Infinity theme"),
      h("p", { class: "lead" },
        "Themes control what people see and hear when they join a Pexip Infinity meeting from browsers, room systems and phones: splash screens, logos, in-call indicators, classification banners, clocks, keypad controls and voice prompts. ",
        "Start from the ZIP made by Pexip's branding portal (which brands the web app). Theme Studio reuses its name, logo, background and colours for the theme, lets you add everything the portal doesn't cover, and gives you both packages ready to upload.")),

    section("1. Start from your branding", null,
      state.base || state.branding
        ? h("div", { class: "loaded" },
          h("div", { class: "loaded-body" },
            h("div", { class: "muted small" }, state.baseFileName),
            state.branding ? brandingSummary() : null,
            state.base ? h("div", {}, h("strong", {}, "Infinity theme: "), h("span", { class: "muted" }, baseSummary())) : null,
            state.baseNotes.length ? h("ul", { class: "list notes" }, state.baseNotes.map((n) => h("li", {}, n))) : null,
            state.baseError ? h("div", { class: "issue error" }, h("span", { class: "issue-msg" }, state.baseError)) : null,
            brandColourButton()),
          h("div", { class: "row" },
            h("button", { type: "button", class: "btn", onclick: chooseBaseZip }, "Choose another"),
            h("button", {
              type: "button", class: "btn subtle",
              onclick: () => { clearStart(); changed({ rerender: true }); },
            }, "Start from scratch instead")))
        : h("div", {}, drop, h("p", { class: "muted small" },
          "No branding ZIP yet? ", docsLink("Create one in Pexip's branding portal", catalog.DOCS.brandingPortal),
          ", then download it and drop it here. Or just continue: you can build a theme from scratch and add images later."))),

    section("2. Name your theme and choose your Infinity version", null,
      h("div", { class: "fields" },
        field("Theme name", null, h("input", {
          id: nameId, type: "text", value: state.name, maxlength: 100,
          oninput: (e) => { state.name = e.target.value; state.nameTouched = true; changed(); },
        }), "Used for the ZIP file and the folder inside it. Use the same name when you add it in Infinity.", nameId),
        (() => {
          const id = nextId();
          return field("Infinity version", null, h("select", {
            id, value: String(state.version),
            onchange: (e) => {
              state.version = Number(e.target.value);
              try { localStorage.setItem("its.infinityVersion", String(state.version)); } catch { /* private mode */ }
              toast(`Building for Infinity v${state.version}`, "success");
              changed({ rerender: true });
            },
          }, rules.SUPPORTED_VERSIONS.map((v) => h("option", { value: String(v) },
            v === rules.LATEST_VERSION ? `v${v} (latest)` : v === Math.min(...rules.SUPPORTED_VERSIONS) ? `v${v} or older` : `v${v}`))),
          "The version you'll upload to (shown in the Infinity Administrator interface). Options your version doesn't support are hidden and left out of the theme.", id);
        })())),

    section("What you can customise", null,
      h("div", { class: "capabilities" }, catalog.CAPABILITIES.map(([t, d]) => h("div", { class: "capability" }, h("strong", {}, t), h("span", {}, d))))),

    h("p", { class: "muted small" },
      "Unofficial tool, not a Pexip product. Always test themes on a non-production meeting room first. Rules follow Pexip Infinity v",
      rules.TARGET_INFINITY_VERSION, ". ", docsLink("Theme rules and requirements")),
  );
};

// -- Step 2: Profiles -----------------------------------------------------------

function settingSummary(data) {
  return Object.keys(data).filter((k) => !k.startsWith("$")).map((k) => k.replace(/_/g, " "));
}

RENDERERS.profiles = () => h("div", {},
  h("h1", {}, "Choose an experience"),
  h("p", { class: "lead" }, "Profiles are ready-made bundles of settings for common meeting types. Pick one or more as a starting point (later picks win where they overlap). You can fine-tune everything in the next step."),
  h("div", { class: "profile-grid" }, catalog.PROFILE_NAMES.filter((n) => state.profileData[n]).map((n) => {
    const data = state.profileData[n];
    const order = state.profiles.indexOf(n);
    const selected = order >= 0;
    return h("button", {
      type: "button", class: `profile ${selected ? "selected" : ""}`, "aria-pressed": String(selected),
      onclick: () => {
        if (selected) state.profiles.splice(order, 1);
        else state.profiles.push(n);
        changed({ rerender: true });
      },
    },
    h("div", { class: "profile-head" },
      h("strong", {}, data.$title ?? n),
      selected ? h("span", { class: "order" }, state.profiles.length > 1 ? `#${order + 1}` : "✓") : null),
    h("p", {}, (data.$comment ?? "").replace(/^[^:]+:\s*/, "")),
    h("div", { class: "chips" }, Object.keys(data).filter((k) => !k.startsWith("$")).map((k) => ok("setting", k)
      ? h("span", { class: "chip" }, k.replace(/_/g, " "))
      : h("span", { class: "chip unsupported", title: `Needs Infinity v${rules.minVersion("setting", k)}, so it's left out for v${state.version}` }, k.replace(/_/g, " ")))));
  })),
  state.overlays.length
    ? h("p", { class: "muted" }, `Also applying ${state.overlays.length} imported JSON file(s). Manage them in Settings → Advanced.`)
    : null,
);

// -- Step 3: Settings -----------------------------------------------------------

const SETTINGS_TABS = [
  ["general", "General"],
  ["indicators", "Indicators"],
  ["classification", "Classification banner"],
  ["clock", "Clock & timer"],
  ["keypad", "Keypad"],
  ["wording", "Splash screen wording"],
  ["advanced", "Advanced"],
];

RENDERERS.settings = () => {
  const tabs = h("div", { class: "tabs", role: "tablist" }, SETTINGS_TABS.map(([id, label]) => h("button", {
    type: "button", role: "tab", class: `tab ${state.settingsTab === id ? "active" : ""}`,
    "aria-selected": String(state.settingsTab === id),
    onclick: () => { state.settingsTab = id; renderMain(); },
  }, label)));
  const box = h("div", { id: "config-issues", class: "issues-inline" },
    ...issueList(build().report.issues.filter((i) => i.file === rules.THEMECONFIG)));
  return h("div", {},
    h("h1", {}, "Settings"),
    h("p", { class: "lead" }, "Every option starts at the value from your branding ZIP and profiles. Anything left at “Infinity default” isn't written to the theme, so Infinity's built-in behaviour applies."),
    tabs,
    box,
    SETTINGS_PANES[state.settingsTab](),
  );
};

const SETTINGS_PANES = {};

SETTINGS_PANES.general = () => h("div", {},
  catalog.GENERAL_SECTIONS.map((s) => {
    const fields = s.fields.filter((f) => ok("setting", f.key));
    if (!fields.length) return null;
    return section(s.title, s.help, h("div", { class: "fields" }, fields.map((f) => {
      if (f.type === "bool") return boolField(f);
      if (f.type === "number") return numberField(f);
      if (f.type === "color") return colorField([f.key], f.label, { help: f.help });
      return textField([f.key], f.label, { help: f.help });
    })), hiddenNote(s.fields.filter((f) => !ok("setting", f.key)).map((f) => [f.label, rules.minVersion("setting", f.key)])));
  }),
  section("Message box", "Colours of the message box shown over the video (for example, in-meeting notices).",
    h("div", { class: "fields" },
      colorField(["message_box_config", "text_color"], "Text colour", { alpha: true }),
      colorField(["message_box_config", "background_color"], "Background colour", { alpha: true }),
      colorField(["message_box_config", "border_color"], "Border colour", { alpha: true }))),
);

// Indicators

const DEFAULT_INDICATOR = { background: "0xB3000000", border: "0xB3000000", text: "0xFFFFFFFF" };
const DEFAULT_LIGHT = { background: "0xE6FFFFFF", border: "0xE6FFFFFF", text: "0xFF000000" };

function indicatorCard(ind) {
  const colorPath = ["indicator_color_config", ind.color];
  const colors = getPath(current(), colorPath);
  const preview = h("span", { class: "indicator-chip" });
  const lightPreview = h("span", { class: "indicator-chip light" });
  const update = () => {
    const cfg = current();
    const c = cfg.indicator_color_config?.[ind.color];
    const label = ind.texts.length ? (cfg[ind.texts[0].key] || ind.title) : ind.title;
    const hidden = ind.hide && cfg[ind.hide] === true;
    for (const [el, cc] of [[preview, c], [lightPreview, c?.light_mode]]) {
      el.textContent = label;
      el.style.background = cssColor(cc?.background, "rgba(0,0,0,.7)");
      el.style.borderColor = cssColor(cc?.border, "rgba(0,0,0,.7)");
      el.style.color = cssColor(cc?.text, "#fff");
      el.classList.toggle("hidden-ind", Boolean(hidden));
    }
    lightPreview.style.display = c?.light_mode ? "" : "none";
  };
  previewUpdaters.push(update);
  update();

  const canHide = Boolean(ind.hide) && ok("setting", ind.hide);
  const texts = ind.texts.filter((t) => ok("setting", t.key));
  const canColor = ok("indicator", ind.color);
  if (!canHide && !texts.length && !canColor) return null;
  const custom = canColor && Boolean(colors);
  const light = Boolean(colors?.light_mode);
  const visibility = canHide ? (() => {
    const id = nextId();
    const cur = current()[ind.hide];
    const sel = triSelect(id, cur === true ? false : cur === false ? true : undefined, ["Infinity default", "Show", "Hide"], (v) => {
      if (v === "") state.edits.remove([ind.hide]);
      else state.edits.set([ind.hide], v === "false");
      changed();
    });
    return field("Visibility", ind.hide, sel, null, id);
  })() : null;

  return h("section", { class: "card indicator" },
    h("div", { class: "indicator-head" },
      h("div", {}, h("h3", {}, ind.title), h("p", { class: "muted" }, ind.help)),
      h("div", { class: "preview-stage", title: "Preview" }, preview, lightPreview)),
    h("div", { class: "fields" },
      visibility,
      texts.map((t) => textField([t.key], t.label, { max: t.max, help: t.help }))),
    !canColor ? h("p", { class: "muted small" }, rules.minVersion("indicator", ind.color) === rules.NEVER
      ? "Infinity doesn't accept custom colours for this indicator yet (Pexip's docs list them, but uploads are rejected)."
      : `Custom colours for this indicator need Infinity v${rules.minVersion("indicator", ind.color)}.`) : null,
    canColor ? h("label", { class: "toggle" },
      h("input", {
        type: "checkbox", checked: custom,
        onchange: (e) => {
          if (e.target.checked) state.edits.replace(colorPath, { ...DEFAULT_INDICATOR });
          else state.edits.remove(colorPath);
          changed({ rerender: true });
        },
      }), " Custom colours") : null,
    custom ? h("div", { class: "fields three" },
      colorField([...colorPath, "background"], "Background", { optional: false, alpha: true }),
      colorField([...colorPath, "border"], "Border", { optional: false, alpha: true }),
      colorField([...colorPath, "text"], "Text", { optional: false, alpha: true })) : null,
    custom ? h("label", { class: "toggle" },
      h("input", {
        type: "checkbox", checked: light,
        onchange: (e) => {
          if (e.target.checked) state.edits.replace([...colorPath, "light_mode"], { ...DEFAULT_LIGHT });
          else state.edits.remove([...colorPath, "light_mode"]);
          changed({ rerender: true });
        },
      }), " Different colours in light mode") : null,
    custom && light ? h("div", { class: "fields three" },
      colorField([...colorPath, "light_mode", "background"], "Light background", { optional: false, alpha: true }),
      colorField([...colorPath, "light_mode", "border"], "Light border", { optional: false, alpha: true }),
      colorField([...colorPath, "light_mode", "text"], "Light text", { optional: false, alpha: true })) : null,
  );
}

SETTINGS_PANES.indicators = () => h("div", {},
  h("p", { class: "muted" }, "Indicators appear over the video to tell people what's happening in the meeting. Change their wording, colours (with transparency), or hide them."),
  brandColourButton(),
  h("div", { class: "indicator-grid" }, catalog.INDICATORS.map(indicatorCard)));

// Classification

function levelParts(v) {
  return typeof v === "string" ? { text: v } : { text: v?.text ?? "", color: v?.color, bgcolor: v?.bgcolor };
}

function saveClassification(cls) {
  state.edits.replace(["classification"], cls);
}

SETTINGS_PANES.classification = () => {
  const cls = current().classification;
  const enabled = cls && typeof cls === "object" && cls.levels && typeof cls.levels === "object";
  const intro = h("p", { class: "muted" },
    "Shows a banner with a security label such as Internal, Confidential or Strictly Confidential. ",
    "The default level applies when the meeting starts; hosts can change the level during the meeting (client API ",
    h("code", {}, "set_classification_level"), "). Tip: add a ", h("em", {}, "classification changed"), " voice prompt so callers hear the change.");
  const toggle = h("label", { class: "toggle" },
    h("input", {
      type: "checkbox", checked: Boolean(enabled),
      onchange: (e) => {
        if (e.target.checked) {
          saveClassification({ levels: { 0: "Internal", 1: { text: "Confidential", color: "0x000000", bgcolor: "0xFFD54F" } }, default: 0 });
        } else {
          state.edits.remove(["classification"]);
        }
        changed({ rerender: true });
      },
    }), " Show a classification banner");
  if (!enabled) return section("Classification banner", null, intro, toggle);

  const levels = Object.entries(cls.levels).sort((a, b) => Number(a[0]) - Number(b[0]));
  const commit = (mutate) => {
    const next = JSON.parse(JSON.stringify(current().classification));
    mutate(next);
    saveClassification(next);
  };
  const setLevel = (key, parts) => commit((c) => {
    const p = { ...levelParts(c.levels[key]), ...parts };
    const obj = { text: p.text };
    if (p.color) obj.color = p.color;
    if (p.bgcolor) obj.bgcolor = p.bgcolor;
    c.levels[key] = Object.keys(obj).length === 1 ? obj.text : obj;
  });

  const rows = levels.map(([key, v]) => {
    const p = levelParts(v);
    const banner = h("div", { class: "banner-preview" });
    const updateBanner = () => {
      const cur = levelParts(current().classification?.levels?.[key]);
      banner.textContent = cur.text || "(empty)";
      banner.style.color = cssColor(cur.color, "#fff");
      banner.style.background = cssColor(cur.bgcolor, "#3b3b3b");
    };
    previewUpdaters.push(updateBanner);
    updateBanner();
    const colorInput = (prop, label) => {
      const c = parseColor(p[prop]);
      const picker = h("input", {
        type: "color", value: c?.rgb ?? (prop === "color" ? "#ffffff" : "#3b3b3b"), "aria-label": `${label} for level ${key}`,
        oninput: (e) => { setLevel(key, { [prop]: formatColor(e.target.value, 255) }); clear.disabled = false; changed(); },
      });
      const clear = h("button", {
        type: "button", class: "icon-btn", title: "Use default", disabled: !c,
        onclick: () => { setLevel(key, { [prop]: undefined }); clear.disabled = true; changed(); },
      }, "✕");
      return h("label", { class: "mini" }, h("span", {}, label), h("span", { class: "row" }, picker, clear));
    };
    return h("div", { class: "level-row" },
      h("span", { class: "level-key", title: "Level number" }, key),
      h("input", {
        type: "text", value: p.text, "aria-label": `Text for level ${key}`,
        oninput: (e) => { setLevel(key, { text: e.target.value }); changed(); },
      }),
      colorInput("color", "Text"),
      colorInput("bgcolor", "Background"),
      banner,
      h("button", {
        type: "button", class: "icon-btn", title: "Remove level", disabled: levels.length <= 1,
        onclick: () => {
          commit((c) => {
            delete c.levels[key];
            if (String(c.default) === key) c.default = Number(Object.keys(c.levels)[0]);
          });
          changed({ rerender: true });
        },
      }, "🗑"));
  });

  const defaultId = nextId();
  return section("Classification banner", null, intro, toggle,
    h("div", { class: "levels" }, rows),
    h("button", {
      type: "button", class: "btn",
      onclick: () => {
        commit((c) => {
          const next = Math.max(-1, ...Object.keys(c.levels).map(Number).filter(Number.isFinite)) + 1;
          c.levels[String(next)] = "New level";
        });
        changed({ rerender: true });
      },
    }, "+ Add level"),
    field("Level when the meeting starts", "classification.default", h("select", {
      id: defaultId, value: String(cls.default),
      onchange: (e) => { commit((c) => { c.default = Number(e.target.value); }); changed(); },
    }, levels.map(([k, v]) => h("option", { value: k }, `${k}: ${levelParts(v).text}`))), null, defaultId),
  );
};

// Clock

const TIMEZONES = (() => {
  try { return Intl.supportedValuesOf("timeZone"); } catch { return ["UTC", "Europe/London", "America/New_York"]; }
})();

function clockSample(clock) {
  if (!clock) return "";
  let body = "00:12:34";
  if (clock.type === "remaining") {
    const s = clock.starting_value || 0;
    body = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, "0")).join(":");
  } else if (clock.type === "time") {
    let tz = "UTC";
    try { new Intl.DateTimeFormat("en", { timeZone: clock.timezone }); tz = clock.timezone || "UTC"; } catch { /* invalid */ }
    const now = new Date();
    body = now.toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
    if (clock.date) {
      const [d, m, y] = ["day", "month", "year"].map((part) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, [part]: part === "year" ? "numeric" : "2-digit" }).format(now));
      body = `${clock.date === "dd/mm/yyyy" ? `${d}/${m}/${y}` : `${m}/${d}/${y}`} ${body}`;
    }
  }
  return `${clock.prefix ?? ""}${body}${clock.suffix ?? ""}`;
}

SETTINGS_PANES.clock = () => {
  if (!ok("setting", "clock_data")) {
    return section("Clock & timer", null, h("p", { class: "muted" },
      `The clock and timer need Infinity v${rules.minVersion("setting", "clock_data")} or later. You're building for v${state.version}; change it on the Start step.`));
  }
  const clock = current().clock_data;
  const type = clock && typeof clock === "object" ? clock.type : "";
  const commit = (mutate) => {
    const next = { ...(current().clock_data ?? {}) };
    mutate(next);
    for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === "") delete next[k];
    state.edits.replace(["clock_data"], next);
    changed();
  };
  const typeId = nextId();
  const typeSel = h("select", {
    id: typeId, value: type ?? "",
    onchange: (e) => {
      const t = e.target.value;
      if (!t) { state.edits.remove(["clock_data"]); changed({ rerender: true }); return; }
      commit((c) => {
        c.type = t;
        if (t !== "time") { delete c.timezone; delete c.date; }
        if (t === "time" && !c.timezone) c.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
        if (t !== "remaining") delete c.starting_value;
        if (t === "remaining" && !c.starting_value) c.starting_value = 3600;
      });
      renderMain();
    },
  },
  h("option", { value: "" }, "No clock"),
  h("option", { value: "elapsed" }, "Elapsed time (how long the meeting has been running)"),
  h("option", { value: "remaining" }, "Countdown (time remaining)"),
  h("option", { value: "time" }, "Time of day"));

  const preview = h("div", { class: "clock-preview" });
  const update = () => {
    const c = current().clock_data;
    preview.textContent = clockSample(c);
    preview.style.display = c ? "" : "none";
  };
  previewUpdaters.push(update);
  update();

  const textInput = (key, label, placeholder) => {
    const id = nextId();
    return field(label, `clock_data.${key}`, h("input", {
      id, type: "text", placeholder, value: clock?.[key] ?? "",
      oninput: (e) => commit((c) => { c[key] = e.target.value; }),
    }), null, id);
  };

  const extra = [];
  if (type === "remaining") {
    const sv = clock.starting_value ?? 0;
    const hId = nextId();
    const hours = h("input", { id: hId, type: "number", min: 0, max: 8760, value: String(Math.floor(sv / 3600)), "aria-label": "Hours" });
    const mins = h("input", { type: "number", min: 0, max: 59, value: String(Math.floor((sv % 3600) / 60)), "aria-label": "Minutes" });
    const onTime = () => commit((c) => { c.starting_value = (Number(hours.value) || 0) * 3600 + (Number(mins.value) || 0) * 60; });
    hours.addEventListener("input", onTime);
    mins.addEventListener("input", onTime);
    extra.push(field("Count down from", "clock_data.starting_value", h("div", { class: "row" }, hours, h("span", {}, "hours"), mins, h("span", {}, "minutes")), "Up to one year.", hId));
  }
  if (type === "time") {
    const tzId = nextId();
    const listId = nextId();
    extra.push(field("Time zone", "clock_data.timezone", h("div", {},
      h("input", {
        id: tzId, type: "text", list: listId, value: clock.timezone ?? "", placeholder: "UTC",
        oninput: (e) => commit((c) => { c.timezone = e.target.value; }),
      }),
      h("datalist", { id: listId }, TIMEZONES.map((tz) => h("option", { value: tz })))), "Start typing a city, e.g. Europe/Oslo.", tzId));
    const dId = nextId();
    extra.push(field("Show the date", "clock_data.date", h("select", {
      id: dId, value: clock.date ?? "",
      onchange: (e) => commit((c) => { c.date = e.target.value || undefined; }),
    }, h("option", { value: "" }, "No date"), h("option", { value: "dd/mm/yyyy" }, "dd/mm/yyyy"), h("option", { value: "mm/dd/yyyy" }, "mm/dd/yyyy")), null, dId));
  }

  return section("Clock & timer", "Show a clock over the video: how long the meeting has run, a countdown, or the time of day.",
    field("Clock type", "clock_data.type", typeSel, null, typeId),
    type ? h("div", { class: "fields" },
      extra,
      textInput("prefix", "Text before", "e.g. Live for "),
      textInput("suffix", "Text after", "")) : null,
    preview);
};

// Keypad

SETTINGS_PANES.keypad = () => {
  const cfg = current();
  const cmds = cfg.dtmf_conference_control_commands;
  const custom = cmds && typeof cmds === "object";
  const byCommand = {};
  if (custom) for (const [code, cmd] of Object.entries(cmds)) byCommand[cmd] = code;

  const inputs = {};
  const errors = {};
  const saveCommands = () => {
    const out = {};
    const used = {};
    let ok = true;
    for (const [cmd, input] of Object.entries(inputs)) {
      const code = input.value.trim();
      errors[cmd].textContent = "";
      input.classList.remove("invalid");
      if (!code) continue;
      if (!rules.DTMF_KEY_RE.test(code)) {
        errors[cmd].textContent = "Use exactly two characters: 0-9, * or #";
        input.classList.add("invalid");
        ok = false;
        continue;
      }
      if (used[code]) {
        errors[cmd].textContent = `Already used for “${catalog.DTMF_COMMAND_LABELS[used[code]]}”`;
        input.classList.add("invalid");
        ok = false;
        continue;
      }
      used[code] = cmd;
      out[code] = cmd;
    }
    if (ok) {
      state.edits.replace(["dtmf_conference_control_commands"], out);
      changed();
    }
  };

  const table = custom ? h("div", { class: "dtmf-table" }, Object.entries(catalog.DTMF_COMMAND_LABELS).filter(([cmd]) => ok("dtmf", cmd)).map(([cmd, label]) => {
    const id = nextId();
    inputs[cmd] = h("input", { id, type: "text", maxlength: 2, class: "dtmf-input", value: byCommand[cmd] ?? "", placeholder: "—", oninput: saveCommands, spellcheck: "false" });
    errors[cmd] = h("span", { class: "error-text" });
    return h("div", { class: "dtmf-row" },
      h("label", { for: id }, label, h("code", { class: "key" }, cmd)),
      inputs[cmd], errors[cmd]);
  })) : null;

  const layouts = cfg.dtmf_allowed_layouts;
  const limit = Array.isArray(layouts);
  const customLayouts = customLayoutNames(build().theme);
  const allLayouts = [...Object.keys(catalog.LAYOUT_LABELS), ...customLayouts];

  return h("div", {},
    section("Keypad controls", "Callers on room systems and phones can control the meeting with keypad (DTMF) codes, such as *6 to mute.",
      h("div", { class: "fields" }, boolField({ key: "enable_dtmf_conference_control", label: "Allow keypad controls" })),
      h("label", { class: "toggle" },
        h("input", {
          type: "checkbox", checked: Boolean(custom),
          onchange: (e) => {
            if (e.target.checked) state.edits.replace(["dtmf_conference_control_commands"], cmds ?? { "*6": "toggle_self_mute" });
            else state.edits.remove(["dtmf_conference_control_commands"]);
            changed({ rerender: true });
          },
        }), " Choose my own keypad codes"),
      custom ? h("p", { class: "muted small" }, "Two characters per command (0-9, * and #). Leave a command blank to leave it out of your list. Your branding ZIP or Infinity's Base theme shows the current defaults. If you move mute away from *6, update the mute hint image too.") : null,
      table),
    section("Layouts available from the keypad", "Limit which layouts callers can cycle through with the change-layout codes.",
      h("label", { class: "toggle" },
        h("input", {
          type: "checkbox", checked: limit,
          onchange: (e) => {
            if (e.target.checked) state.edits.replace(["dtmf_allowed_layouts"], Object.keys(catalog.LAYOUT_LABELS));
            else state.edits.remove(["dtmf_allowed_layouts"]);
            changed({ rerender: true });
          },
        }), " Only allow these layouts"),
      limit ? h("div", { class: "checks" }, allLayouts.map((l) => h("label", { class: "check-item" },
        h("input", {
          type: "checkbox", checked: layouts.includes(l),
          onchange: () => {
            const next = [...document.querySelectorAll(".checks input[data-layout]")].filter((i) => i.checked).map((i) => i.dataset.layout);
            state.edits.replace(["dtmf_allowed_layouts"], next);
            changed();
          },
          "data-layout": l,
        }),
        h("span", {}, catalog.LAYOUT_LABELS[l] ?? `Custom: ${l}`),
        h("code", { class: "key" }, l)))) : null,
      limit && !customLayouts.length ? h("p", { class: "muted small" }, "Custom layouts from your theme (custom_layout_*.json, added in the Images step) also appear here. Design them with ", docsLink("Pexip's layout designer", catalog.DOCS.layoutDesigner), ".") : null),
  );
};

// Wording

/** Splash screen label box showing Infinity's default wording, with an "Edit default" shortcut. */
function labelField(key, label) {
  const def = catalog.DEFAULT_LABEL_TEXT[key];
  const el = textField(["splash_screens", "labels", key], label, {
    multiline: true,
    placeholder: def ?? "Default wording",
    help: /\{\w+\}/.test(def ?? "") ? "Text in {braces} is filled in by Infinity (the meeting number or name). Keep it if you want it shown." : null,
  });
  if (!def) return el;
  const ta = el.querySelector("textarea");
  ta.rows = Math.max(2, def.split("\n").length);
  const btn = h("button", {
    type: "button", class: "btn subtle small-btn", title: "Copy Infinity's default wording into the box to edit it",
    onclick: () => { ta.value = def; ta.dispatchEvent(new Event("input")); ta.focus(); },
  }, "Edit default");
  const sync = () => { btn.hidden = ta.value !== ""; };
  ta.addEventListener("input", sync);
  sync();
  el.append(btn);
  return el;
}

SETTINGS_PANES.wording = () => {
  const labels = current().splash_screens?.labels ?? {};
  const customKeys = Object.keys(labels).filter((k) => !rules.DEFAULT_LABELS.has(k));
  return h("div", {},
    h("p", { class: "muted" }, "Change the text on the splash screens people see while joining, waiting, or when something goes wrong. Infinity's default wording is shown in grey; leave a box empty to keep it, or click “Edit default” to change it. Press Enter for a new line."),
    catalog.LABEL_GROUPS.map((g) => section(g.title, null, h("div", { class: "fields two" },
      Object.entries(g.labels).map(([key, label]) => labelField(key, label))))),
    customKeys.length ? section("Custom labels in your theme", "Extra labels defined by your branding ZIP's splash screen layouts.",
      h("div", { class: "fields two" }, customKeys.map((key) => textField(["splash_screens", "labels", key], key, { multiline: true })))) : null,
  );
};

// Advanced

SETTINGS_PANES.advanced = () => {
  const pasteId = nextId();
  const paste = h("textarea", { id: pasteId, rows: 6, class: "mono", placeholder: '{\n  "clock_data": {"type": "elapsed"}\n}' });
  const addOverlay = (name, text) => {
    try {
      const data = JSON.parse(text);
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("must be a JSON object");
      state.overlays.push({ name, data });
      toast(`Imported ${name}`, "success");
      changed({ rerender: true });
    } catch (err) {
      toast(`${name}: ${describeJsonError(err, text)}`, "error");
    }
  };
  return h("div", {},
    section("Import settings (JSON)", "Merge settings from a themeconfig.json snippet or file. Objects are merged and lists are replaced. Imported settings are applied after profiles and before the changes you make in this portal.",
      h("div", { class: "row" },
        h("button", {
          type: "button", class: "btn",
          onclick: async () => {
            for (const f of await pickFiles({ accept: ".json,application/json", multiple: true })) addOverlay(f.name, await f.text());
          },
        }, "Import JSON file…"),
        h("a", { href: "examples/my-tweaks.json", download: "my-tweaks.json" }, "Download an example")),
      field("Or paste JSON", null, paste, null, pasteId),
      h("button", { type: "button", class: "btn", onclick: () => { if (paste.value.trim()) addOverlay(`pasted JSON ${state.overlays.length + 1}`, paste.value); } }, "Apply pasted JSON"),
      state.overlays.length ? h("ul", { class: "list" }, state.overlays.map((o, i) => h("li", {},
        h("span", {}, o.name, " — ", h("span", { class: "muted" }, settingSummary(o.data).join(", "))),
        h("button", { type: "button", class: "btn subtle", onclick: () => { state.overlays.splice(i, 1); changed({ rerender: true }); } }, "Remove")))) : null),
    section("Start over", "Undo every change made in the Settings step (profiles, imported JSON and files are kept).",
      h("button", {
        type: "button", class: "btn danger", disabled: !state.edits.count,
        onclick: () => { if (confirm("Undo all changes made in Settings?")) { state.edits.reset(); changed({ rerender: true }); } },
      }, `Reset ${state.edits.count} setting change(s)`)),
    section("Current themeconfig.json", null, h("pre", { class: "code" }, JSON.stringify(current(), null, 4))),
  );
};

// -- Step 4: Images ---------------------------------------------------------------

function fileStatus(fname) {
  const inFinal = fname in build().theme.files;
  const fromBase = state.base && fname in state.base.files;
  if (fname in state.files && state.fileSources[fname] === "branding") return "From web app branding";
  if (fname in state.files) return fromBase ? "Replaced" : "Added";
  if (inFinal) return "From theme ZIP";
  if (fromBase && state.removedFiles.has(fname)) return "Removed";
  return "Infinity default";
}

function fileIssues(fname) {
  return build().report.issues.filter((i) => i.file === fname);
}

function setFile(fname, bytes, source = null) {
  state.files[fname] = bytes;
  state.removedFiles.delete(fname);
  if (source) state.fileSources[fname] = source;
  else delete state.fileSources[fname];
}

function removeFile(fname) {
  delete state.files[fname];
  delete state.fileSources[fname];
  if (state.base && fname in state.base.files) state.removedFiles.add(fname);
}

function restoreFile(fname) {
  delete state.files[fname];
  delete state.fileSources[fname];
  state.removedFiles.delete(fname);
}

/** Does this image need converting to meet the slot's requirements? */
function needsFit(bytes, slot) {
  const fmt = sniffFormat(bytes);
  const wantPng = slot.fit.type === "image/png";
  if (fmt !== (wantPng ? "PNG" : "JPEG")) return true;
  try {
    const info = wantPng ? pngInfo(bytes) : jpegInfo(bytes);
    if (!wantPng && info.mode !== "RGB") return true;
    if (slot.file === rules.MUTE_WATERMARK_FILE) return info.width > slot.fit.w || info.height > slot.fit.h;
    return info.width !== slot.fit.w || info.height !== slot.fit.h;
  } catch {
    return true;
  }
}

async function addImageToSlot(slot, file) {
  let bytes = await readBytes(file);
  if (needsFit(bytes, slot)) {
    try {
      bytes = await fitImage(bytes, file.name, slot.fit);
      toast(`Converted ${file.name} to ${slot.spec.split(",")[0]} ${slot.fit.w}×${slot.fit.h}`, "success");
    } catch (err) {
      toast(`${file.name}: ${err.message}`, "error");
      return;
    }
  }
  setFile(slot.file, bytes);
  changed({ rerender: true });
}

let previewUrls = [];

function thumb(fname, bytes) {
  const url = objectUrl(bytes, fname);
  previewUrls.push(url);
  return h("img", { src: url, alt: "", class: "thumb-img" });
}

function imageSlotCard(slot) {
  const files = build().theme.files;
  const bytes = files[slot.file];
  const status = fileStatus(slot.file);
  const issues = fileIssues(slot.file);
  const canFix = bytes && issues.length && needsFit(bytes, slot);
  const fromBase = state.base && slot.file in state.base.files;
  return h("section", { class: "card slot" },
    h("div", { class: `thumb ${slot.fit.type === "image/png" ? "checker" : ""}` },
      bytes ? thumb(slot.file, bytes) : h("span", { class: "muted small" }, "Not included")),
    h("div", { class: "slot-body" },
      h("div", { class: "slot-head" }, h("h3", {}, slot.title), h("span", { class: `badge ${status.replace(/\s/g, "-").toLowerCase()}` }, status)),
      h("p", { class: "muted" }, slot.help),
      h("p", { class: "small" }, h("code", {}, slot.file), " · ", slot.spec),
      issueList(issues),
      bytes && rules.WATERMARK_FILES.has(slot.file) && current().disable_watermark_icon === true
        ? h("div", { class: "notice" },
          h("span", {}, "This logo won't be shown: the watermark is hidden by your current settings (", h("code", {}, "disable_watermark_icon"), ")."),
          h("button", {
            type: "button", class: "btn primary",
            onclick: () => { state.edits.set(["disable_watermark_icon"], false); toast("Watermark logo switched on", "success"); changed({ rerender: true }); },
          }, "Show my logo"))
        : null,
      h("div", { class: "row" },
        h("button", {
          type: "button", class: "btn",
          onclick: async () => { const [f] = await pickFiles({ accept: "image/*" }); if (f) addImageToSlot(slot, f); },
        }, bytes ? "Replace…" : "Upload…"),
        canFix ? h("button", {
          type: "button", class: "btn primary",
          onclick: async () => {
            try {
              setFile(slot.file, await fitImage(bytes, slot.file, slot.fit));
              toast(`Fixed ${slot.file}`, "success");
              changed({ rerender: true });
            } catch (err) { toast(err.message, "error"); }
          },
        }, "Fix automatically") : null,
        bytes ? h("button", { type: "button", class: "btn subtle", onclick: () => { removeFile(slot.file); changed({ rerender: true }); } }, "Remove") : null,
        fromBase && (status === "Replaced" || status === "Removed")
          ? h("button", { type: "button", class: "btn subtle", onclick: () => { restoreFile(slot.file); changed({ rerender: true }); } }, "Restore original") : null)));
}

RENDERERS.images = () => {
  previewUrls.forEach((u) => URL.revokeObjectURL(u));
  previewUrls = [];
  const slotFiles = new Set(catalog.IMAGE_SLOTS.map((s) => s.file));
  const files = build().theme.files;
  const others = [...new Set([...Object.keys(files), ...state.removedFiles])]
    .filter((f) => f !== rules.THEMECONFIG && !slotFiles.has(f) && !rules.BASE_AUDIO_FILES.has(f))
    .sort();
  return h("div", {},
    h("h1", {}, "Images"),
    h("p", { class: "lead" }, "Upload your logos and backgrounds. Images in the wrong size or format are converted automatically (backgrounds are cropped to fill 1920×1080, logos are fitted inside 200×100)."),
    h("div", { class: "slot-grid" }, catalog.IMAGE_SLOTS.map(imageSlotCard)),
    section("Other theme files", "Splash screen icons (icon_*.svg), extra backgrounds (background_*.jpg), custom layouts (custom_layout_*.json) and other files in the theme.",
      h("button", {
        type: "button", class: "btn",
        onclick: async () => {
          const picked = await pickFiles({ accept: ".svg,.jpg,.jpeg,.png,.json,.wav", multiple: true });
          for (const f of picked) setFile(f.name, await readBytes(f));
          if (picked.length) { toast(`Added ${picked.length} file(s)`, "success"); changed({ rerender: true }); }
        },
      }, "Add files…"),
      others.length ? h("table", { class: "files" },
        h("thead", {}, h("tr", {}, h("th", {}, "File"), h("th", {}, "Size"), h("th", {}, "Status"), h("th", {}))),
        h("tbody", {}, others.map((f) => {
          const status = fileStatus(f);
          const issues = fileIssues(f);
          return h("tr", {},
            h("td", {}, h("div", { class: "file-cell" }, /\.(svg|png|jpe?g)$/i.test(f) && files[f] ? h("span", { class: "mini-thumb checker" }, thumb(f, files[f])) : null, h("code", {}, f)), issueList(issues)),
            h("td", {}, files[f] ? fmtSize(files[f].length) : "—"),
            h("td", {}, status),
            h("td", { class: "actions" },
              files[f] ? h("button", { type: "button", class: "btn subtle", onclick: () => { removeFile(f); changed({ rerender: true }); } }, "Remove")
                : h("button", { type: "button", class: "btn subtle", onclick: () => { restoreFile(f); changed({ rerender: true }); } }, "Restore")));
        }))) : h("p", { class: "muted small" }, "No other files.")),
  );
};

// -- Step 5: Voice prompts ----------------------------------------------------------

const player = new Audio();
let playerUrl = null;

function play(bytes) {
  if (playerUrl) URL.revokeObjectURL(playerUrl);
  playerUrl = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
  player.src = playerUrl;
  player.play().catch((err) => toast(`Can't play audio: ${err.message}`, "error"));
}

async function addAudio(prompt, fileOrBytes, sourceName) {
  const bytes = fileOrBytes instanceof Uint8Array ? fileOrBytes : await readBytes(fileOrBytes);
  try {
    const result = await toInfinityWav(bytes);
    setFile(prompt, result.bytes);
    return result.converted;
  } catch (err) {
    toast(`${sourceName}: ${err.message}`, "error");
    return null;
  }
}

const PROMPT_KEYS = (() => {
  const map = new Map();
  for (const f of rules.BASE_AUDIO_FILES) {
    const s = stem(f).toLowerCase();
    map.set(s, f);
    map.set(s.replace(/_48khz_mono$/, ""), f);
  }
  return map;
})();

async function bulkAddAudio() {
  const picked = await pickFiles({ accept: AUDIO_SOURCE_EXTENSIONS.join(",") + ",audio/*", multiple: true });
  if (!picked.length) return;
  let added = 0;
  const unmatched = [];
  for (const f of picked) {
    const prompt = PROMPT_KEYS.get(stem(f.name).toLowerCase());
    if (!prompt) { unmatched.push(f.name); continue; }
    if ((await addAudio(prompt, f, f.name)) !== null) added++;
  }
  if (added) toast(`Added ${added} voice prompt(s)`, "success");
  if (unmatched.length) toast(`No matching prompt for: ${unmatched.join(", ")}`, "error");
  changed({ rerender: true });
}

async function toggleRecording(prompt) {
  if (state.recording) {
    const rec = state.recording;
    rec.recorder.stop();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    toast("Recording isn't supported in this browser.", "error");
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    const chunks = [];
    recorder.addEventListener("dataavailable", (e) => chunks.push(e.data));
    recorder.addEventListener("stop", async () => {
      stream.getTracks().forEach((t) => t.stop());
      state.recording = null;
      const blob = new Blob(chunks, { type: recorder.mimeType });
      const ok = await addAudio(prompt, new Uint8Array(await blob.arrayBuffer()), "Recording");
      if (ok !== null) toast("Recording saved", "success");
      changed({ rerender: true });
    });
    state.recording = { file: prompt, recorder, stream };
    recorder.start();
    renderMain();
  } catch (err) {
    toast(`Microphone not available: ${err.message}`, "error");
  }
}

function promptRow(prompt, description) {
  const bytes = build().theme.files[prompt];
  const status = fileStatus(prompt);
  const issues = fileIssues(prompt);
  const recordingThis = state.recording?.file === prompt;
  const fromBase = state.base && prompt in state.base.files;
  const dur = bytes ? wavDuration(bytes) : null;
  const def = catalog.DEFAULT_PROMPTS[prompt] ?? {};
  const wording = def.silent
    ? h("span", { class: "prompt-default muted" }, "Silent by default. Add audio to play something here.")
    : def.text?.startsWith("(")
      ? h("span", { class: "prompt-default muted" }, `Default: ${def.text.slice(1, -1)}`)
      : def.text ? h("q", { class: "prompt-default", title: "What Infinity's default prompt says" }, def.text) : null;
  return h("div", { class: `prompt ${bytes ? "custom" : ""}` },
    h("div", { class: "prompt-text" },
      h("strong", {}, description),
      wording,
      def.only ? h("span", { class: "prompt-only" }, catalog.GATEWAY_ONLY[def.only]) : null,
      h("code", { class: "key" }, prompt),
      issueList(issues)),
    h("span", { class: "prompt-status" }, status === "Infinity default" ? h("span", { class: "muted" }, def.silent ? "Silent" : "Default voice") : `${status}${dur ? ` · ${dur.toFixed(1)} s` : ""}`),
    h("div", { class: "row" },
      bytes ? h("button", { type: "button", class: "icon-btn", title: "Play", "aria-label": `Play ${description}`, onclick: () => play(bytes) }, "▶") : null,
      h("button", {
        type: "button", class: "btn",
        onclick: async () => {
          const [f] = await pickFiles({ accept: AUDIO_SOURCE_EXTENSIONS.join(",") + ",audio/*" });
          if (!f) return;
          const converted = await addAudio(prompt, f, f.name);
          if (converted !== null) toast(converted ? `Converted ${f.name} to 48 kHz mono WAV` : `Added ${f.name}`, "success");
          changed({ rerender: true });
        },
      }, bytes ? "Replace…" : "Upload…"),
      h("button", {
        type: "button", class: `btn ${recordingThis ? "danger recording" : ""}`,
        disabled: Boolean(state.recording) && !recordingThis,
        onclick: () => toggleRecording(prompt),
      }, recordingThis ? "■ Stop" : "● Record"),
      bytes ? h("button", { type: "button", class: "btn subtle", onclick: () => { removeFile(prompt); changed({ rerender: true }); } }, "Remove") : null,
      fromBase && (status === "Replaced" || status === "Removed")
        ? h("button", { type: "button", class: "btn subtle", onclick: () => { restoreFile(prompt); changed({ rerender: true }); } }, "Restore") : null));
}

RENDERERS.voice = () => h("div", {},
  h("h1", {}, "Voice prompts"),
  h("p", { class: "lead" }, "Replace any of Infinity's spoken prompts with your own voice, language or wording. Upload MP3, WAV, M4A and more, or record straight from your microphone. Audio is converted to the format Infinity needs (16-bit mono 48 kHz WAV) on your computer."),
  section("Add several at once", "Name each file after the prompt it replaces, for example conf-getpin.mp3 or conf-getpin_48kHz_mono.wav, and add them together.",
    h("button", { type: "button", class: "btn", onclick: bulkAddAudio }, "Add audio files…")),
  catalog.AUDIO_GROUPS.map((g) => {
    const prompts = Object.entries(g.prompts).filter(([f]) => ok("audio", f));
    const hidden = Object.entries(g.prompts).filter(([f]) => !ok("audio", f)).map(([f, d]) => [d, rules.minVersion("audio", f)]);
    if (!prompts.length && !hidden.length) return null;
    return section(g.title, null,
      h("div", { class: "prompts" }, prompts.map(([f, d]) => promptRow(f, d))),
      hiddenNote(hidden));
  }),
);

// -- Step 6: Review ----------------------------------------------------------------

function saveBytes(bytes, filename) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
  const a = h("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast(`Downloaded ${filename}`, "success");
}

async function download() {
  const { theme } = build();
  try {
    saveBytes(await toZip(theme), `${safeFileName(theme.name)}.zip`);
    state.dirty = false;
  } catch (err) {
    toast(`Could not create the ZIP: ${err.message}`, "error");
  }
}

/** The branding portal ZIP, handed back unchanged for the web app. */
function downloadBranding() {
  saveBytes(state.branding.bytes, state.branding.fileName);
}

RENDERERS.review = () => {
  const { theme, report, log } = build();
  const names = Object.keys(theme.files).sort();
  const total = names.reduce((n, f) => n + theme.files[f].length, 0);
  const blocked = report.errors.length > 0 && !state.allowErrors;
  const sortedIssues = [...report.errors, ...report.warnings];
  const both = Boolean(state.branding);
  return h("div", {},
    h("h1", {}, "Review & download"),
    h("section", { class: `card status ${report.errors.length ? "bad" : "good"}` },
      h("h2", {}, report.errors.length
        ? `${report.errors.length} problem${report.errors.length === 1 ? "" : "s"} to fix before uploading`
        : both ? "Your packages are ready" : "Your theme is ready"),
      h("p", {}, `Infinity theme: ${names.length} files · ${fmtSize(total)}`, report.warnings.length ? ` · ${report.warnings.length} warning(s) worth a look` : ""),
      both ? h("p", {}, `Web app branding: ${state.branding.fileName} · ${fmtSize(state.branding.bytes.length)} (your branding portal ZIP, unchanged)`) : null,
      h("div", { class: "row" },
        h("button", { type: "button", class: "btn primary big", disabled: blocked, onclick: download }, both ? "Download Infinity theme" : `Download ${safeFileName(theme.name)}.zip`),
        both ? h("button", { type: "button", class: "btn big", onclick: downloadBranding }, "Download web app branding") : null,
        report.errors.length ? h("label", { class: "toggle" },
          h("input", { type: "checkbox", checked: state.allowErrors, onchange: (e) => { state.allowErrors = e.target.checked; renderMain(); } }),
          " Download anyway (Infinity may reject it)") : null)),
    sortedIssues.length ? section("Checks", "Errors mean Infinity will probably reject the theme or the setting won't work. Warnings are allowed but worth checking.", issueList(sortedIssues)) : null,
    section(both ? "Upload the Infinity theme" : "Upload it to Infinity",
      both ? "The theme covers what Infinity itself shows and plays: splash screens, watermarks, indicators, banners and voice prompts, on room systems, phones and the web app." : null,
      h("ol", { class: "steps-list" },
        h("li", {}, "Sign in to the Pexip Infinity Administrator interface."),
        h("li", {}, "Go to ", h("strong", {}, "Services > Themes"), " and add a theme (or edit an existing one), give it a name, upload this ZIP and save."),
        h("li", {}, "Choose the theme on the meeting rooms (VMRs), Virtual Auditoriums or Virtual Receptions that should use it, or make it the default theme."),
        h("li", {}, "Changes reach the Conferencing Nodes in about a minute. Test on a non-production meeting room first.")),
      h("p", { class: "muted small" }, "Uploading a ZIP replaces the whole theme in Infinity, so always upload the complete theme. ", docsLink("Creating and applying themes", catalog.DOCS.creating))),
    both ? section("Upload the web app branding", "Web app branding styles the Pexip web app itself: its logo, background, colours, plugins and brand name.",
      h("ol", { class: "steps-list" },
        h("li", {}, "In the Pexip Infinity Administrator interface, open the Web App settings and upload this ZIP as web app branding."),
        h("li", {}, "Use that branding on the web app path people join from (for example ", h("code", {}, "/meet"), " or your own path)."),
        h("li", {}, "Test by joining a non-production meeting room from that path.")),
      h("p", { class: "muted small" }, "This is the same file the branding portal gave you. Theme Studio doesn't change it. To change the web app's look, edit it in the branding portal.")) : null,
    section("What was built", null, h("ul", { class: "list" }, log.map((l) => h("li", {}, l)))),
    section("Files", null, h("table", { class: "files" },
      h("thead", {}, h("tr", {}, h("th", {}, "File"), h("th", {}, "Size"))),
      h("tbody", {}, names.map((f) => h("tr", {}, h("td", {}, h("code", {}, f)), h("td", {}, fmtSize(theme.files[f].length))))))),
    section("themeconfig.json", null,
      h("button", {
        type: "button", class: "btn subtle",
        onclick: () => navigator.clipboard.writeText(utf8.decode(theme.files[rules.THEMECONFIG])).then(() => toast("Copied", "success"), () => toast("Copy failed", "error")),
      }, "Copy"),
      h("pre", { class: "code" }, utf8.decode(theme.files[rules.THEMECONFIG]))),
  );
};

// ---------------------------------------------------------------------------
// Start-up
// ---------------------------------------------------------------------------

async function init() {
  try {
    const results = await Promise.all(catalog.PROFILE_NAMES.map(async (n) => {
      const res = await fetch(`profiles/${n}.json`);
      if (!res.ok) throw new Error(`${n}: HTTP ${res.status}`);
      return [n, await res.json()];
    }));
    state.profileData = Object.fromEntries(results);
  } catch (err) {
    toast(`Couldn't load the experience profiles (${err.message}). If you opened index.html directly, run it through a web server instead (see README).`, "error");
  }
  window.addEventListener("beforeunload", (e) => {
    if (state.dirty) { e.preventDefault(); e.returnValue = ""; }
  });
  renderSidebar();
  renderMain();
}

init();
