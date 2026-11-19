#!/usr/bin/env node
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SQ } from "./shape.mjs";
import { setWord } from "./glyphs.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
if (!arg("--out")) {
  console.error("usage: node docs/brand/nilla/build.mjs --out <new or empty dir> [--repo <path>]");
  process.exit(2);
}
const OUT = resolve(arg("--out"));
if (existsSync(OUT) && readdirSync(OUT).length > 0) {
  console.error(`--out must be a new or empty directory; ${OUT} is not empty`);
  process.exit(2);
}
const REPO = resolve(arg("--repo", join(HERE, "..", "..", "..")));
const resvg = (() => {
  for (const from of [join(HERE, "package.json"), join(REPO, "package.json")]) {
    try {
      return createRequire(from)("@resvg/resvg-js");
    } catch {}
  }
  throw new Error("@resvg/resvg-js not found: run from inside the repo or pass --repo");
})();

const palettes = JSON.parse(readFileSync(join(HERE, "palettes.json"), "utf8"));
const SLOTS = ["skyTop", "skyMiddle", "skyBottom", "sun", "backHill", "frontHill"];
const icons = palettes.icons.map((i) => ({ ...i, c: SLOTS.map((s) => i.colors[s]) }));
const DEFAULT = icons.find((i) => i.id === palettes.default);
const h = DEFAULT.c;
const ALTS = icons.filter((i) => i.id !== DEFAULT.id);

const NTP_TINTS = {
  green: { back: h[4], front: h[5], sun: h[3] },
  blue: { back: "#709CBA", front: "#204056", sun: h[3] },
  neutral: { back: "#9B9B9B", front: "#3E3E3E", sun: h[3] },
  orange: { back: "#C68A72", front: "#5F3221", sun: "#EFCD6D" },
  pink: { back: "#C48F99", front: "#5C363D", sun: h[3] },
  plum: { back: "#B88FA0", front: "#543542", sun: h[3] },
  purple: { back: "#8D8AAE", front: "#35324D", sun: h[3] },
  red: { back: "#B97A7D", front: "#552629", sun: h[3] },
  yellow: { back: "#CDAC68", front: "#634B19", sun: "#EFE4C4" },
};

const INK_LIGHT = "#2B3550";
const INK_DARK = "#EEF0E2";
const SUN = { cx: 334, cy: 372, r: 112 };
const BACK = "M100 700C320 640 560 610 924 560V924H100Z";
const FRONT = "M100 812C380 760 650 600 924 338V924H100Z";

const entries = [];
const layerOf = (p) => (p && /^engine\//.test(p) ? 2 : 1);
function add(file, data, { current = null, target, action = current ? "replace" : "add", note = "" } = {}) {
  const path = join(OUT, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  const t = target === undefined ? current : target;
  entries.push({ file, action, layer: layerOf(t || current), current, target: t, note });
}
const mark = (action, current, note) => entries.push({ file: null, action, layer: layerOf(current), current, target: action === "remove" ? null : current, note });
const png = (svg, size) => new resvg.Resvg(svg, { fitTo: { mode: "width", value: size }, font: { loadSystemFonts: false } }).render().asPng();
const lum = (x) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const srgb = (x) => `srgb:${[1, 3, 5].map((i) => (parseInt(x.slice(i, i + 2), 16) / 255).toFixed(5)).join(",")},1.00000`;
const json = (o) => JSON.stringify(o, null, 2) + "\n";

function scene(c, { shape = "squircle", box = [100, 100, 824, 824], size = 1024, shadow = false, id = "s" } = {}) {
  const [s0, s1, s2, sun, back, front] = c;
  const outline = shape === "squircle" ? SQ : "M100 100H924V924H100Z";
  const dark = lum(s1) < 0.2;
  const edge = shape === "squircle" ? `<path d="${SQ}" fill="none" stroke="${dark ? "#FFFFFF" : "#000000"}" stroke-opacity="${dark ? ".12" : ".08"}" stroke-width="4"/>` : "";
  const filter = shadow ? `<filter id="${id}shadow" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000000" flood-opacity=".3"/></filter>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.join(" ")}" width="${size}" height="${size}">
<defs><clipPath id="${id}clip"><path d="${outline}"/></clipPath><linearGradient id="${id}sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s0}"/><stop offset=".6" stop-color="${s1}"/><stop offset="1" stop-color="${s2}"/></linearGradient>${filter}</defs>
<g${shadow ? ` filter="url(#${id}shadow)"` : ""}><path d="${outline}" fill="url(#${id}sky)"/></g>
<g clip-path="url(#${id}clip)"><circle cx="${SUN.cx}" cy="${SUN.cy}" r="${SUN.r}" fill="${sun}"/><path d="${BACK}" fill="${back}"/><path d="${FRONT}" fill="${front}"/></g>
${edge}
</svg>
`;
}
const tight = (m) => [100 - m, 100 - m, 824 + 2 * m, 824 + 2 * m];
const layerSvg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="100 100 824 824" width="1024" height="1024">${body}</svg>\n`;
const markLayer = (body, id) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="100 100 824 824" width="200" height="200"><defs><clipPath id="${id}"><path d="${SQ}"/></clipPath></defs><g clip-path="url(#${id})">${body}</g></svg>\n`;

function ico(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.data)]);
}
function icns(parts) {
  const chunks = parts.map(({ type, data }) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, "ascii");
    head.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([head, data]);
  });
  const head = Buffer.alloc(8);
  head.write("icns", 0, "ascii");
  head.writeUInt32BE(8 + chunks.reduce((a, c) => a + c.length, 0), 4);
  return Buffer.concat([head, ...chunks]);
}

const MAC = "apps/browser/macos/Nilla-macOS";
const macSvg = scene(h, { id: "m", shadow: true });
const flatSvg = scene(h, { id: "e", box: tight(36) });

add("icons/source/default.svg", scene(h, { id: "d" }), { note: "Highland on Apple's 1024 grid (824 px squircle, 100 px inset). Brand source.", target: "docs/brand/nilla/source/default.svg" });
for (const a of ALTS) add(`icons/source/alternates/${a.id}.svg`, scene(a.c, { id: `${a.id}-` }), { note: `alternate: ${a.name} (${a.group})`, target: `docs/brand/nilla/source/alternates/${a.id}.svg` });
add("icons/source/palettes.json", json(palettes), { note: "default and the 23 alternates, in picker order, with their six colours (AppIcons.swift's variant list)", target: "docs/brand/nilla/palettes.json" });

const layers = {
  sun: layerSvg(`<circle cx="${SUN.cx}" cy="${SUN.cy}" r="${SUN.r}" fill="${h[3]}"/>`),
  back: layerSvg(`<path d="${BACK}" fill="${h[4]}"/>`),
  front: layerSvg(`<path d="${FRONT}" fill="${h[5]}"/>`),
};
const iconJson = (platforms) => json({
  fill: { solid: srgb(h[1]) },
  groups: ["sun", "front", "back"].map((n) => ({ layers: [{ glass: false, "image-name": `${n}.png`, name: n }], shadow: { kind: "neutral", opacity: 0.5 }, specular: false, translucency: { enabled: false, value: 0.5 } })),
  "supported-platforms": platforms,
});
for (const [n, svg] of Object.entries(layers)) {
  add(`icons/source/layers/${n}.svg`, svg, { note: `Icon Composer layer ${n} (full 1024 canvas)`, target: `docs/brand/nilla/source/layers/${n}.svg` });
  add(`icons/macos/AppIcon.icon/Assets/${n}.png`, png(svg, 1024), { current: `${MAC}/AppIcon.icon/Assets/${n}.png`, note: "macOS 26 icon layer" });
  add(`icons/phone/ios/AppIcon.icon/Assets/${n}.png`, png(svg, 1024), { current: `apps/phone/ios/App/AppIcon.icon/Assets/${n}.png`, note: "iOS icon layer" });
}
add("icons/macos/AppIcon.icon/icon.json", iconJson({ squares: ["macOS"] }), { current: `${MAC}/AppIcon.icon/icon.json`, note: "solid fill = the sky's middle colour (the schema in use today); a gradient fill needs Icon Composer on a Mac" });
add("icons/phone/ios/AppIcon.icon/icon.json", iconJson({ squares: "shared" }), { current: "apps/phone/ios/App/AppIcon.icon/icon.json", note: "iOS" });

const DEV = { fill: "#0C221E", copper: "#D49A4A", back: "#D39357", front: "#87502C", sun: "#F8BA24", chip: "#1E1F22", pin: "#B8C0C8" };
const ring = (() => {
  const cx = SUN.cx, cy = SUN.cy, r = SUN.r + 30;
  let ticks = "";
  for (let k = 0; k < 16; k++) {
    const a = (k * Math.PI) / 8;
    const p = (rr) => `${(cx + rr * Math.cos(a)).toFixed(1)} ${(cy + rr * Math.sin(a)).toFixed(1)}`;
    ticks += `M${p(r)}L${p(r + 26)}`;
  }
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${DEV.copper}" stroke-width="11"/><path d="${ticks}" stroke="${DEV.copper}" stroke-width="10"/>`;
})();
const pad = (x, y) => `<circle cx="${x}" cy="${y}" r="15" fill="none" stroke="${DEV.copper}" stroke-width="10"/>`;
const chip = (x, y, w, hgt, pins) => {
  let p = "";
  for (let k = 0; k < pins; k++) {
    const px = x + (w / (pins + 1)) * (k + 1);
    p += `M${px.toFixed(1)} ${y - 10}V${y}M${px.toFixed(1)} ${y + hgt}V${y + hgt + 10}`;
  }
  return `<rect x="${x}" y="${y}" width="${w}" height="${hgt}" rx="4" fill="${DEV.chip}"/><path d="${p}" stroke="${DEV.pin}" stroke-width="5"/>`;
};
const devLayers = {
  board: layerSvg(`<g fill="none" stroke="${DEV.copper}" stroke-width="10" stroke-linejoin="round"><path d="M334 100V230"/><path d="M924 214H800L716 298H476"/><path d="M924 404H830L782 452V520"/><path d="M590 100V146L548 188"/><path d="M100 200H150L196 246"/></g>${pad(548, 196)}${pad(782, 532)}${pad(204, 254)}${ring}${chip(660, 150, 46, 66, 3)}${chip(800, 128, 72, 34, 4)}`),
  sun: layerSvg(`<circle cx="${SUN.cx}" cy="${SUN.cy}" r="${SUN.r}" fill="${DEV.sun}"/>`),
  back: layerSvg(`<path d="${BACK}" fill="${DEV.back}"/>`),
  front: layerSvg(`<path d="${FRONT}" fill="${DEV.front}"/>`),
};
for (const [n, svg] of Object.entries(devLayers)) {
  add(`icons/source/layers-dev/${n}.svg`, svg, { note: `dev-build icon layer ${n}`, target: `docs/brand/nilla/source/layers-dev/${n}.svg` });
  add(`icons/macos/AppIcon-Dev.icon/Assets/${n}.png`, png(svg, 1024), { current: `${MAC}/AppIcon-Dev.icon/Assets/${n}.png`, note: "dev builds' icon (ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon-Dev): copper slope on a circuit board" });
}
add("icons/macos/AppIcon-Dev.icon/icon.json", json({
  fill: { solid: srgb(DEV.fill) },
  groups: ["sun", "front", "back", "board"].map((n) => ({ layers: [{ glass: false, "image-name": `${n}.png`, name: n }], shadow: { kind: "neutral", opacity: n === "board" ? 0 : 0.5 }, specular: false, translucency: { enabled: false, value: 0.5 } })),
  "supported-platforms": { squares: ["macOS"] },
}), { current: `${MAC}/AppIcon-Dev.icon/icon.json`, note: "dev icon: dark-green fill, four layers, as today" });
const devPreview = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="100 100 824 824" width="1024" height="1024"><defs><clipPath id="dv"><path d="${SQ}"/></clipPath></defs><path d="${SQ}" fill="${DEV.fill}"/><g clip-path="url(#dv)">${["board", "back", "front", "sun"].map((n) => devLayers[n].replace(/^<svg[^>]*>|<\/svg>\s*$/g, "")).join("")}</g></svg>\n`;
add("icons/macos/AppIcon-Dev-preview.svg", devPreview, { target: null, action: "preview", note: "the dev icon composited, for the preview page" });

const appiconset = [];
for (const s of [16, 32, 128, 256, 512])
  for (const scale of [1, 2]) {
    const name = `icon_${s}x${s}_${scale}x.png`;
    add(`icons/macos/AppIcon.appiconset/${name}`, png(macSvg, s * scale), { current: `${MAC}/Assets.xcassets/AppIcon.appiconset/${name}`, note: `${s * scale} px, Apple template with shadow` });
    appiconset.push({ filename: name, idiom: "mac", scale: `${scale}x`, size: `${s}x${s}` });
  }
add("icons/macos/AppIcon.appiconset/Contents.json", json({ images: appiconset, info: { author: "xcode", version: 1 } }), { current: `${MAC}/Assets.xcassets/AppIcon.appiconset/Contents.json`, note: "same slots as today" });
for (const a of ALTS) {
  const dir = `${MAC}/Assets.xcassets/AppIconVariant-${a.id}.imageset`;
  add(`icons/macos/variants/AppIconVariant-${a.id}.imageset/icon.png`, png(scene(a.c, { id: `v${a.id}-`, shadow: true }), 1024), { target: `${dir}/icon.png`, note: `AppIcons.swift alternate "${a.id}" (${a.name}), drawn whole` });
  add(`icons/macos/variants/AppIconVariant-${a.id}.imageset/Contents.json`, json({ images: [{ filename: "icon.png", idiom: "universal" }], info: { author: "xcode", version: 1 } }), { target: `${dir}/Contents.json` });
}
for (const old of ["AppIconMark", "AppIconMark-blue", "AppIconMark-neutral", "AppIconMark-plum"]) mark("remove", `${MAC}/Assets.xcassets/${old}.imageset`, "old plate-variant marks: the new variants are whole icons");
add("icons/macos/app-icon-512.png", png(macSvg, 512), { current: "apps/browser/assets/app-icon.png", note: "the app's own UI icon (drawn at 132 pt at most)" });

for (const [tint, col] of Object.entries(NTP_TINTS)) {
  const prefix = tint === "green" ? "ntp-mark" : `ntp-mark-${tint}`;
  const parts = {
    back: markLayer(`<path d="${BACK}" fill="${col.back}"/>`, `${tint}b`),
    front: markLayer(`<path d="${FRONT}" fill="${col.front}"/>`, `${tint}f`),
    sun: markLayer(`<circle cx="${SUN.cx}" cy="${SUN.cy}" r="${SUN.r}" fill="${col.sun}"/>`, `${tint}s`),
  };
  for (const [layer, svg] of Object.entries(parts))
    for (const [suffix, size] of [["", 100], ["@2x", 200]])
      add(`icons/ntp/${prefix}-${layer}${suffix}.png`, png(svg, size), { current: `apps/browser/assets/${prefix}-${layer}${suffix}.png`, note: `New Tab page mark, ${tint} profile colour, ${layer} layer, redrawn from Nilla's mark. Required: today's file is cut from Ardia's logo painting (see the notes)` });
}
const silhouette = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="100 100 824 824" width="32" height="32"><defs><clipPath id="nt"><path d="${SQ}"/></clipPath><mask id="gap"><rect x="0" y="0" width="1024" height="1024" fill="#FFFFFF"/><path d="M100 812C380 760 650 600 924 338" fill="none" stroke="#000000" stroke-width="70"/></mask></defs><circle cx="${SUN.cx}" cy="${SUN.cy}" r="${SUN.r + 20}" fill="#000000"/><g clip-path="url(#nt)"><path d="${BACK}" fill="#000000" mask="url(#gap)"/><path d="${FRONT}" fill="#000000"/></g></svg>\n`;
add("icons/ntp/new-tab-mark.png", png(silhouette, 16), { current: "apps/browser/assets/new-tab-mark.png", note: "New Tab favicon: one colour (drawn tinted), hills split, sun cut free. Required, like the New Tab hills: today's is a small copy of Ardia's logo" });
add("icons/ntp/new-tab-mark@2x.png", png(silhouette, 32), { current: "apps/browser/assets/new-tab-mark@2x.png", note: "New Tab favicon @2x (required, as above)" });

const THEME = "engine/chromium/src/chrome/app/theme";
const COMP = "engine/chromium/src/components/resources";
for (const s of [16, 24, 48, 64, 128, 256]) add(`icons/engine/chrome/app/theme/chromium/product_logo_${s}.png`, png(flatSvg, s), { current: `${THEME}/chromium/product_logo_${s}.png`, note: "Chromium product logo (flat tile, 92 %, no shadow)" });
for (const [dir, scale] of [["default_100_percent", 1], ["default_200_percent", 2]]) {
  for (const [name, s] of [["product_logo_16", 16], ["product_logo_32", 32], ["product_logo_name_22", 22], ["product_logo_name_22_white", 22]])
    add(`icons/engine/chrome/app/theme/${dir}/chromium/${name}.png`, png(flatSvg, s * scale), { current: `${THEME}/${dir}/chromium/${name}.png`, note: `${s * scale} px (the "name" and "white" variants are the tile, as today)` });
  for (const [name, s] of [["favicon_product", 16], ["product_logo", 32], ["product_logo_white", 32]])
    add(`icons/engine/components/resources/${dir}/chromium/${name}.png`, png(flatSvg, s * scale), { current: `${COMP}/${dir}/chromium/${name}.png`, note: `${s * scale} px` });
}
const vectorLogo = scene(h, { id: "pl", box: tight(36), size: 256 });
add("icons/engine/chrome/app/theme/chromium/product_logo.svg", vectorLogo, { current: `${THEME}/chromium/product_logo.svg`, note: "real vector (today's is a PNG inside an SVG)" });
add("icons/engine/chrome/app/theme/chromium/product_logo_animation.svg", vectorLogo, { current: `${THEME}/chromium/product_logo_animation.svg`, note: "same as product_logo.svg, as today" });
add("icons/engine/chrome/app/theme/chromium/mac/app.icns", icns([["icp4", 16], ["icp5", 32], ["ic11", 32], ["ic12", 64], ["ic07", 128], ["ic08", 256], ["ic13", 256]].map(([type, s]) => ({ type, data: png(macSvg, s) }))), { current: `${THEME}/chromium/mac/app.icns`, note: "the framework helpers' icon (notifications), 128 pt at most, PNG entries" });
mark("mac-step", `${THEME}/chromium/mac/Assets.car`, "needs Apple's actool on a Mac: `actool --compile <dir> --platform macosx --minimum-deployment-target 14.0 --app-icon AppIcon --output-partial-info-plist /tmp/p.plist icons/macos/AppIcon.appiconset/..` (or the brand pipeline's existing actool step)");

const winPngs = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256].map((s) => ({ size: s, data: png(scene(h, { id: `w${s}`, box: tight(s <= 24 ? 16 : 40) }), s) }));
add("icons/windows/Nilla.ico", ico(winPngs), { current: "apps/browser/windows/Ardia/Ardia.ico", note: "10 sizes as today. The Windows engine copies the same file over its chrome/app/theme/chromium/win/chromium.ico through scripts/windows/engine/ardia_resources_win.txt; that mapping is Layer 2" });

const linux = [16, 22, 24, 32, 48, 64, 128, 256, 512];
for (const s of linux) add(`icons/linux/hicolor/${s}x${s}/apps/nilla.png`, png(scene(h, { id: `l${s}`, box: tight(s <= 24 ? 16 : 48) }), s), { target: `scripts/linux/icons/hicolor/${s}x${s}/apps/nilla.png`, note: "new: package.py installs these to share/icons/hicolor as nilla.png (today it copies the engine's product_logo_256.png as nilla.png); Icon=nilla in nilla.desktop" });
add("icons/linux/hicolor/scalable/apps/nilla.svg", scene(h, { id: "ls", box: tight(48), size: 256 }), { target: "scripts/linux/icons/hicolor/scalable/apps/nilla.svg", note: "new: scalable app icon; also the AppImage's top-level icon" });

const fav = (s) => png(scene(h, { id: `f${s}`, box: tight(12) }), s);
add("icons/site/favicon.ico", ico([16, 32, 48].map((s) => ({ size: s, data: fav(s) }))), { target: "docs/brand/nilla/web/favicon.ico", note: "16, 32, 48 px; the site (apps/site) is deleted under D4; kept as a brand asset for a future site" });
add("icons/site/favicon.png", fav(64), { target: "docs/brand/nilla/web/favicon.png", note: "64 px; the site (apps/site) is deleted under D4; kept as a brand asset for a future site" });
add("icons/site/apple-touch-icon.png", png(scene(h, { id: "t", shape: "square" }), 180), { target: "docs/brand/nilla/web/apple-touch-icon.png", note: "180 px full square (iOS rounds it); the site (apps/site) is deleted under D4; kept as a brand asset for a future site" });
add("icons/site/app-icon.png", png(macSvg, 256), { target: "docs/brand/nilla/app-icon-256.png", note: "README header image: README.md shows apps/site/src/assets/app-icon.png today, and apps/site is deleted under D4, so point README.md here" });
const lettering = (w, x, y, s, ink) => `<g transform="translate(${x} ${y}) scale(${s})"><path d="${w.d}" fill="none" stroke="${ink}" stroke-width="84" stroke-linecap="round" stroke-linejoin="round"/><g fill="${ink}">${w.dots.map(([dx, dy]) => `<circle cx="${dx}" cy="${dy}" r="52"/>`).join("")}</g></g>`;
const og = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
<defs><linearGradient id="og-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${h[0]}"/><stop offset=".6" stop-color="${h[1]}"/><stop offset="1" stop-color="${h[2]}"/></linearGradient></defs>
<rect width="1200" height="630" fill="url(#og-sky)"/><circle cx="930" cy="170" r="74" fill="${h[3]}"/>
<path d="M0 540C420 500 800 470 1200 430V630H0Z" fill="${h[4]}"/><path d="M0 610C480 590 880 480 1200 230V630H0Z" fill="${h[5]}"/>
${lettering(setWord("nilla"), 92, 280, 0.3, INK_LIGHT)}
${lettering(setWord("touch grass."), 98, 380, 0.095, INK_LIGHT)}
</svg>
`;
add("icons/site/og.svg", og, { target: "docs/brand/nilla/web/og.svg", note: "share-image source, placeholder lettering; the site (apps/site) is deleted under D4; kept as a brand asset for a future site" });
add("icons/site/og.png", png(og, 1200), { target: "docs/brand/nilla/web/og.png", note: "1200×630; the site (apps/site) is deleted under D4; kept as a brand asset for a future site" });

add("icons/phone/ios/OpenInNilla.png", png(scene(h, { id: "a", shape: "square" }), 1024), { current: "apps/phone/ios/Action/Assets.xcassets/AppIcon.appiconset/OpenInNilla.png", note: "share extension, 1024 full square (iOS rounds it)" });
add("icons/phone/ios/Action-AppIcon-Contents.json", json({ images: [{ filename: "OpenInNilla.png", idiom: "universal", platform: "ios", size: "1024x1024" }], info: { author: "xcode", version: 1 } }), { current: "apps/phone/ios/Action/Assets.xcassets/AppIcon.appiconset/Contents.json", note: "points at the renamed file" });
const preview360 = png(scene(h, { id: "p", box: tight(0) }), 360);
add("icons/phone/AppIconPreview.png", preview360, { current: "apps/phone/ios/App/Assets.xcassets/AppIconPreview.imageset/AppIconPreview.png", note: "360 px" });
add("icons/phone/appIconPreview.png", preview360, { current: "apps/phone/assets/appIconPreview.png", note: "360 px" });

const D = 72 / 824;
const T = +(18 - 100 * D).toFixed(4);
const vgroup = (inner) => `    <group android:scaleX="${D.toFixed(6)}" android:scaleY="${D.toFixed(6)}" android:translateX="${T}" android:translateY="${T}">\n${inner}    </group>\n`;
const vec = (body) => `<?xml version="1.0" encoding="utf-8"?>\n<vector xmlns:android="http://schemas.android.com/apk/res/android"\n    xmlns:aapt="http://schemas.android.com/aapt"\n    android:width="108dp"\n    android:height="108dp"\n    android:viewportWidth="108"\n    android:viewportHeight="108">\n${body}</vector>\n`;
const SUN_PATH = `M${SUN.cx - SUN.r},${SUN.cy} a${SUN.r},${SUN.r} 0 1,0 ${2 * SUN.r},0 a${SUN.r},${SUN.r} 0 1,0 ${-2 * SUN.r},0 Z`;
const BACK_BLEED = "M-106,756 L100,700 C320,640 560,610 924,560 L1130,532 L1130,1130 L-106,1130 Z";
const FRONT_BLEED = "M-106,850 L100,812 C380,760 650,600 924,338 L1130,141 L1130,1130 L-106,1130 Z";
const argb = (x) => `#FF${x.slice(1).toUpperCase()}`;
const RES = "apps/phone/android/app/src/main/res";
add("icons/phone/android/drawable/ic_launcher_foreground.xml", vec(vgroup(`        <path android:pathData="${SUN_PATH}" android:fillColor="${argb(h[3])}" />\n        <path android:pathData="${BACK_BLEED}" android:fillColor="${argb(h[4])}" />\n        <path android:pathData="${FRONT_BLEED}" android:fillColor="${argb(h[5])}" />\n`)), { current: `${RES}/drawable/ic_launcher_foreground.xml`, note: "vector; hills bleed to the 108 dp edge" });
add("icons/phone/android/drawable/ic_launcher_monochrome.xml", vec(vgroup(`        <path android:pathData="${SUN_PATH}" android:fillColor="#FF000000" android:fillAlpha="1.0" />\n        <path android:pathData="${BACK_BLEED}" android:fillColor="#FF000000" android:fillAlpha="0.45" />\n        <path android:pathData="${FRONT_BLEED}" android:fillColor="#FF000000" android:fillAlpha="1.0" />\n`)), { current: `${RES}/drawable/ic_launcher_monochrome.xml`, note: "themed icon" });
add("icons/phone/android/drawable/ic_launcher_background.xml", vec(`    <path android:pathData="M0,0 L108,0 L108,108 L0,108 Z">\n        <aapt:attr name="android:fillColor">\n            <gradient android:type="linear" android:startX="0" android:startY="18" android:endX="0" android:endY="90">\n                <item android:offset="0" android:color="${argb(h[0])}" />\n                <item android:offset="0.6" android:color="${argb(h[1])}" />\n                <item android:offset="1" android:color="${argb(h[2])}" />\n            </gradient>\n        </aapt:attr>\n    </path>\n`), { target: `${RES}/drawable/ic_launcher_background.xml`, note: "new: the sky as a gradient (replaces the solid colour background)" });
const adaptive = `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@drawable/ic_launcher_background" />\n    <foreground android:drawable="@drawable/ic_launcher_foreground" />\n    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />\n</adaptive-icon>\n`;
add("icons/phone/android/mipmap-anydpi-v26/ic_launcher.xml", adaptive, { current: `${RES}/mipmap-anydpi-v26/ic_launcher.xml` });
add("icons/phone/android/mipmap-anydpi-v26/ic_launcher_round.xml", adaptive, { current: `${RES}/mipmap-anydpi-v26/ic_launcher_round.xml` });
entries.push({ file: null, action: "edit", layer: 1, current: `${RES}/values/colors.xml`, target: `${RES}/values/colors.xml`, note: `set the icon background colour (today \`nilla_icon_background\`, #FFF9F5E3) to ${argb(h[1])}; under the full rename the resource becomes \`nilla_icon_background\`` });
add("icons/phone/android-preview.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" width="432" height="432"><defs><linearGradient id="ap-sky" x1="0" y1="18" x2="0" y2="90" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${h[0]}"/><stop offset=".6" stop-color="${h[1]}"/><stop offset="1" stop-color="${h[2]}"/></linearGradient><clipPath id="ap-mask"><circle cx="54" cy="54" r="36"/></clipPath></defs><g clip-path="url(#ap-mask)"><rect width="108" height="108" fill="url(#ap-sky)"/><g transform="translate(${T} ${T}) scale(${D.toFixed(6)})"><path d="${SUN_PATH.replace(/,/g, " ")}" fill="${h[3]}"/><path d="${BACK_BLEED}" fill="${h[4]}"/><path d="${FRONT_BLEED}" fill="${h[5]}"/></g></g></svg>\n`, { target: null, action: "preview", note: "the adaptive icon under a circle mask; not shipped" });

add("icons/extras/raycast-icon.png", png(macSvg, 512), { current: "extras/raycast-nilla/assets/icon.png", note: "Raycast extension icon, 512 px" });

function lockup(text, { ink, adaptive = false, withMark = true }) {
  const H = 800, t = 0.92;
  const baseline = H / 2 + (500 * t) / 2;
  const word = setWord(text);
  const tx = withMark ? H + 190 + 42 * t : 42 * t;
  const width = Math.round(tx + word.width * t + 60);
  const style = adaptive ? `<style>@media (prefers-color-scheme: dark){svg{color:${INK_DARK}}}</style>\n` : "";
  const tile = withMark ? `<svg x="0" y="0" width="${H}" height="${H}" viewBox="100 100 824 824">${scene(h, { id: `wm${text}${ink.slice(1)}` }).replace(/^<svg[^>]*>|<\/svg>\s*$/g, "")}</svg>\n` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-40 -90 ${width + 40} 990" width="${Math.round((width + 40) / 5)}" height="198" color="${ink}">\n<title>Nilla</title>\n${style}${tile}<g transform="translate(${+tx.toFixed(1)} ${baseline}) scale(${t})">\n<path d="${word.d}" fill="none" stroke="currentColor" stroke-width="84" stroke-linecap="round" stroke-linejoin="round"/>\n<g fill="currentColor">${word.dots.map(([x, y]) => `<circle cx="${+x.toFixed(1)}" cy="${y}" r="52"/>`).join("")}</g>\n</g>\n</svg>\n`;
}
const words = [
  ["nilla-wordmark.svg", lockup("nilla", { ink: INK_LIGHT, adaptive: true }), "icon + lowercase nilla; ink follows prefers-color-scheme"],
  ["nilla-wordmark-on-light.svg", lockup("nilla", { ink: INK_LIGHT }), "lowercase, fixed heather ink #2B3550"],
  ["nilla-wordmark-on-dark.svg", lockup("nilla", { ink: INK_DARK }), "lowercase, fixed light ink #EEF0E2"],
  ["nilla-wordmark-title.svg", lockup("Nilla", { ink: INK_LIGHT, adaptive: true }), "title case, ink follows prefers-color-scheme"],
  ["nilla-wordmark-title-on-light.svg", lockup("Nilla", { ink: INK_LIGHT }), "title case, fixed heather ink"],
  ["nilla-wordmark-title-on-dark.svg", lockup("Nilla", { ink: INK_DARK }), "title case, fixed light ink"],
  ["nilla-lettering.svg", lockup("nilla", { ink: INK_LIGHT, adaptive: true, withMark: false }), "lowercase lettering only"],
  ["nilla-lettering-title.svg", lockup("Nilla", { ink: INK_LIGHT, adaptive: true, withMark: false }), "title-case lettering only"],
];
for (const [name, svg, note] of words) add(`wordmark/${name}`, svg, { target: `docs/brand/nilla/wordmark/${name}`, note });
for (const [name, svg] of words.filter(([n]) => /on-(light|dark)/.test(n))) add(`wordmark/${name.replace(/\.svg$/, ".png")}`, png(svg, 1200), { target: `docs/brand/nilla/wordmark/${name.replace(/\.svg$/, ".png")}`, note: "raster, 1200 px wide" });

for (const f of ["build.mjs", "glyphs.mjs", "shape.mjs", "palettes.json"]) entries.push({ file: `tools/${f}`, action: "add", layer: 1, current: null, target: `docs/brand/nilla/${f}`, note: "the brand pipeline: `node docs/brand/nilla/build.mjs --out <dir>` regenerates every asset (renders with the repo's @resvg/resvg-js). Apply the repo's no-comments rule; the tools have none" });
mark("remove", "docs/brand/ardia", "the old painted-logo pipeline (build.py, hsv_np.py, source paintings): replaced by docs/brand/nilla");

const manifest = {
  product: "Nilla",
  ids: { prefix: "com.nilladigital", app: "com.nilladigital.nilla", source: "owner-requirements.md (Owner answers)" },
  generated: "docs/brand/nilla/build.mjs",
  palette: { default: DEFAULT.id, colors: DEFAULT.colors, alternates: ALTS.map((a) => a.id) },
  notes: [
    "file: relative to the --out folder. current: the path at the repo base today (null for new files). target: the path the output goes to in the repo (the same as current for a replaced file); the conversion workflow owns the final paths.",
    "action: replace (overwrite current, then move to target), add (new file), remove (delete the current path), edit (change a value in place), mac-step (must be produced on a Mac), preview (not shipped).",
    "layer: 1 = works with today's prebuilt engines; 2 = engine/ (and its interface), lands with the first Nilla engine builds. Every engine/chromium asset is Layer 2.",
    "Site assets (favicons, apple-touch, og) target docs/brand/nilla/web/ because apps/site is deleted under D4. README.md's header image moves to docs/brand/nilla/app-icon-256.png.",
    "New Tab hills (ntp-mark*, new-tab-mark*) are required replacements: today's files are cut from Ardia's logo painting, which Nilla must not use as its brand (Ardia's mark is only their provenance). The redrawn set replaces them. The shader meadow in packages/shaders is separate scenery code, not the logo, and stays.",
    "Default icon: Highland. AppIcons.swift's variants become the 23 alternates in palettes.json order, each drawn whole from its AppIconVariant-<id> imageset (no plate, no monochrome filter).",
  ],
  assets: entries,
};
writeFileSync(join(OUT, "manifest.json"), json(manifest));
const md = entries.filter((e) => e.action !== "preview").map((e) => `| ${e.action} | ${e.layer} | ${e.file ? `\`${e.file}\`` : "–"} | ${e.current ? `\`${e.current}\`` : "–"} | ${e.target ? `\`${e.target}\`` : "–"} | ${e.note} |`).join("\n");
mkdirSync(join(OUT, "icons"), { recursive: true });
writeFileSync(join(OUT, "icons", "INDEX.md"), `# Nilla assets → repo paths\n\nThe same data as \`../manifest.json\`, as a table. *current* is the path at the repo base today; *target* is the path the output goes to.\n\n| Action | Layer | File here | Current path | Target path | Note |\n| --- | --- | --- | --- | --- | --- |\n${md}\n`);
const count = entries.reduce((a, e) => ((a[e.action] = (a[e.action] || 0) + 1), a), {});
console.log(`${entries.length} manifest entries: ${JSON.stringify(count)}`);
