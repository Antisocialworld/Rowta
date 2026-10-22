#!/usr/bin/env node
// GENERATED-FILE BUILDER - scripts/build-icons.mjs
// Deterministic icon pipeline for Rowta.
//
// Sources (owner-supplied, READ-ONLY, never recoloured or edited):
//   brand-source/logo.svg        lettered book tile  (160x160)
//   brand-source/logo-small.svg  five-cell book tile  (160x160)
//   brand-source/logo-mono.svg   one-colour silhouette (160x160, white on transparent)
//   brand-source/logo-card.svg   blue card             (1200x630)
//
// The four sources are byte-copied to web/public/brand/ (and logo-small also becomes
// web/public/brand/favicon.svg and app/assets/header-mark.svg); everything else is rasterised
// from those same bytes by sharp (libvips) locally - no online service, no network.
// The tile colour is PARSED from the SVGs, never hard-coded in this file.
//
// Run: node scripts/build-icons.mjs        (exit 0 = built and every check passed)
// Output on stdout is stable across runs (paths relative, no timings) so two runs can be
// diffed byte-for-byte to prove determinism.
//
// Platform rules encoded below (sources in docs/BRANDING.md):
//   iOS app icon / apple-touch-icon : opaque, full bleed, no alpha channel.
//   Android adaptive foreground     : 108dp layer, artwork inside the guaranteed 66dp safe zone
//                                     (rendered here at 4px/dp -> 432px canvas, 264px artwork).
//   Android notification icon       : 96x96, all-white with transparency.
//   Web manifest (maskable)         : full-bleed tile colour, artwork inside the 80% diameter circle.
//   Expo splash                     : 1024x1024 transparent PNG with the card letterboxed inside.
//   In-app auth logo (rounded)      : logo.svg rasterised WITHOUT flattening, so the SVG's own rx=38/160
//                                     rounded corners stay transparent - matches the landing page, which
//                                     shows the same SVG. Displayed at 160/120pt; exported at 480px = 3x.

import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'brand-source');
const WEB_DIR = path.join(ROOT, 'web', 'public', 'brand');
const APP_DIR = path.join(ROOT, 'app', 'assets');

const SOURCE_SVGS = ['logo.svg', 'logo-small.svg', 'logo-mono.svg', 'logo-card.svg'];

// Explicit encoder options so the bytes cannot drift between sharp releases.
const PNG_OPTS = { compressionLevel: 9, adaptiveFiltering: false, palette: false };

// Adaptive icon geometry, in px at 4 device-independent px per dp.
const ADAPTIVE_CANVAS = 432; // 108dp layer
const ADAPTIVE_ART = 264; //  66dp guaranteed safe zone
const ADAPTIVE_OFFSET = (ADAPTIVE_CANVAS - ADAPTIVE_ART) / 2; // 84
// Web manifest maskable artwork: 88% of the canvas, centred, leaves the 80% circle clear.
const MASKABLE_SCALE = 0.88;
const MASKABLE_RADIUS = 0.4; // fraction of canvas covered by the 80% diameter safe circle
const NOTIFY_SIZE = 96;
const ICO_SIZES = [48, 32, 16];
// In-app rounded logo: AuthPage shows it at 160pt (120pt under 360px wide); 480px = 160 x 3 (X7/U9 3x).
const LOGO_ROUNDED_SIZE = 480;

const checks = [];
const manifest = [];
const dims = [];

function rel(p) {
  return path.relative(ROOT, p).split(path.sep).join('/');
}

function hash(buf) {
  return createHash('blake2b512').update(buf).digest('hex');
}

function assert(condition, label, detail) {
  checks.push({ ok: Boolean(condition), label, detail: detail === undefined ? '' : String(detail) });
}

async function read(file) {
  return fsp.readFile(file);
}

async function writeOut(file, buf) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, buf);
}

async function record(file, buf) {
  await writeOut(file, buf);
  const onDisk = await read(file);
  manifest.push({ path: rel(file), bytes: onDisk.length, hash: hash(onDisk) });
  return onDisk;
}

// Rasterise an SVG at a size that is never upsampled below the requested width, then resize to
// the exact target. `srcW` is the intrinsic width declared by the SVG.
async function raster(svg, srcW, width, height, opts = {}) {
  const { flattenTo = null, fit = 'fill' } = opts;
  const density = 72 * Math.max(1, width / srcW);
  let pipeline = sharp(svg, { density }).resize(width, height, { fit });
  if (flattenTo) pipeline = pipeline.flatten({ background: flattenTo }).removeAlpha();
  return pipeline.png(PNG_OPTS).toBuffer();
}

async function onCanvas(width, height, background, layers, { opaque }) {
  let pipeline = sharp({
    create: { width, height, channels: 4, background },
  }).composite(layers);
  // sharp keeps the alpha channel after flatten() when a composite() preceded it, so drop it
  // explicitly - iOS app icons and maskable manifest icons must be opaque.
  if (opaque) pipeline = pipeline.flatten({ background }).removeAlpha();
  return pipeline.png(PNG_OPTS).toBuffer();
}

async function dimensions(buf) {
  const meta = await sharp(buf).metadata();
  return { width: meta.width, height: meta.height, hasAlpha: meta.hasAlpha === true };
}

async function rgba(buf) {
  const { data, info } = await sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function hexToRgb(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

// The tile colour comes from the owner's SVGs (first rect of each tile file), never a literal here.
function tileColour(svg, name) {
  const m = /<rect[^>]*\sfill="(#[0-9a-fA-F]{6})"/.exec(svg.toString('utf8'));
  if (!m) throw new Error(`${name}: no filled rect found, cannot read the tile colour`);
  return m[1];
}

async function main() {
  const sources = new Map();
  for (const name of SOURCE_SVGS) {
    const file = path.join(SRC_DIR, name);
    let buf;
    try {
      buf = await read(file);
    } catch {
      throw new Error(`missing source: ${rel(file)} - STOP, the four owner SVGs are required`);
    }
    sources.set(name, buf);
  }

  const tile = tileColour(sources.get('logo.svg'), 'logo.svg');
  for (const name of ['logo-small.svg', 'logo-card.svg']) {
    const other = tileColour(sources.get(name), name);
    assert(
      other.toLowerCase() === tile.toLowerCase(),
      `tile colour agrees across sources: ${name}`,
      other,
    );
  }
  const tileRgb = hexToRgb(tile);

  // ---- 1. byte copies (source == destination, proven with blake2b512) ----
  const copies = [
    ...SOURCE_SVGS.map((name) => ({ from: path.join(SRC_DIR, name), to: path.join(WEB_DIR, name) })),
    { from: path.join(SRC_DIR, 'logo-small.svg'), to: path.join(WEB_DIR, 'favicon.svg') },
    { from: path.join(SRC_DIR, 'logo-small.svg'), to: path.join(APP_DIR, 'header-mark.svg') },
  ];
  for (const { from, to } of copies) {
    const srcBuf = await read(from);
    const written = await record(to, srcBuf);
    assert(hash(srcBuf) === hash(written), `copy byte-identical: ${rel(to)}`, written.length);
    dims.push({ path: rel(to), spec: 'vector source' });
  }

  // ---- 2. rasterised outputs ----
  const logo = sources.get('logo.svg');
  const logoSmall = sources.get('logo-small.svg');
  const logoMono = sources.get('logo-mono.svg');
  const logoCard = sources.get('logo-card.svg');

  const pngTargets = [];

  // logo.svg -> iOS / Expo / web manifest / apple touch
  pngTargets.push({
    file: path.join(APP_DIR, 'app-icon-1024.png'),
    width: 1024,
    height: 1024,
    opaque: true,
    build: () => raster(logo, 160, 1024, 1024, { flattenTo: tile }),
  });
  pngTargets.push({
    file: path.join(WEB_DIR, 'apple-touch-icon.png'),
    width: 180,
    height: 180,
    opaque: true,
    build: () => raster(logo, 160, 180, 180, { flattenTo: tile }),
  });
  for (const size of [512, 192]) {
    const art = Math.round(size * MASKABLE_SCALE);
    const off = Math.round((size - art) / 2);
    pngTargets.push({
      file: path.join(WEB_DIR, `web-manifest-${size}.png`),
      width: size,
      height: size,
      opaque: true,
      build: async () => {
        const artwork = await raster(logo, 160, art, art);
        return onCanvas(size, size, { ...tileRgb, alpha: 1 }, [{ input: artwork, left: off, top: off }], {
          opaque: true,
        });
      },
    });
  }

  // logo.svg -> Android adaptive foreground (transparent, artwork inside the 66dp safe zone)
  const adaptivePng = await (async () => {
    const artwork = await raster(logo, 160, ADAPTIVE_ART, ADAPTIVE_ART);
    return onCanvas(
      ADAPTIVE_CANVAS,
      ADAPTIVE_CANVAS,
      { r: 0, g: 0, b: 0, alpha: 0 },
      [{ input: artwork, left: ADAPTIVE_OFFSET, top: ADAPTIVE_OFFSET }],
      { opaque: false },
    );
  })();
  const adaptiveFile = path.join(APP_DIR, 'adaptive-icon-foreground.png');

  // logo.svg -> in-app rounded logo for the auth screen (item B, 22 Oct 2026 owner option 4).
  // NO flattenTo: the SVG's rx=38 rounded tile keeps its transparent corners, matching the landing
  // page's /brand/logo.svg. Store icon / adaptive / splash outputs above are untouched.
  pngTargets.push({
    file: path.join(APP_DIR, 'logo-rounded.png'),
    width: LOGO_ROUNDED_SIZE,
    height: LOGO_ROUNDED_SIZE,
    opaque: false,
    build: () => raster(logo, 160, LOGO_ROUNDED_SIZE, LOGO_ROUNDED_SIZE),
  });

  // logo-small.svg -> small web icons
  for (const size of ICO_SIZES) {
    pngTargets.push({
      file: path.join(WEB_DIR, `icon-${size}.png`),
      width: size,
      height: size,
      opaque: false,
      build: () => raster(logoSmall, 160, size, size),
    });
  }

  // logo-mono.svg -> Android notification small icon (96x96, white, transparent)
  const notifyPng = await raster(logoMono, 160, NOTIFY_SIZE, NOTIFY_SIZE);
  const notifyFile = path.join(APP_DIR, 'notification-icon.png');

  // logo-card.svg -> Open Graph share card
  pngTargets.push({
    file: path.join(WEB_DIR, 'og-image-1200x630.png'),
    width: 1200,
    height: 630,
    opaque: true,
    build: () => raster(logoCard, 1200, 1200, 630, { flattenTo: tile }),
  });

  // logo-card.svg -> Expo splash: card letterboxed inside a 1024x1024 transparent canvas
  const splashCard = await raster(logoCard, 1200, 1024, 1024, { fit: 'inside' });
  const splashMeta = await dimensions(splashCard);
  const splashPng = await onCanvas(
    1024,
    1024,
    { r: 0, g: 0, b: 0, alpha: 0 },
    [
      {
        input: splashCard,
        left: Math.round((1024 - splashMeta.width) / 2),
        top: Math.round((1024 - splashMeta.height) / 2),
      },
    ],
    { opaque: false },
  );
  const splashFile = path.join(APP_DIR, 'splash.png');

  // ---- 3. write everything and record it ----
  const built = new Map();
  for (const target of pngTargets) {
    built.set(target.file, await record(target.file, await target.build()));
  }
  built.set(adaptiveFile, await record(adaptiveFile, adaptivePng));
  built.set(notifyFile, await record(notifyFile, notifyPng));
  built.set(splashFile, await record(splashFile, splashPng));

  // favicon.ico from three logo-small PNGs (png-to-ico writes 32-bit BMP entries, deterministic)
  const icoInputs = await Promise.all(
    ICO_SIZES.map((size) => raster(logoSmall, 160, size, size)),
  );
  const icoBuf = await pngToIco(icoInputs);
  const icoFile = path.join(WEB_DIR, 'favicon.ico');
  const icoOnDisk = await record(icoFile, icoBuf);

  // ---- 4. checks ----

  // dimensions + alpha expectations
  for (const target of pngTargets) {
    const buf = built.get(target.file);
    const d = await dimensions(buf);
    assert(
      d.width === target.width && d.height === target.height,
      `dimensions: ${rel(target.file)}`,
      `${d.width}x${d.height}`,
    );
    assert(
      d.hasAlpha === !target.opaque,
      `alpha expectation: ${rel(target.file)}`,
      `hasAlpha=${d.hasAlpha}`,
    );
    dims.push({
      path: rel(target.file),
      spec: `${d.width}x${d.height} ${d.hasAlpha ? 'transparent' : 'opaque'}`,
    });
    if (target.opaque) {
      // the transparent rounded corner of the SVG must have been merged into the tile colour
      const { data } = await rgba(built.get(target.file));
      const px = [data[0], data[1], data[2], data[3]];
      const merged =
        px[3] === 255 &&
        Math.abs(px[0] - tileRgb.r) <= 1 &&
        Math.abs(px[1] - tileRgb.g) <= 1 &&
        Math.abs(px[2] - tileRgb.b) <= 1;
      assert(merged, `opaque corner filled with tile colour: ${rel(target.file)}`, px.join(','));
    }
  }

  // adaptive foreground: transparent canvas, artwork confined to the safe-zone box
  const adim = await dimensions(built.get(adaptiveFile));
  assert(
    adim.width === ADAPTIVE_CANVAS && adim.height === ADAPTIVE_CANVAS,
    'adaptive foreground dimensions',
    `${adim.width}x${adim.height}`,
  );
  assert(adim.hasAlpha, 'adaptive foreground keeps transparency', adim.hasAlpha);
  dims.push({
    path: rel(adaptiveFile),
    spec: `${adim.width}x${adim.height} transparent`,
  });
  {
    const { data, width, height } = await rgba(built.get(adaptiveFile));
    let outside = 0;
    let inked = 0;
    const lo = ADAPTIVE_OFFSET;
    const hi = ADAPTIVE_OFFSET + ADAPTIVE_ART;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const a = data[(y * width + x) * 4 + 3];
        if (a === 0) continue;
        inked++;
        if (x < lo || x >= hi || y < lo || y >= hi) outside++;
      }
    }
    assert(inked > 0, 'adaptive foreground has artwork', inked);
    assert(outside === 0, 'adaptive artwork inside the 66dp safe zone', `${outside} px outside`);
  }

  // in-app rounded logo: transparent corners (the SVG's rx=38/160), opaque centre
  {
    const file = path.join(APP_DIR, 'logo-rounded.png');
    const d = await dimensions(built.get(file));
    assert(
      d.width === LOGO_ROUNDED_SIZE && d.height === LOGO_ROUNDED_SIZE,
      'logo-rounded dimensions',
      `${d.width}x${d.height}`,
    );
    assert(d.hasAlpha, 'logo-rounded keeps transparency', d.hasAlpha);
    dims.push({ path: rel(file), spec: `${d.width}x${d.height} transparent` });
    const { data, width, height } = await rgba(built.get(file));
    const corners = [
      [0, 0],
      [width - 1, 0],
      [0, height - 1],
      [width - 1, height - 1],
    ].map(([x, y]) => data[(y * width + x) * 4 + 3]);
    assert(
      corners.every((a) => a === 0),
      'logo-rounded four corner pixels fully transparent',
      corners.join(','),
    );
    const cx = Math.floor(width / 2);
    const cy = Math.floor(height / 2);
    const centreAlpha = data[(cy * width + cx) * 4 + 3];
    assert(centreAlpha === 255, 'logo-rounded centre opaque', centreAlpha);
  }

  // notification icon: 96x96, white where visible, transparent at the five cell cut-outs
  const ndim = await dimensions(built.get(notifyFile));
  assert(
    ndim.width === NOTIFY_SIZE && ndim.height === NOTIFY_SIZE,
    'notification icon dimensions',
    `${ndim.width}x${ndim.height}`,
  );
  dims.push({
    path: rel(notifyFile),
    spec: `${ndim.width}x${ndim.height} transparent`,
  });
  {
    const { data, width, height } = await rgba(built.get(notifyFile));
    let minChannel = 255;
    let visible = 0;
    let transparent = 0;
    for (let i = 0; i < width * height; i++) {
      const a = data[i * 4 + 3];
      if (a === 0) {
        transparent++;
        continue;
      }
      visible++;
      minChannel = Math.min(minChannel, data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    }
    assert(visible > 0, 'notification icon has visible pixels', visible);
    assert(transparent > 0, 'notification icon has transparency', transparent);
    assert(minChannel >= 250, 'notification icon is all-white', `min channel ${minChannel}`);

    // centres of the five mask cut-outs (160-space centre -> 96-space)
    const holes = [
      [46, 59],
      [80, 59],
      [114, 59],
      [63, 95],
      [97, 95],
    ].map(([x, y]) => [Math.round((x * NOTIFY_SIZE) / 160), Math.round((y * NOTIFY_SIZE) / 160)]);
    const holeAlpha = holes.map(([x, y]) => data[(y * width + x) * 4 + 3]);
    assert(
      holeAlpha.every((a) => a === 0),
      'notification icon cell cut-outs are transparent',
      holeAlpha.join(','),
    );
    // a point on the solid body must be opaque white
    const bx = Math.round((25 * NOTIFY_SIZE) / 160);
    const by = Math.round((35 * NOTIFY_SIZE) / 160);
    const body = data.slice((by * width + bx) * 4, (by * width + bx) * 4 + 4);
    assert(
      body[3] === 255 && body[0] === 255 && body[1] === 255 && body[2] === 255,
      'notification icon body is opaque white',
      body.join(','),
    );
  }

  // manifest icons: full-bleed tile colour, artwork inside the 80% maskable circle
  for (const size of [512, 192]) {
    const file = path.join(WEB_DIR, `web-manifest-${size}.png`);
    const { data, width, height } = await rgba(built.get(file));
    const cx = width / 2;
    const cy = height / 2;
    const limit = MASKABLE_RADIUS * Math.min(width, height);
    let outside = 0;
    let offColour = 0;
    let worst = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const dr = Math.abs(data[i] - tileRgb.r);
        const dg = Math.abs(data[i + 1] - tileRgb.g);
        const db = Math.abs(data[i + 2] - tileRgb.b);
        if (dr <= 2 && dg <= 2 && db <= 2) continue;
        offColour++;
        const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        worst = Math.max(worst, dist);
        if (dist > limit) outside++;
      }
    }
    assert(offColour > 0, `manifest ${size}: artwork present`, offColour);
    assert(
      outside === 0,
      `manifest ${size}: maskable 80% circle respected`,
      `worst ${worst.toFixed(1)}px of ${limit.toFixed(1)}px`,
    );
  }

  // splash
  const sdim = await dimensions(built.get(splashFile));
  assert(sdim.width === 1024 && sdim.height === 1024, 'splash dimensions', `${sdim.width}x${sdim.height}`);
  assert(sdim.hasAlpha, 'splash keeps transparency', sdim.hasAlpha);
  dims.push({ path: rel(splashFile), spec: `${sdim.width}x${sdim.height} transparent` });

  // favicon.ico header + directory entries
  assert(icoOnDisk.readUInt16LE(0) === 0 && icoOnDisk.readUInt16LE(2) === 1, 'ico header valid');
  const icoCount = icoOnDisk.readUInt16LE(4);
  const icoSizes = [];
  for (let i = 0; i < icoCount; i++) icoSizes.push(icoOnDisk.readUInt8(6 + i * 16));
  assert(icoCount === ICO_SIZES.length, 'ico entry count', icoCount);
  assert(
    JSON.stringify(icoSizes) === JSON.stringify(ICO_SIZES),
    'ico contains 48/32/16',
    icoSizes.join(','),
  );
  dims.push({ path: rel(icoFile), spec: `${icoSizes.join('/')} px multi-size` });

  // ---- 5. report (stable text: relative paths, no timings, no absolute paths) ----
  manifest.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  dims.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const lines = [];
  lines.push('rowta icon pipeline');
  lines.push(`sources ${SOURCE_SVGS.length} svg, tile colour from svg ${tile}`);
  lines.push('files ' + manifest.length);
  for (const row of manifest) {
    lines.push(`${row.hash}  ${String(row.bytes).padStart(7)}  ${row.path}`);
  }
  lines.push('dimensions ' + dims.length);
  for (const row of dims) {
    lines.push(`${row.spec.padEnd(30)}  ${row.path}`);
  }
  lines.push('checks ' + checks.length);
  for (const check of checks) {
    lines.push(`${check.ok ? 'PASS' : 'FAIL'}  ${check.label}${check.detail ? ` (${check.detail})` : ''}`);
  }
  const failed = checks.filter((c) => !c.ok);
  lines.push(failed.length === 0 ? `ALL CHECKS PASSED ${checks.length}` : `CHECKS FAILED ${failed.length}`);
  console.log(lines.join('\n'));
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`icon pipeline failed: ${err && err.message ? err.message : err}`);
  process.exitCode = 1;
});
