// Infinity Theme Studio — browser wizard.
//
// Everything runs locally: files are read, converted, validated and zipped in
// the browser and never uploaded anywhere.

import * as rules from "./rules.js";
import * as catalog from "./catalog.js";
import { buildTheme, Edits, getPath } from "./build.js";
import { loadConfig, toZip, utf8 } from "./package.js";
import { inspectZip, slug } from "./branding.js";
import { customLayoutNames, customLayouts, describeJsonError, validate } from "./validate.js";
import { AUDIO_SOURCE_EXTENSIONS, toInfinityWav, wavDuration } from "./audio.js";
import { fitImage, objectUrl } from "./imaging.js";
import { sniffFormat, jpegInfo, pngInfo } from "./formats.js";
import { checkNotchSvg, makeDarkVariant, notchFile } from "./icons.js";
import { effectiveScreens, layoutScreen, screenBackground, screenIcons, screenLabels, SCREEN_H, SCREEN_W } from "./splash.js";
import { checkLayout, layoutFileName, TEMPLATES, WATERMARK_POSITIONS } from "./layouts.js";
import { FOOTER_H as MEETING_FOOTER_H, H as MEETING_H, meetingTiles, W as MEETING_W, watermarkRect } from "./meeting.js";

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
  screenDefaults: null,   // Pexip's splash screen defaults (defaults/theme_screen_defaults_v41.json)
  splashScreen: "welcome",// screen open in the Splash screens editor
  splashGuide: false,     // show the 4:3 crop guide
  meeting: {              // meeting preview scenario (never written to the theme)
    dock: true, big: false, controls: false, layout: "1:7", participants: 6, level: null,
    recording: true, streaming: false, transcribing: false, captions: false, ai: false,
    locked: false, waiting: 2, hand: true, cameraOff: false, muted: false, light: false,
  },
  layoutEdit: null,       // custom layout being edited: { file, savedName, draft, list, mode, sel, unsaved }
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

/** "Infinity default" label, with the actual default when known, e.g. "Infinity default (No)". */
function defaultLabel(value, yes = "Yes", no = "No") {
  return value === true ? `Infinity default (${yes})` : value === false ? `Infinity default (${no})` : "Infinity default";
}

/** Add an "Edit default" button that copies Infinity's default text into an empty input/textarea. */
function addEditDefault(el, def) {
  const input = el.querySelector("textarea, input[type=text]");
  if (!input || !def || input.disabled) return el;
  const btn = h("button", {
    type: "button", class: "btn subtle small-btn", title: "Copy Infinity's default text into the box to edit it",
    onclick: () => { input.value = def; input.dispatchEvent(new Event("input")); input.focus(); },
  }, "Edit default");
  const sync = () => { btn.hidden = input.value !== ""; };
  input.addEventListener("input", sync);
  sync();
  el.append(btn);
  return el;
}

function boolField({ key, label, help }) {
  const id = nextId();
  const sel = triSelect(id, current()[key], [defaultLabel(catalog.DEFAULT_CONFIG[key]), "Yes", "No"], (v) => {
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
    id, type: "number", min: 0, step: "any",
    placeholder: catalog.DEFAULT_CONFIG[key] !== undefined ? `Infinity default (${catalog.DEFAULT_CONFIG[key]})` : "Infinity default",
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
  // replaceChildren() would turn null into the text "null", so drop empty parts first.
  main.replaceChildren(...[
    RENDERERS[state.step](),
    state.branding?.palette.length
      ? h("datalist", { id: "brand-palette" }, [state.branding.baseColor, ...state.branding.palette].filter(Boolean).map((c) => h("option", { value: c.toLowerCase() })))
      : null,
    h("div", { class: "nav-buttons" },
      idx > 0 ? h("button", { type: "button", class: "btn", onclick: () => go(STEPS[idx - 1].id) }, `← ${STEPS[idx - 1].title}`) : h("span"),
      idx < STEPS.length - 1 ? h("button", { type: "button", class: "btn primary", onclick: () => go(STEPS[idx + 1].id) }, `${STEPS[idx + 1].title} →`) : h("span")),
  ].filter(Boolean));
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
  ["wording", "Splash screens"],
  ["layouts", "Custom layouts"],
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
    ["wording", "layouts", "advanced"].includes(state.settingsTab) ? null : meetingDock(),
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
      const def = catalog.DEFAULT_CONFIG[f.key];
      return addEditDefault(textField([f.key], f.label, { help: f.help, placeholder: def ?? "Infinity default" }), def);
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
    const text = ind.texts.length ? cfg[ind.texts[0].key] : undefined;
    const label = text === "" ? "" : text || ind.title;
    const hidden = ind.hide && cfg[ind.hide] === true;
    const icon = ind.notch[0];
    for (const [el, cc, dark] of [[preview, c, true], [lightPreview, c?.light_mode, false]]) {
      paintChip(el, { icon, label, colors: cc, light: !dark });
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
  const iconOnly = texts.length > 0 && texts.every((t) => current()[t.key] === "");
  const visibility = canHide ? (() => {
    const id = nextId();
    const cur = current()[ind.hide];
    const def = catalog.DEFAULT_CONFIG[ind.hide];
    const sel = triSelect(id, cur === true ? false : cur === false ? true : undefined, [defaultLabel(def === undefined ? undefined : !def, "Shown", "Hidden"), "Show", "Hide"], (v) => {
      if (v === "") state.edits.remove([ind.hide]);
      else state.edits.set([ind.hide], v === "false");
      changed();
    });
    return field("Visibility", ind.hide, sel, null, id);
  })() : null;

  return h("section", { class: "card indicator" },
    h("div", { class: "indicator-head" },
      h("div", {}, h("h3", {}, ind.title), h("p", { class: "muted" }, ind.help)),
      h("div", { class: "preview-side" },
        h("div", { class: "preview-stage", title: "Preview" }, preview, lightPreview),
        ind.notch.length ? h("button", { type: "button", class: "btn subtle small-btn", onclick: () => goToNotch(ind.notch[0]) }, "Change icon") : null)),
    h("div", { class: "fields" },
      visibility,
      texts.map((t) => {
        const def = catalog.DEFAULT_CONFIG[t.key];
        const el = textField([t.key], t.label, { max: t.max, help: t.help, placeholder: def ?? "Infinity default" });
        if (!iconOnly) addEditDefault(el, def);
        if (iconOnly) el.querySelectorAll("input, textarea").forEach((i) => { i.disabled = true; i.value = ""; i.placeholder = "Hidden (icon only)"; });
        return el;
      })),
    texts.length && ind.notch.length ? h("label", { class: "toggle" },
      h("input", {
        type: "checkbox", checked: iconOnly,
        onchange: (e) => {
          for (const t of texts) {
            if (e.target.checked) state.edits.set([t.key], "");
            else state.edits.remove([t.key]);
          }
          changed({ rerender: true });
        },
      }), " Icon only (hide text) ", h("span", { class: "pill-exp" }, "Experimental")) : null,
    iconOnly ? h("p", { class: "notice-inline" }, "Untested: Infinity's docs don't say whether empty text hides the label. Try it on a test meeting room first.") : null,
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
      banner.style.color = cssColor(cur.color, "#1a1a1a");
      banner.style.background = cssColor(cur.bgcolor, "#f2f2f2");
    };
    previewUpdaters.push(updateBanner);
    updateBanner();
    const colorInput = (prop, label) => {
      const c = parseColor(p[prop]);
      const picker = h("input", {
        type: "color", value: c?.rgb ?? (prop === "color" ? "#1a1a1a" : "#f2f2f2"), "aria-label": `${label} for level ${key}`,
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
    const defCode = Object.entries(catalog.DEFAULT_CONFIG.dtmf_conference_control_commands).find(([, c]) => c === cmd)?.[0];
    inputs[cmd] = h("input", { id, type: "text", maxlength: 2, class: "dtmf-input", value: byCommand[cmd] ?? "", placeholder: defCode ?? "—", title: defCode ? `Infinity default: ${defCode}` : "No default code", oninput: saveCommands, spellcheck: "false" });
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
            const defaults = Object.fromEntries(Object.entries(catalog.DEFAULT_CONFIG.dtmf_conference_control_commands).filter(([, c]) => ok("dtmf", c)));
            if (e.target.checked) state.edits.replace(["dtmf_conference_control_commands"], cmds ?? defaults);
            else state.edits.remove(["dtmf_conference_control_commands"]);
            changed({ rerender: true });
          },
        }), " Choose my own keypad codes"),
      custom ? h("p", { class: "muted small" }, "Two characters per command (0-9, * and #). Infinity's default codes are filled in to start with, and shown in grey when a box is empty. Leave a command blank to leave it out of your list. If you move mute away from *6 and your muted overlay image mentions the code, update the image too.") : null,
      table),
    section("Layouts available from the keypad", "Limit which layouts callers can cycle through with the change-layout codes.",
      h("label", { class: "toggle" },
        h("input", {
          type: "checkbox", checked: limit,
          onchange: (e) => {
            if (e.target.checked) state.edits.replace(["dtmf_allowed_layouts"], [...catalog.DEFAULT_CONFIG.dtmf_allowed_layouts]);
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
      limit && !customLayouts.length ? h("p", { class: "muted small" }, "Custom layouts from your theme also appear here. Design them in the ", h("button", { type: "button", class: "linklike", onclick: () => { state.settingsTab = "layouts"; renderMain({ resetScroll: true }); } }, "Custom layouts"), " tab.") : null),
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
  el.querySelector("textarea").rows = Math.max(2, def.split("\n").length);
  return addEditDefault(el, def);
}

// Splash screens: previews + wording + icons

const LABEL_NAMES = Object.fromEntries(catalog.LABEL_GROUPS.flatMap((g) => Object.entries(g.labels)));
const PREVIEW_FONTS = "Inter, 'Noto Sans', Roboto, 'Segoe UI', system-ui, sans-serif";
const fileUrls = new WeakMap();

/** URL for a theme file (images, SVGs): the theme's copy if it has one, otherwise Pexip's bundled default. */
function themeFileUrl(file, defaultsDir = "defaults/base") {
  const bytes = build().theme.files[file];
  if (!bytes) return `${defaultsDir}/${file}`;
  if (!fileUrls.has(bytes)) fileUrls.set(bytes, objectUrl(bytes, file));
  return fileUrls.get(bytes);
}

const missingUrls = new Set(); // defaults that failed to load, so redraws don't refetch them

/** <img> that turns into a labelled outline if the file isn't available. */
function previewImg(file, style = {}, { quiet = false } = {}) {
  const src = themeFileUrl(file);
  const placeholder = () => {
    if (quiet) return h("span", { hidden: true });
    const ph = h("span", { class: "img-missing", title: `${file}: default image not available` }, file.replace(/^icon_|\.(svg|jpg|png)$/g, ""));
    Object.assign(ph.style, style);
    return ph;
  };
  if (missingUrls.has(src)) return placeholder();
  return h("img", {
    src, alt: "", draggable: "false", style,
    onerror: (e) => { missingUrls.add(src); e.currentTarget.replaceWith(placeholder()); },
  });
}

/** A 1920x1080 mock-up of one splash screen, scaled to fit. */
function screenPreview(name, scale, { guide = false } = {}) {
  const outer = h("div", { class: "screen-frame", style: { width: `${SCREEN_W * scale}px`, height: `${SCREEN_H * scale}px` } });
  const draw = () => {
    if (!state.screenDefaults) { outer.replaceChildren(h("span", { class: "img-missing" }, "Preview unavailable")); return; }
    const { screens, labels } = effectiveScreens(current(), state.screenDefaults);
    const spec = screens[name] ?? {};
    const bg = screenBackground(spec);
    const stage = h("div", { class: "screen", style: { transform: `scale(${scale})`, background: bg.color ?? "linear-gradient(135deg, #3a4a6b, #1d2538)" } });
    if (bg.path) stage.append(previewImg(bg.path, { position: "absolute", inset: "0", width: "100%", height: "100%", objectFit: "cover" }, { quiet: true }));
    for (const box of layoutScreen(spec, labels)) {
      const pos = { position: "absolute", left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` };
      if (box.kind === "icon") {
        stage.append(h("div", { class: "screen-box", style: pos }, previewImg(box.path, { width: "100%", height: "100%", objectFit: "contain" })));
      } else if (box.kind === "digits") {
        stage.append(h("div", { class: "screen-box digits", style: { ...pos, gap: `${box.spacing}px` } },
          Array.from({ length: box.count }, () => previewImg(box.path, { width: `${box.digitW}px`, height: `${box.digitH}px` }))));
      } else {
        const st = box.style;
        stage.append(h("div", {
          class: "screen-text",
          style: { ...pos, fontSize: `${st.fontSize}px`, lineHeight: `${st.lineHeight}px`, letterSpacing: `${st.letterSpacing}px`, textAlign: st.align, color: st.color, fontFamily: PREVIEW_FONTS, fontWeight: /medium|bold/i.test(st.font) ? 500 : 400 },
        }, box.text));
      }
    }
    if (guide) stage.append(h("div", { class: "guide-43", title: "4:3 crop: what shows on 4:3 screens" }));
    outer.replaceChildren(stage);
  };
  previewUpdaters.push(draw);
  draw();
  return outer;
}

async function replaceSplashIcon(file) {
  const [picked] = await pickFiles({ accept: ".svg,image/svg+xml" });
  if (!picked) return;
  const text = await picked.text();
  const problems = checkNotchSvg(text);
  const errors = problems.filter((p) => p.level === "error");
  if (errors.length) { toast(`${picked.name}: ${errors[0].message}`, "error"); return; }
  setFile(file, utf8.encode(text));
  toast(`Replaced ${file}`, "success");
  changed({ rerender: true });
}

function splashEditor(name) {
  const { screens } = effectiveScreens(current(), state.screenDefaults);
  const spec = screens[name] ?? {};
  const labels = [...new Set(screenLabels(spec))];
  const icons = screenIcons(spec);
  const bg = screenBackground(spec);
  const custom = Boolean(current().splash_screens?.screens?.[name]);
  return h("section", { class: "card splash-editor" },
    h("div", { class: "slot-head" },
      h("h3", {}, catalog.SCREEN_NAMES[name] ?? name, " ", h("code", { class: "key" }, name)),
      h("label", { class: "toggle small" },
        h("input", { type: "checkbox", checked: state.splashGuide, onchange: (e) => { state.splashGuide = e.target.checked; renderMain(); } }),
        " Show 4:3 crop guide")),
    custom ? h("p", { class: "muted small" }, "This screen's layout comes from your theme.") : null,
    h("div", { class: "splash-editor-body" },
      screenPreview(name, 0.34, { guide: state.splashGuide }),
      h("div", { class: "splash-editor-side" },
        labels.length ? h("div", {}, h("h4", {}, "Text on this screen"),
          labels.map((key) => labelField(key, LABEL_NAMES[key] ?? key))) : h("p", { class: "muted small" }, "No text on this screen."),
        icons.length ? h("div", {}, h("h4", {}, "Icons"),
          icons.map((file) => h("div", { class: "icon-row" },
            h("span", { class: "icon-thumb" }, previewImg(file, { maxWidth: "100%", maxHeight: "100%" })),
            h("code", { class: "key" }, file),
            h("span", { class: "muted small" }, file in state.files ? "Custom" : file in build().theme.files ? "From theme ZIP" : catalog.BLANK_DEFAULT_ICONS.has(file) ? "Default (blank: no icon shown)" : "Default"),
            h("button", { type: "button", class: "btn small-btn", onclick: () => replaceSplashIcon(file) }, "Replace…"),
            file in state.files ? h("button", { type: "button", class: "btn subtle small-btn", onclick: () => { removeFile(file); changed({ rerender: true }); } }, "Use default") : null))) : null,
        h("div", {}, h("h4", {}, "Background"),
          bg.path
            ? h("p", { class: "small" }, h("code", {}, bg.path), ` · ${bg.path in build().theme.files ? "from your theme" : "Infinity default"} · `,
              h("button", { type: "button", class: "btn subtle small-btn", onclick: () => go("images") }, "Change in Images"))
            : h("p", { class: "small" }, "Solid colour: ", h("span", { class: "dot", style: { background: bg.color } }))))),
    h("p", { class: "muted small" }, "Preview is approximate: fonts and exact spacing may differ slightly on Infinity. {conference_name} and {conference_id} are shown with sample values."),
  );
}

SETTINGS_PANES.wording = () => {
  const labels = current().splash_screens?.labels ?? {};
  const customKeys = Object.keys(labels).filter((k) => !rules.DEFAULT_LABELS.has(k));
  if (!state.screenDefaults) {
    return section("Splash screens", "Previews are unavailable because the screen defaults couldn't be loaded.",
      catalog.LABEL_GROUPS.map((g) => h("div", { class: "fields two" }, Object.entries(g.labels).map(([key, label]) => labelField(key, label)))));
  }
  return h("div", {},
    h("p", { class: "muted" }, "These are the screens people see while joining, waiting, or when something goes wrong. Pick a screen to preview it and change its text, icons and background. Previews update as you type."),
    splashEditor(state.splashScreen),
    catalog.SCREEN_GROUPS.map((g) => section(g.title, null, h("div", { class: "screen-grid" },
      g.screens.map((name) => h("button", {
        type: "button", class: `screen-tile ${state.splashScreen === name ? "active" : ""}`, "aria-pressed": String(state.splashScreen === name),
        onclick: () => { state.splashScreen = name; renderMain(); window.scrollTo({ top: 0, behavior: "smooth" }); },
      }, screenPreview(name, 0.13), h("span", { class: "screen-name" }, catalog.SCREEN_NAMES[name] ?? name)))))),
    customKeys.length ? section("Custom labels in your theme", "Extra labels defined by your branding ZIP's splash screen layouts.",
      h("div", { class: "fields two" }, customKeys.map((key) => textField(["splash_screens", "labels", key], key, { multiline: true })))) : null,
  );
};

// In-meeting preview

const MEETING_NAMES = ["Alex", "Sam", "Priya", "Jordan", "Mei", "Lars", "Ana", "Kofi", "Noor", "Tom", "Ines", "Ravi", "Zoe",
  "Omar", "Elin", "Luca", "Hana", "Ben", "Maya", "Femi", "Ida", "Yuki", "Leo", "Sara", "Nils", "Ada"];
const TILE_HUES = [212, 25, 160, 280, 340, 95, 190, 50];
const SILHOUETTE = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"><circle cx="80" cy="36" r="17" fill="#fff" fill-opacity=".28"/><path d="M46 90c2-22 16-33 34-33s32 11 34 33z" fill="#fff" fill-opacity=".28"/></svg>')}`;
const MEETING_TOGGLES = [
  ["recording", "Recording"], ["streaming", "Streaming"], ["transcribing", "Transcribing"], ["captions", "Live captions"],
  ["ai", "AI"], ["locked", "Meeting locked"], ["hand", "Raised hand"], ["cameraOff", "Someone's camera is off"],
  ["muted", "You're muted by an admin"], ["light", "Light indicator bar"],
];

/** Indicator wording as Infinity would show it: the theme's text, else Infinity's default. "" = icon only. */
function indicatorText(key, fallback) {
  const v = current()[key];
  if (v === "") return "";
  return typeof v === "string" ? v : catalog.DEFAULT_CONFIG[key] ?? fallback;
}

/** Fill an indicator chip (icon + text) with its colours. Shared by the Indicators cards and the meeting preview. */
function paintChip(el, { icon, label, colors, light = false }) {
  const fb = light ? DEFAULT_LIGHT : DEFAULT_INDICATOR;
  el.replaceChildren(...[
    icon ? h("img", { src: notchSrc(notchFile(icon, !light)), alt: "", class: "chip-icon" }) : null,
    label ? h("span", {}, label) : null,
  ].filter(Boolean));
  el.style.background = cssColor(colors?.background ?? fb.background);
  el.style.borderColor = cssColor(colors?.border ?? fb.border);
  el.style.color = cssColor(colors?.text ?? fb.text);
}

/** Items in the indicator bar for the current scenario. */
function meetingIndicators(sc, avatars) {
  const cfg = current();
  const byId = Object.fromEntries(catalog.INDICATORS.map((i) => [i.id, i]));
  const shown = (id) => !(byId[id].hide && cfg[byId[id].hide] === true);
  const colors = (id) => cfg.indicator_color_config?.[byId[id].color];
  const items = [{ icon: "participants", label: String(sc.participants) }];
  if (sc.cameraOff && !avatars) items.push({ icon: "video_muted", label: "1" });
  if (sc.hand) items.push({ icon: "raised_hand", label: "1", colors: colors("hand_raised") });
  if (sc.locked && shown("locked")) {
    const label = sc.waiting > 0
      ? indicatorText("conference_locked_indicator_n_waiting_text", "{number_of_waiting_participants} waiting").replaceAll("{number_of_waiting_participants}", String(sc.waiting))
      : indicatorText("conference_locked_indicator_text", "Conference locked");
    items.push({ icon: "conference_locked", label, colors: colors("locked") });
  }
  for (const [flag, id, key, icon] of [
    ["recording", "recording", "recording_indicator_text", "recording"],
    ["streaming", "streaming", "streaming_indicator_text", "streaming"],
    ["transcribing", "transcribing", "transcribing_indicator_text", "transcribing"],
    ["captions", "captions", "live_captions_on_indicator_text", "live_captions"],
    ["ai", "ai", "ai_indicator_text", "ai"],
  ]) {
    if (sc[flag] && shown(id)) items.push({ icon, label: indicatorText(key, byId[id].title), colors: colors(id) });
  }
  return items;
}

const initials = (name) => name.slice(0, 2).toUpperCase();

/** A 1920x1080 mock-up of a meeting using the theme, scaled to fit. Redraws on every change. */
function meetingPreview(scale) {
  const outer = h("div", { class: "screen-frame meeting-frame", style: { width: `${MEETING_W * scale}px`, height: `${MEETING_H * scale}px` } });
  const draw = () => {
    const cfg = current();
    const sc = state.meeting;
    const customs = customLayouts(build().theme);
    const custom = customs[sc.layout];
    const avatars = cfg.enable_avatars_in_mix === true;
    const light = custom?.notch_color ? custom.notch_color === "light" : sc.light;
    const videoCount = Math.max(1, sc.participants - (sc.cameraOff && !avatars ? 1 : 0));
    const tiles = meetingTiles(sc.layout, videoCount, customs);
    const stage = h("div", { class: "screen meeting", style: { transform: `scale(${scale})`, background: custom?.background_color ?? "#0b0b0b" } });
    const speaker = cfg.indicator_color_config?.speaker;
    tiles.forEach((t, i) => {
      const name = MEETING_NAMES[i % MEETING_NAMES.length];
      const isAvatar = avatars && sc.cameraOff && i === tiles.length - 1;
      const hue = TILE_HUES[i % TILE_HUES.length];
      const tile = h("div", {
        class: "m-tile",
        style: { left: `${t.x}px`, top: `${t.y}px`, width: `${t.w}px`, height: `${t.h}px`, background: `linear-gradient(160deg, hsl(${hue} 22% 40%), hsl(${hue} 28% 16%))` },
      });
      if (isAvatar) {
        const size = Math.min(t.w, t.h) * 0.42;
        tile.append(
          previewImg("background_avatar_in_mix.jpg", { position: "absolute", inset: "0", width: "100%", height: "100%", objectFit: "cover" }, { quiet: true }),
          h("div", { class: "m-avatar", style: { width: `${size}px`, height: `${size}px`, fontSize: `${size * 0.38}px`, background: cssColor(cfg.avatar_in_mix_shape_color, "rgba(220, 220, 220, .2)"), color: cssColor(cfg.avatar_in_mix_text_color, "#f7f7f7") } }, initials(name)));
      } else {
        tile.append(h("img", { src: SILHOUETTE, alt: "", class: "m-silhouette" }));
      }
      tile.append(h("span", { class: "m-name", style: { fontSize: `${Math.max(20, Math.min(30, t.h * 0.07))}px` } }, name));
      if (t.main && speaker?.border) tile.style.boxShadow = `inset 0 0 0 6px ${cssColor(speaker.border)}`;
      stage.append(tile);
    });

    if (cfg.disable_watermark_icon !== true) {
      const r = watermarkRect(tiles, custom?.watermark_position);
      stage.append(previewImg("watermark_icon.png", { position: "absolute", left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, objectFit: "contain", objectPosition: "left top" }, { quiet: true }));
    }
    if (sc.layout === "1:33") {
      stage.append(h("div", { class: "m-footer", style: { height: `${MEETING_FOOTER_H}px` } },
        previewImg("watermark_footer_icon.png", { width: "200px", height: "100px", objectFit: "contain" }, { quiet: true })));
    }

    // Top of the screen: classification banner, then the indicator bar, then the muted overlay.
    const top = h("div", { class: "m-top" });
    const cls = cfg.classification;
    if (cls?.levels && typeof cls.levels === "object") {
      const level = cls.levels[sc.level ?? cls.default] ?? Object.values(cls.levels)[0];
      const p = levelParts(level);
      if (p.text) top.append(h("div", { class: "m-banner", style: { color: cssColor(p.color, "#1a1a1a"), background: cssColor(p.bgcolor, "#f2f2f2") } }, p.text));
    }
    const bar = h("div", { class: `m-notch ${light ? "light" : ""}` });
    for (const item of meetingIndicators(sc, avatars)) {
      const chip = h("span", { class: "m-chip" });
      paintChip(chip, { ...item, colors: light ? item.colors?.light_mode : item.colors, light });
      bar.append(chip);
    }
    top.append(bar);
    const muteHidden = (cfg.disable_watermark_mute_icon ?? catalog.DEFAULT_CONFIG.disable_watermark_mute_icon) !== false;
    if (sc.muted && !muteHidden) top.append(previewImg("watermark_mute_icon.png", { width: "200px", height: "100px", objectFit: "contain" }, { quiet: true }));
    stage.append(top);

    if (cfg.clock_data && ok("setting", "clock_data")) stage.append(h("div", { class: "m-clock" }, clockSample(cfg.clock_data)));
    outer.replaceChildren(stage);
  };
  previewUpdaters.push(draw);
  draw();
  return outer;
}

/** Scenario controls for the meeting preview. They only change the preview, never the theme. */
function meetingControls() {
  const sc = state.meeting;
  const cfg = current();
  const customs = customLayouts(build().theme);
  const refresh = () => previewUpdaters.forEach((fn) => fn());
  const layoutId = nextId();
  const options = [
    ...Object.entries(catalog.LAYOUT_LABELS).map(([k, label]) => [k, label]),
    ...Object.keys(customs).filter((k) => !(k in catalog.LAYOUT_LABELS)).map((k) => [k, `Custom: ${k}`]),
  ];
  const count = h("output", { class: "m-count" }, String(sc.participants));
  const waiting = h("input", {
    type: "number", min: 0, max: 99, value: sc.waiting, disabled: !sc.locked, class: "m-waiting", "aria-label": "People waiting",
    oninput: (e) => { sc.waiting = Math.max(0, Number(e.target.value) || 0); refresh(); },
  });
  const cls = cfg.classification?.levels && typeof cfg.classification.levels === "object" ? cfg.classification : null;
  const customLight = customs[sc.layout]?.notch_color;
  const muteHidden = (cfg.disable_watermark_mute_icon ?? catalog.DEFAULT_CONFIG.disable_watermark_mute_icon) !== false;
  return h("div", { class: "m-controls" },
    h("label", { for: layoutId }, "Layout ",
      h("select", { id: layoutId, value: sc.layout, onchange: (e) => { sc.layout = e.target.value; renderMain(); } },
        options.map(([k, label]) => h("option", { value: k }, label)))),
    h("label", {}, "People ",
      h("input", { type: "range", min: 1, max: 26, value: sc.participants, oninput: (e) => { sc.participants = Number(e.target.value); count.textContent = e.target.value; refresh(); } }),
      count),
    cls ? h("label", {}, "Banner ",
      h("select", { value: String(sc.level ?? cls.default), onchange: (e) => { sc.level = e.target.value; refresh(); } },
        Object.entries(cls.levels).map(([k, v]) => h("option", { value: k }, levelParts(v).text || `Level ${k}`)))) : null,
    h("div", { class: "m-toggles" }, MEETING_TOGGLES.map(([key, label]) => {
      const disabled = key === "light" && Boolean(customLight);
      return h("label", { class: "check-item", title: disabled ? `This layout sets notch_color: ${customLight}` : key === "muted" && muteHidden ? "The muted overlay is hidden (Settings → General)" : null },
        h("input", {
          type: "checkbox", checked: key === "light" && customLight ? customLight === "light" : sc[key], disabled,
          onchange: (e) => { sc[key] = e.target.checked; waiting.disabled = !sc.locked; refresh(); },
        }),
        ` ${label}`,
        key === "locked" ? h("span", { class: "muted small" }, " · waiting ", waiting) : null,
        key === "muted" && muteHidden ? h("span", { class: "muted small" }, " (overlay hidden)") : null);
    })));
}

/** Floating preview shown on the Settings and Images steps. */
function meetingDock() {
  const sc = state.meeting;
  if (!sc.dock) {
    return h("button", { type: "button", class: "meeting-dock-tab", onclick: () => { sc.dock = true; renderMain(); } }, "Show meeting preview");
  }
  return h("aside", { class: `meeting-dock ${sc.big ? "big" : ""}`, "aria-label": "Meeting preview" },
    h("div", { class: "meeting-dock-head" },
      h("strong", {}, "Meeting preview"),
      h("span", { class: "muted small" }, "approximate"),
      h("span", { class: "spacer" }),
      h("button", { type: "button", class: `btn subtle small-btn ${sc.controls ? "active" : ""}`, "aria-expanded": String(sc.controls), onclick: () => { sc.controls = !sc.controls; renderMain(); } }, "Scenario"),
      h("button", { type: "button", class: "icon-btn", title: sc.big ? "Smaller" : "Bigger", onclick: () => { sc.big = !sc.big; renderMain(); } }, sc.big ? "–" : "+"),
      h("button", { type: "button", class: "icon-btn", title: "Hide preview", onclick: () => { sc.dock = false; renderMain(); } }, "✕")),
    sc.controls ? meetingControls() : null,
    meetingPreview(sc.big ? 0.3 : 0.2));
}

// Custom layouts

const clone = (v) => JSON.parse(JSON.stringify(v));

function uniqueLayoutName(base, taken) {
  let name = base.slice(0, 50);
  for (let i = 2; taken.has(name) || rules.BUILTIN_LAYOUTS.has(name); i++) name = `${base.slice(0, 46)}_${i}`;
  return name;
}

/** Rename / add / remove a layout name in dtmf_allowed_layouts. */
function updateAllowedLayouts(oldName, newName) {
  const list = current().dtmf_allowed_layouts;
  if (!Array.isArray(list) || !list.includes(oldName)) return;
  state.edits.replace(["dtmf_allowed_layouts"], newName ? list.map((l) => (l === oldName ? newName : l)) : list.filter((l) => l !== oldName));
}

function openLayout(layout, file) {
  const { $file, ...draft } = clone(layout);
  state.layoutEdit = { file, savedName: file ? draft.name : null, draft, list: "modes", mode: 0, sel: null, unsaved: false };
}

/** Write the draft into the theme if it has no errors. */
function saveLayoutDraft() {
  const ed = state.layoutEdit;
  const d = ed.draft;
  const file = layoutFileName(d.name);
  const clash = file !== ed.file && typeof d.name === "string" && file in build().theme.files;
  if (clash || checkLayout(d).some((i) => i.level === "error")) { ed.unsaved = true; return false; }
  if (ed.file && ed.file !== file) removeFile(ed.file);
  if (ed.savedName && ed.savedName !== d.name) updateAllowedLayouts(ed.savedName, d.name);
  setFile(file, utf8.encode(`${JSON.stringify(d, null, 2)}\n`));
  Object.assign(ed, { file, savedName: d.name, unsaved: false });
  return true;
}

function layoutChanged() {
  saveLayoutDraft();
  changed({ rerender: true });
}

const modeRange = (m) => {
  const c = m?.constraints ?? {};
  return c.min_slots === c.max_slots ? `${c.min_slots ?? "?"}` : `${c.min_slots ?? "?"}–${c.max_slots ?? "?"}`;
};

/** Keep max_slots equal to the number of slots (as Infinity requires) and min ≤ max. */
function syncConstraints(m) {
  m.constraints ??= { min_slots: 1, max_slots: 1 };
  m.constraints.max_slots = Math.max(1, m.slots.length);
  if (m.constraints.min_slots > m.constraints.max_slots) m.constraints.min_slots = m.constraints.max_slots;
}

function layoutCanvas(m, pres, issues) {
  const ed = state.layoutEdit;
  const n = m.grid_size?.[0] ?? 1;
  const CW = 640;
  const CH = 360;
  const occupied = (x, y, w, skip = -1) => m.slots.some((s, i) => i !== skip && x < s.start_x + s.width && s.start_x < x + w && y < s.start_y + s.width && s.start_y < y + w);
  const canvas = h("div", {
    class: "layout-canvas", style: { width: `${CW}px`, height: `${CH}px`, backgroundSize: `${CW / n}px ${CH / n}px` },
    title: "Drag across empty cells to add a slot",
  });
  canvas.style.backgroundSize = `${CW / n}px ${CH / n}px`;
  const bad = new Set(issues.filter((i) => i.list === ed.list && i.mode === ed.mode && i.slot !== undefined).map((i) => i.slot));
  m.slots.forEach((s, i) => {
    canvas.append(h("button", {
      type: "button",
      class: `layout-slot ${s.is_speaker_slot ? "speaker" : ""} ${s.is_presentation_slot ? "pres" : ""} ${ed.sel === i ? "sel" : ""} ${bad.has(i) ? "bad" : ""}`,
      style: { left: `${(s.start_x * CW) / n}px`, top: `${(s.start_y * CH) / n}px`, width: `${(s.width * CW) / n}px`, height: `${(s.width * CH) / n}px` },
      title: `Slot ${i + 1}${s.is_presentation_slot ? " (presentation)" : s.is_speaker_slot ? " (speaker)" : ""}`,
      onclick: (e) => { e.stopPropagation(); ed.sel = ed.sel === i ? null : i; renderMain(); },
    }, h("span", {}, String(i + 1)), s.is_presentation_slot ? h("small", {}, "Presentation") : s.is_speaker_slot ? h("small", {}, "Speaker") : null));
  });
  // Drag to draw a square slot.
  let start = null;
  const ghost = h("div", { class: "layout-ghost", hidden: true });
  canvas.append(ghost);
  const cellAt = (e) => {
    const r = canvas.getBoundingClientRect();
    return [Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n))), Math.min(n - 1, Math.max(0, Math.floor(((e.clientY - r.top) / r.height) * n)))];
  };
  const square = ([cx, cy]) => {
    const [sx, sy] = start;
    let w = Math.max(Math.abs(cx - sx), Math.abs(cy - sy)) + 1;
    w = Math.min(w, cx >= sx ? n - sx : sx + 1, cy >= sy ? n - sy : sy + 1);
    return { start_x: cx >= sx ? sx : sx - w + 1, start_y: cy >= sy ? sy : sy - w + 1, width: w };
  };
  canvas.addEventListener("pointerdown", (e) => {
    if (e.target !== canvas) return;
    const c = cellAt(e);
    if (occupied(c[0], c[1], 1)) return;
    start = c;
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!start) return;
    const s = square(cellAt(e));
    Object.assign(ghost.style, { left: `${(s.start_x * CW) / n}px`, top: `${(s.start_y * CH) / n}px`, width: `${(s.width * CW) / n}px`, height: `${(s.width * CH) / n}px` });
    ghost.classList.toggle("bad", occupied(s.start_x, s.start_y, s.width));
    ghost.hidden = false;
  });
  canvas.addEventListener("pointerup", (e) => {
    if (!start) return;
    const s = square(cellAt(e));
    start = null;
    ghost.hidden = true;
    if (occupied(s.start_x, s.start_y, s.width)) { toast("Slots can't overlap.", "error"); return; }
    if (m.slots.length >= rules.CUSTOM_LAYOUT_MAX_SLOTS) { toast(`A mode can have up to ${rules.CUSTOM_LAYOUT_MAX_SLOTS} slots.`, "error"); return; }
    const participantSlots = m.slots.filter((x) => !x.is_presentation_slot).length;
    if (pres && !m.slots.length) s.is_presentation_slot = true;
    else if (!participantSlots) s.is_speaker_slot = true;
    m.slots.push(s);
    syncConstraints(m);
    ed.sel = m.slots.length - 1;
    layoutChanged();
  });
  canvas.addEventListener("pointercancel", () => { start = null; ghost.hidden = true; });
  return canvas;
}

function slotPanel(m, pres) {
  const ed = state.layoutEdit;
  const i = ed.sel;
  const s = m.slots[i];
  if (!s) return h("p", { class: "muted small" }, "Drag across empty cells to add a slot. Slots fill in number order as people join, so put the speaker first. Click a slot to change it.");
  const move = (d) => {
    const j = i + d;
    [m.slots[i], m.slots[j]] = [m.slots[j], m.slots[i]];
    ed.sel = j;
    layoutChanged();
  };
  return h("div", { class: "slot-panel" },
    h("strong", {}, `Slot ${i + 1}`), h("span", { class: "muted small" }, ` ${s.width}×${s.width} cells at column ${s.start_x + 1}, row ${s.start_y + 1}`),
    h("div", { class: "row" },
      h("button", { type: "button", class: "btn small-btn", disabled: i === 0, onclick: () => move(-1) }, "← Earlier"),
      h("button", { type: "button", class: "btn small-btn", disabled: i === m.slots.length - 1, onclick: () => move(1) }, "Later →"),
      h("label", { class: "toggle small" }, h("input", { type: "checkbox", checked: Boolean(s.is_speaker_slot), onchange: (e) => { if (e.target.checked) s.is_speaker_slot = true; else delete s.is_speaker_slot; layoutChanged(); } }), " Speaker slot"),
      pres ? h("label", { class: "toggle small" }, h("input", { type: "checkbox", checked: Boolean(s.is_presentation_slot), onchange: (e) => { if (e.target.checked) s.is_presentation_slot = true; else delete s.is_presentation_slot; layoutChanged(); } }), " Presentation") : null,
      h("button", { type: "button", class: "btn subtle small-btn", onclick: () => { m.slots.splice(i, 1); syncConstraints(m); ed.sel = null; layoutChanged(); } }, "Delete slot")));
}

function layoutEditor() {
  const ed = state.layoutEdit;
  const d = ed.draft;
  if (ed.list === "pres_modes" && !Array.isArray(d.pres_modes)) ed.list = "modes";
  const pres = ed.list === "pres_modes";
  const modes = d[ed.list];
  ed.mode = Math.min(ed.mode, Math.max(0, modes.length - 1));
  const m = modes[ed.mode];
  const issues = checkLayout(d);
  const file = layoutFileName(d.name);
  const clash = file !== ed.file && file in build().theme.files;
  const errors = issues.filter((i) => i.level === "error");
  const nameId = nextId();
  const gridId = nextId();
  const minId = nextId();
  const padId = nextId();
  const allowed = current().dtmf_allowed_layouts;
  const inCycle = Array.isArray(allowed) && allowed.includes(d.name);
  const opt = (key, value) => { if (value === "" || value === undefined) delete d[key]; else d[key] = value; layoutChanged(); };

  return h("section", { class: "card layout-editor" },
    h("div", { class: "slot-head" },
      h("h3", {}, "Editing ", h("code", { class: "key" }, ed.file ?? file)),
      h("span", { class: `badge ${ed.unsaved || clash ? "warn" : "good"}` }, ed.unsaved || clash ? "Not saved: fix the problems below" : "Saved in your theme"),
      h("button", { type: "button", class: "btn subtle small-btn", onclick: () => { state.layoutEdit = null; renderMain(); } }, "Close")),
    h("div", { class: "fields two" },
      field("Layout name", "name", h("input", {
        id: nameId, type: "text", value: d.name ?? "", maxlength: 50, spellcheck: "false",
        onchange: (e) => { d.name = e.target.value.trim(); layoutChanged(); },
      }), "Letters, digits and _ only. This is the name you choose on a meeting room or in the API.", nameId),
      clash ? h("p", { class: "notice-inline" }, `Another layout in your theme is already called ${d.name}.`) : null),
    h("div", { class: "layout-lists" },
      h("label", { class: "toggle" }, h("input", {
        type: "checkbox", checked: Array.isArray(d.pres_modes),
        onchange: (e) => {
          if (e.target.checked) {
            d.pres_modes = [{ grid_size: [4, 4], constraints: { min_slots: 1, max_slots: 4 }, slots: [
              { start_x: 0, start_y: 0, width: 3, is_presentation_slot: true }, { start_x: 3, start_y: 0, width: 1, is_speaker_slot: true },
              { start_x: 3, start_y: 1, width: 1 }, { start_x: 3, start_y: 2, width: 1 }] }];
            ed.list = "pres_modes";
          } else {
            delete d.pres_modes;
            ed.list = "modes";
          }
          ed.mode = 0; ed.sel = null;
          layoutChanged();
        },
      }), " Different layout while someone is presenting"),
      Array.isArray(d.pres_modes) ? h("div", { class: "seg" },
        [["modes", "Normal"], ["pres_modes", "While presenting"]].map(([k, label]) => h("button", {
          type: "button", class: `seg-btn ${ed.list === k ? "active" : ""}`, "aria-pressed": String(ed.list === k),
          onclick: () => { ed.list = k; ed.mode = 0; ed.sel = null; renderMain(); },
        }, label))) : null),
    h("div", { class: "tabs mode-tabs" },
      modes.map((mm, i) => h("button", {
        type: "button", class: `tab ${ed.mode === i ? "active" : ""}`,
        onclick: () => { ed.mode = i; ed.sel = null; renderMain(); },
      }, `${modeRange(mm)} ${mm?.constraints?.max_slots === 1 ? "person" : "people"}`)),
      h("button", {
        type: "button", class: "tab", title: "Add a layout for more people",
        onclick: () => {
          const last = modes.at(-1);
          const next = Math.min(rules.CUSTOM_LAYOUT_MAX_SLOTS, (last?.constraints?.max_slots ?? 0) + 1);
          modes.push({ grid_size: [...(last?.grid_size ?? [4, 4])], constraints: { min_slots: next, max_slots: next }, slots: [] });
          ed.mode = modes.length - 1; ed.sel = null;
          layoutChanged();
        },
      }, "+ Add")),
    m ? h("div", { class: "layout-body" },
      h("div", {},
        layoutCanvas(m, pres, issues),
        slotPanel(m, pres)),
      h("div", { class: "layout-side" },
        field("Grid", "grid_size", h("select", {
          id: gridId, value: String(m.grid_size?.[0] ?? 4),
          onchange: (e) => {
            const g = Number(e.target.value);
            const before = m.slots.length;
            m.grid_size = [g, g];
            m.slots = m.slots.filter((s) => s.start_x + s.width <= g && s.start_y + s.width <= g);
            if (m.slots.length < before) toast(`${before - m.slots.length} slot(s) didn't fit and were removed.`, "info");
            syncConstraints(m); ed.sel = null;
            layoutChanged();
          },
        }, Array.from({ length: rules.CUSTOM_LAYOUT_MAX_GRID }, (_, i) => h("option", { value: String(i + 1) }, `${i + 1} × ${i + 1}`))), null, gridId),
        field("Used from", "constraints.min_slots", h("input", {
          id: minId, type: "number", min: 1, max: m.constraints?.max_slots ?? 1, value: m.constraints?.min_slots ?? 1,
          onchange: (e) => { m.constraints.min_slots = Math.max(1, Math.min(Number(e.target.value) || 1, m.constraints.max_slots)); layoutChanged(); },
        }), `people, up to ${m.constraints?.max_slots ?? "?"} (one per slot${pres ? ", including the presentation" : ""}).`, minId),
        field("Gap between slots", "slot_padding", h("input", {
          id: padId, type: "number", min: 0, max: 0.1, step: 0.001, value: m.slot_padding ?? "", placeholder: "0.001 (default)",
          onchange: (e) => { if (e.target.value === "") delete m.slot_padding; else m.slot_padding = Number(e.target.value); layoutChanged(); },
        }), "0 to 0.1", padId),
        modes.length > 1 ? h("button", { type: "button", class: "btn subtle small-btn", onclick: () => { modes.splice(ed.mode, 1); ed.mode = 0; ed.sel = null; layoutChanged(); } }, "Remove this mode") : null)) : null,
    errors.length || issues.length ? h("div", { class: "issues-inline" }, issues.map((i) => h("div", { class: `issue ${i.level}` },
      h("span", { class: "issue-level" }, i.level === "error" ? "Error" : "Warning"), h("span", { class: "issue-msg" }, i.message)))) : null,
    h("h4", {}, "Options"),
    h("div", { class: "fields three" },
      field("Background colour", "background_color", h("span", { class: "row" },
        h("input", { type: "color", value: d.background_color ?? "#000000", onchange: (e) => opt("background_color", e.target.value), "aria-label": "Background colour" }),
        d.background_color ? h("button", { type: "button", class: "icon-btn", title: "Use default", onclick: () => opt("background_color") }, "✕") : h("span", { class: "muted small" }, "Default")), "Shows in cells with no slot."),
      field("Watermark", "watermark_position", h("select", { value: d.watermark_position ?? "", onchange: (e) => opt("watermark_position", e.target.value) },
        h("option", { value: "" }, "On the main speaker (default)"), WATERMARK_POSITIONS.map((p) => h("option", { value: p }, p.replace("-", " "))))),
      field("Indicator bar", "notch_color", h("select", { value: d.notch_color ?? "", onchange: (e) => opt("notch_color", e.target.value) },
        h("option", { value: "" }, "Dark (default)"), h("option", { value: "dark" }, "Dark"), h("option", { value: "light" }, "Light (uses indicators' light colours)"))),
      field("Self view", "remove_self", h("select", { value: d.remove_self === false ? "false" : "", onchange: (e) => opt("remove_self", e.target.value === "false" ? false : undefined) },
        h("option", { value: "" }, "Not in the layout (default)"), h("option", { value: "false" }, "Include yourself"))),
      field("Dual screen", "dual_screen_enabled", h("label", { class: "toggle small" },
        h("input", { type: "checkbox", checked: d.dual_screen_enabled === true, onchange: (e) => opt("dual_screen_enabled", e.target.checked ? true : undefined) }),
        " Use on dual-screen room systems"), d.dual_screen_modes ? "Separate dual screen modes from your file are kept as they are." : "The same layout shows on both screens.")),
    h("div", { class: "row" },
      h("label", { class: "toggle" }, h("input", {
        type: "checkbox", checked: inCycle, disabled: ed.unsaved || clash,
        onchange: (e) => {
          const list = Array.isArray(allowed) ? allowed.filter((l) => l !== d.name) : [...catalog.DEFAULT_CONFIG.dtmf_allowed_layouts];
          if (e.target.checked) list.push(d.name);
          state.edits.replace(["dtmf_allowed_layouts"], list);
          changed({ rerender: true });
        },
      }), " Callers can switch to it with the keypad"),
    ),
    ed.file && !clash ? layoutMeeting(d) : null,
  );
}

/** Inline meeting preview of the layout being edited, with a people slider. */
function layoutMeeting(d) {
  const sc = state.meeting;
  sc.layout = d.savedName ?? d.name;
  const max = Math.max(1, ...d.modes.map((mm) => mm?.constraints?.max_slots ?? 1));
  // Follow the layout's maximum until the user picks a number with the slider.
  if (state.layoutEdit.people === undefined || state.layoutEdit.peopleAuto) Object.assign(state.layoutEdit, { people: max, peopleAuto: true });
  sc.participants = Math.min(state.layoutEdit.people, rules.CUSTOM_LAYOUT_MAX_SLOTS);
  const count = h("output", { class: "m-count" }, String(sc.participants));
  return h("div", { class: "layout-meeting" },
    h("h4", {}, "How it looks in a meeting"),
    h("div", { class: "m-controls" }, h("label", {}, "People ",
      h("input", {
        type: "range", min: 1, max: Math.max(max, 2), value: sc.participants,
        oninput: (e) => { state.layoutEdit.peopleAuto = false; state.layoutEdit.people = sc.participants = Number(e.target.value); count.textContent = e.target.value; previewUpdaters.forEach((fn) => fn()); },
      }), count),
    h("span", { class: "muted small" }, "Uses your theme's watermark, indicators and banner. Change the scenario on the Review step.")),
    meetingPreview(0.33));
}

SETTINGS_PANES.layouts = () => {
  const customs = customLayouts(build().theme);
  const taken = new Set(Object.keys(customs));
  const templateId = nextId();
  const create = (layout) => {
    layout.name = uniqueLayoutName(layout.name, taken);
    openLayout(layout, null);
    state.layoutEdit.sel = null;
    layoutChanged();
  };
  return h("div", {},
    section("Custom layouts", null,
      h("p", { class: "muted" }, "Design your own video layouts: where each person appears, who's the main speaker, and what happens while someone presents. Use a layout by choosing its name on a meeting room, in the API, or from the keypad layout cycle."),
      h("p", { class: "notice-inline" }, "Custom layouts need a ", h("strong", {}, "customlayouts"), " licence on your Infinity system."),
      Object.keys(customs).length
        ? h("div", { class: "layout-list" }, Object.values(customs).sort((a, b) => a.name.localeCompare(b.name)).map((l) => h("div", { class: `layout-row ${state.layoutEdit?.file === l.$file ? "active" : ""}` },
          h("code", { class: "key" }, l.name),
          h("span", { class: "muted small" }, `${Array.isArray(l.modes) ? l.modes.length : 0} mode(s) · up to ${Math.max(0, ...(Array.isArray(l.modes) ? l.modes : []).map((mm) => mm?.constraints?.max_slots ?? 0))} people${Array.isArray(l.pres_modes) ? " · presentation layout" : ""}`),
          h("span", { class: "spacer" }),
          h("button", { type: "button", class: "btn small-btn", onclick: () => { openLayout(l, l.$file); renderMain(); } }, "Edit"),
          h("button", { type: "button", class: "btn subtle small-btn", onclick: () => { const { $file, ...copy } = clone(l); copy.name = `${l.name.slice(0, 45)}_copy`; create(copy); } }, "Duplicate"),
          h("button", {
            type: "button", class: "btn subtle small-btn",
            onclick: () => {
              if (!confirm(`Delete the layout ${l.name}?`)) return;
              removeFile(l.$file);
              updateAllowedLayouts(l.name, null);
              if (state.layoutEdit?.file === l.$file) state.layoutEdit = null;
              changed({ rerender: true });
            },
          }, "Delete"))))
        : h("p", { class: "muted small" }, "No custom layouts in your theme yet."),
      h("div", { class: "row" },
        h("label", { for: templateId }, "Start from "),
        h("select", { id: templateId }, Object.entries(TEMPLATES).map(([k, t]) => h("option", { value: k }, t.title))),
        h("button", { type: "button", class: "btn primary", onclick: () => create(TEMPLATES[document.getElementById(templateId).value].layout()) }, "New layout")),
      h("p", { class: "muted small" }, "Pexip's ", docsLink("layout designer", catalog.DOCS.layoutDesigner), " can also edit these files, including separate dual screen layouts.")),
    state.layoutEdit ? layoutEditor() : null,
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
    if (!slot.fit.w) return false; // any size accepted
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
      toast(`Converted ${file.name} to ${slot.spec.split(",")[0]}${slot.fit.w ? ` ${slot.fit.w}×${slot.fit.h}` : ""}`, "success");
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
      bytes ? thumb(slot.file, bytes) : previewImg(slot.file, { maxWidth: "100%", maxHeight: "100%", objectFit: "contain" })),
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

// -- Indicator icons (icon_notch57tp_*.svg) --------------------------------------

const notchUrls = new WeakMap();

/** Preview URL for a notch icon: the theme's file if it has one, otherwise Pexip's default. */
function notchSrc(file) {
  const bytes = build().theme.files[file];
  if (!bytes) return `defaults/notch/${file}`;
  if (!notchUrls.has(bytes)) notchUrls.set(bytes, URL.createObjectURL(new Blob([bytes], { type: "image/svg+xml" })));
  return notchUrls.get(bytes);
}

function notchStatus(item) {
  const files = [notchFile(item), notchFile(item, true)];
  if (files.some((f) => f in state.files)) return "Custom";
  if (files.some((f) => f in build().theme.files)) return "From theme ZIP";
  return "Default";
}

async function uploadNotch(item, whiteOnly = false) {
  const [file] = await pickFiles({ accept: ".svg,image/svg+xml" });
  if (!file) return;
  const text = await file.text();
  const problems = checkNotchSvg(text);
  const errors = problems.filter((p) => p.level === "error");
  if (errors.length) { toast(`${file.name}: ${errors[0].message}`, "error"); return; }
  for (const p of problems) toast(`${file.name}: ${p.message}`, "info");
  if (whiteOnly) {
    setFile(notchFile(item, true), utf8.encode(text));
    toast("White version updated for the dark indicator bar", "success");
  } else {
    const { svg, recoloured } = makeDarkVariant(text);
    setFile(notchFile(item), utf8.encode(text));
    setFile(notchFile(item, true), utf8.encode(svg));
    toast(recoloured
      ? "Icon added. A white version was made for the dark indicator bar."
      : "Icon added. It has colours, so the same artwork is used on the dark bar. Upload a white version if it's hard to see.",
    recoloured ? "success" : "info");
  }
  changed({ rerender: true });
}

function goToNotch(item) {
  go("images");
  document.getElementById(`notch-${item}`)?.scrollIntoView({ block: "center" });
}

function notchCard(item) {
  const info = catalog.NOTCH_ICON_INFO[item];
  const light = notchFile(item);
  const dark = notchFile(item, true);
  const status = notchStatus(item);
  const issues = [...fileIssues(light), ...fileIssues(dark)];
  return h("section", { class: "card notch-card", id: `notch-${item}` },
    h("div", { class: "slot-head" }, h("h3", {}, info.title), h("span", { class: `badge ${status.replace(/\s/g, "-").toLowerCase()}` }, status)),
    h("p", { class: "muted small" }, info.help),
    h("div", { class: "notch-previews" },
      h("div", { class: "notch-stage dark", title: "Dark indicator bar (default) at 48, 20 and 12 px" },
        [48, 20, 12].map((px) => h("span", { class: "notch-bubble" },
          h("img", { src: notchSrc(dark), width: px, height: px, alt: px === 48 ? `${info.title} icon` : "" })))),
      h("div", { class: "notch-stage light", title: "Light-mode indicator bar at 20 px" },
        h("span", { class: "notch-bubble light" }, h("img", { src: notchSrc(light), width: 20, height: 20, alt: "" })))),
    issueList(issues),
    h("div", { class: "row" },
      h("button", { type: "button", class: "btn", onclick: () => uploadNotch(item) }, "Upload icon…"),
      h("button", { type: "button", class: "btn subtle", title: "Replace only the white version used on the dark bar", onclick: () => uploadNotch(item, true) }, "White version…"),
      status !== "Default" ? h("button", {
        type: "button", class: "btn subtle",
        onclick: () => { removeFile(light); removeFile(dark); changed({ rerender: true }); },
      }, "Use default") : null));
}

function notchSection() {
  return section("Indicator icons", null,
    h("p", { class: "muted" },
      "Replace the icons shown in the indicator bar at the top of the meeting layout (participants, recording, locked and more). ",
      "Upload one black SVG and Theme Studio makes the white version for the dark bar. The text next to an icon is set in Settings → Indicators."),
    h("div", { class: "notice" }, h("span", {},
      h("strong", {}, "Pexip's advice: "),
      "“We recommend that you do not customize these elements as we cannot guarantee compatibility with future versions of Pexip Infinity.” ",
      "Check your icons after each Infinity upgrade.")),
    h("ul", { class: "list small muted" },
      h("li", {}, "SVG with a square viewBox (24×24 recommended), simple shapes, one colour."),
      h("li", {}, "It must be clear at 12 px. Infinity always draws it on a semi-transparent grey background you can't change.")),
    h("div", { class: "notch-grid" }, rules.NOTCH_ICONS.map(notchCard)));
}

RENDERERS.images = () => {
  previewUrls.forEach((u) => URL.revokeObjectURL(u));
  previewUrls = [];
  const slotFiles = new Set(catalog.IMAGE_SLOTS.map((s) => s.file));
  const files = build().theme.files;
  const others = [...new Set([...Object.keys(files), ...state.removedFiles])]
    .filter((f) => f !== rules.THEMECONFIG && !slotFiles.has(f) && !rules.BASE_AUDIO_FILES.has(f) && !rules.NOTCH_ICON_FILES.has(f))
    .sort();
  return h("div", {},
    h("h1", {}, "Images"),
    h("p", { class: "lead" }, "Upload your logos and backgrounds. Images in the wrong size or format are converted automatically (backgrounds are cropped to fill 1920×1080, logos are fitted inside 200×100)."),
    meetingDock(),
    h("div", { class: "slot-grid" }, catalog.IMAGE_SLOTS.map(imageSlotCard)),
    notchSection(),
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
    section("Meeting preview", "How your theme looks in a meeting. Change the scenario to see each indicator, the banner and the layouts. Positions follow Pexip's documentation; the real thing may differ slightly.",
      h("div", { class: "meeting-full" }, meetingPreview(0.42), meetingControls())),
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
  try {
    const res = await fetch("defaults/theme_screen_defaults_v41.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.screenDefaults = JSON.parse((await res.text()).replace(/^\uFEFF/, ""));
  } catch (err) {
    toast(`Couldn't load the splash screen defaults (${err.message}); previews are unavailable.`, "error");
  }
  window.addEventListener("beforeunload", (e) => {
    if (state.dirty) { e.preventDefault(); e.returnValue = ""; }
  });
  renderSidebar();
  renderMain();
}

init();
