#!/usr/bin/env node
// VERIFY the in-app rounded auth logo (item B, owner option 4, 22 Oct 2026).
//
// Proves, from the bytes on disk:
//   1. the four corner pixels of app/assets/logo-rounded.png are fully transparent (alpha 0);
//   2. the centre pixel is fully opaque (alpha 255);
//   3. the measured corner radius / size ratio matches the landing logo's SVG ratio:
//      brand-source/logo.svg declares rx="38" on a 160x160 viewBox -> 38/160 = 0.2375.
//      Measurement: scan row 0 (top edge) from the left; the first opaque pixel sits at x = radius
//      for a rounded rect. Same from the right edge and the bottom edge. Four scans, four radii.
//
// Run: node scripts/verify-logo-rounded.mjs   (exit 0 = every check passed)
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PNG_FILE = path.join(ROOT, 'app', 'assets', 'logo-rounded.png');
const SVG_FILE = path.join(ROOT, 'brand-source', 'logo.svg');

const checks = [];

function assert(condition, label, detail) {
  checks.push({ ok: Boolean(condition), label, detail: detail === undefined ? '' : String(detail) });
}

async function main() {
  // --- SVG ratio (the landing logo's baked-in rounding) ---
  const svg = (await fsp.readFile(SVG_FILE)).toString('utf8');
  const rxMatch = /<rect[^>]*\swidth="160"[^>]*\srx="(\d+(?:\.\d+)?)"/.exec(svg) ?? /rx="(\d+(?:\.\d+)?)"/.exec(svg);
  if (!rxMatch) throw new Error('logo.svg: no rx attribute found');
  const svgRx = Number(rxMatch[1]);
  const svgRatio = svgRx / 160;

  // --- PNG pixels ---
  const { data, info } = await sharp(PNG_FILE)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const alphaAt = (x, y) => data[(y * width + x) * channels + 3];

  const corners = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ].map(([x, y]) => alphaAt(x, y));
  assert(
    corners.every((a) => a === 0),
    'four corner pixels fully transparent',
    corners.join(','),
  );

  const centreAlpha = alphaAt(Math.floor(width / 2), Math.floor(height / 2));
  assert(centreAlpha === 255, 'centre pixel fully opaque', centreAlpha);

  // --- measured radius: first FULLY OPAQUE pixel along each edge from its corner ---
  // The corner curve is anti-aliased against transparency, so alpha ramps 0 -> 255 over a short
  // feather; the geometric edge is where alpha first reaches 255 (verified: feather x=99..112,
  // solid from x=113 on a 480px export; 38/160 * 480 = 114).
  function scanRow(y, fromLeft) {
    const xs = fromLeft ? [...Array(width).keys()] : [...Array(width).keys()].reverse();
    for (const x of xs) {
      if (alphaAt(x, y) === 255) return fromLeft ? x : width - 1 - x;
    }
    return -1;
  }
  const radii = [
    scanRow(0, true), // top edge from left  -> top-left radius
    scanRow(0, false), // top edge from right -> top-right radius
    scanRow(height - 1, true), // bottom-left
    scanRow(height - 1, false), // bottom-right
  ];
  assert(
    radii.every((r) => r > 0),
    'all four edges measured a positive radius',
    radii.join(','),
  );
  const measuredRadius = radii[0];
  const measuredRatio = measuredRadius / width;

  // --- ratio comparison (SVG vs PNG), exact for integer rx scaled to integer pixels ---
  const expectedPx = (svgRx / 160) * width;
  const ratioMatches = Math.abs(measuredRatio - svgRatio) < 0.005 && Math.abs(measuredRadius - expectedPx) <= 1;
  assert(
    ratioMatches,
    'measured rounding ratio matches landing SVG rx/160',
    `svg ${svgRx}/160=${svgRatio.toFixed(4)}; png ${measuredRadius}/${width}=${measuredRatio.toFixed(4)}; expected px ${expectedPx.toFixed(2)}`,
  );

  // --- report ---
  console.log('rowta logo-rounded verify');
  console.log(`file ${path.relative(ROOT, PNG_FILE).split(path.sep).join('/')} ${width}x${height}`);
  console.log(`landing svg rx=${svgRx} on 160 viewBox -> ratio ${svgRatio.toFixed(4)} (${svgRatio * 100}%)`);
  console.log(
    `png measured radius ${measuredRadius}px on ${width}px -> ratio ${measuredRatio.toFixed(4)} (${(measuredRatio * 100).toFixed(2)}%)`,
  );
  console.log(`edge radii TL/TR/BL/BR ${radii.join('/')}`);
  for (const check of checks) {
    console.log(`${check.ok ? 'PASS' : 'FAIL'}  ${check.label}${check.detail ? ` (${check.detail})` : ''}`);
  }
  const failed = checks.filter((c) => !c.ok);
  console.log(failed.length === 0 ? `ALL CHECKS PASSED ${checks.length}` : `CHECKS FAILED ${failed.length}`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`logo-rounded verify failed: ${err && err.message ? err.message : err}`);
  process.exitCode = 1;
});
