import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPalette, tuneColor, blobs, DEFAULT_PALETTE, paletteFromText } from "./fluid-palette.js";

// Build RGBA pixel data from [rgb, count] runs.
function pixels(runs) {
  const out = [];
  for (const [[r, g, b], n] of runs) for (let i = 0; i < n; i++) out.push(r, g, b, 255);
  return Uint8ClampedArray.from(out);
}
const hue = ([r, g, b]) => {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return -1;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round(((h * 60) + 360) % 360);
};
const lightness = ([r, g, b]) => (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255;

test("a plain placeholder image has no palette", () => {
  assert.equal(extractPalette(pixels([[[255, 255, 255], 400]])), null);
  assert.equal(extractPalette(pixels([[[250, 250, 250], 300], [[252, 252, 252], 100]])), null);
});

test("the dominant colours of a cover come out, most prominent first", () => {
  const p = extractPalette(pixels([[[200, 30, 30], 250], [[30, 40, 200], 150], [[30, 200, 60], 100]]));
  assert.equal(p.length, 4);
  assert.ok(Math.abs(hue(p[0]) - 0) <= 12 || hue(p[0]) >= 348, "first is red");
  const hues = p.slice(0, 3).map(hue);
  assert.ok(hues.some((h) => Math.abs(h - 230) < 25), "has a blue");
  assert.ok(hues.some((h) => Math.abs(h - 130) < 25), "has a green");
});

test("every colour is tuned dark enough for white text", () => {
  const p = extractPalette(pixels([[[255, 240, 120], 300], [[250, 250, 250], 100], [[10, 10, 10], 100]]));
  for (const c of p) {
    const l = lightness(c);
    assert.ok(l >= 0.25 && l <= 0.53, `lightness ${l} out of range`);
  }
});

test("a mostly one-colour cover still yields four colours", () => {
  const p = extractPalette(pixels([[[200, 40, 60], 480], [[40, 40, 40], 20]]));
  assert.equal(p.length, 4);
});

test("a black and white cover does not crash and gives four colours", () => {
  const p = extractPalette(pixels([[[0, 0, 0], 200], [[255, 255, 255], 200]]));
  assert.equal(p.length, 4);
});

test("tuneColor clamps lightness and keeps greys grey", () => {
  assert.ok(lightness(tuneColor([255, 255, 200])) <= 0.52 + 0.01);
  assert.ok(lightness(tuneColor([5, 5, 20])) >= 0.26 - 0.01);
  const [r, g, b] = tuneColor([128, 128, 128]);
  assert.ok(r === g && g === b);
});

test("the default palette has four colours", () => {
  assert.equal(DEFAULT_PALETTE.length, 4);
});

test("blobs drift slowly and stay on the canvas", () => {
  let moved = false;
  for (let t = 0; t <= 300; t += 0.5) {
    for (const b of blobs(t)) {
      assert.ok(b.x > -0.1 && b.x < 1.1 && b.y > -0.1 && b.y < 1.1, `blob off canvas at t=${t}`);
    }
  }
  const a = blobs(0), c = blobs(10);
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i].x - c[i].x) > 0.02) moved = true;
  assert.ok(moved, "blobs should move over 10 s");
  // slow: no blob jumps more than 3% of the width in a 0.2 s frame step
  const f0 = blobs(100), f1 = blobs(100.2);
  for (let i = 0; i < f0.length; i++) assert.ok(Math.hypot(f0[i].x - f1[i].x, f0[i].y - f1[i].y) < 0.03);
});

test("paletteFromText is stable per title and differs between titles", () => {
  const a = paletteFromText("Clarkson's Farm");
  assert.deepEqual(a, paletteFromText("  clarkson's farm  "));
  assert.notDeepEqual(a, paletteFromText("Mutiny"));
  assert.notDeepEqual(paletteFromText("Mutiny")[0], paletteFromText("How Lay's Potato Chips Are Made")[0]);
});

test("paletteFromText gives four dark, soft colours that suit white text", () => {
  for (const title of ["Mutiny", "Heat", "How Lay's Potato Chips Are Made In Factory", "a", "Ünïcødé Tïtle"]) {
    const p = paletteFromText(title);
    assert.equal(p.length, 4);
    for (const c of p) {
      assert.ok(c.every((v) => Number.isInteger(v) && v >= 0 && v <= 255), `bad channel in ${c}`);
      const l = lightness(c);
      assert.ok(l >= 0.25 && l <= 0.53, `${title}: lightness ${l}`);
    }
  }
});

test("paletteFromText falls back to the default palette for no title", () => {
  assert.deepEqual(paletteFromText(""), DEFAULT_PALETTE);
  assert.deepEqual(paletteFromText(undefined), DEFAULT_PALETTE);
});
