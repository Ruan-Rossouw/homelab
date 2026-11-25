// Pure helpers for the music scene's "fluid" background (the slowly drifting
// colour-blob gradient Apple Music draws behind the album art). No DOM here:
// pixels go in, colours and blob positions come out, so it is unit-tested
// with `npm test`.

// Used when there is no usable artwork (missing, or a blank placeholder).
export const DEFAULT_PALETTE = [
  [92, 52, 140], [168, 62, 116], [48, 86, 150], [196, 110, 70],
];

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h, s, l) {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => Math.round(v * 255));
}

// Keep a colour vivid enough to read as "colour" but dark enough that white
// text on top stays legible: saturation >= 0.55 (unless it is a true grey),
// lightness 0.26..0.52.
export function tuneColor([r, g, b]) {
  const [h, s, l] = rgbToHsl(r, g, b);
  return hslToRgb(h, s < 0.08 ? s : Math.max(s, 0.55), Math.min(0.52, Math.max(0.26, l)));
}

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// Standard deviation of luminance; a plain placeholder image has almost none.
function lumaSpread(data) {
  let sum = 0, sumSq = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    sum += y; sumSq += y * y; n++;
  }
  if (!n) return 0;
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sumSq / n - mean * mean));
}

// `data` is RGBA pixels (e.g. a 24x24 getImageData). Returns `count` tuned
// colours, most prominent first, or null when the image has no detail.
export function extractPalette(data, count = 4) {
  if (lumaSpread(data) < 6) return null;
  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const key = ((data[i] >> 5) << 6) | ((data[i + 1] >> 5) << 3) | (data[i + 2] >> 5);
    const e = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += data[i]; e.g += data[i + 1]; e.b += data[i + 2];
    buckets.set(key, e);
  }
  const ranked = [...buckets.values()].map((e) => {
    const rgb = [e.r / e.n, e.g / e.n, e.b / e.n];
    const [, s, l] = rgbToHsl(...rgb);
    const extreme = l < 0.1 || l > 0.92 ? 0.15 : 1; // near-black / near-white are poor blobs
    return { rgb, score: e.n * (0.25 + s) * extreme };
  }).sort((a, b) => b.score - a.score);

  const picked = [];
  for (const { rgb } of ranked) {
    if (picked.every((p) => dist(p, rgb) > 70)) picked.push(rgb);
    if (picked.length === count) break;
  }
  // Few distinct colours (a mostly one-colour cover): invent neighbours by
  // shifting the hue, so the gradient still has something to drift between.
  const [h, s, l] = rgbToHsl(...(picked[0] || DEFAULT_PALETTE[0]));
  for (let k = 1; picked.length < count; k++) {
    picked.push(hslToRgb(h + 0.08 * k * (k % 2 ? 1 : -1), Math.max(s, 0.4), l));
  }
  return picked.map(tuneColor);
}

// Blob positions at time `t` seconds, in 0..1 of the canvas width/height
// (radius is relative to the width). Slow Lissajous drift, ~30-45 s periods.
const BLOBS = [
  { x: 0.22, y: 0.28, ax: 0.2, ay: 0.16, fx: 0.21, fy: 0.17, px: 0.0, py: 1.3, r: 0.6 },
  { x: 0.8, y: 0.22, ax: 0.18, ay: 0.2, fx: 0.16, fy: 0.23, px: 2.1, py: 0.4, r: 0.55 },
  { x: 0.3, y: 0.82, ax: 0.2, ay: 0.14, fx: 0.19, fy: 0.15, px: 4.0, py: 2.6, r: 0.58 },
  { x: 0.82, y: 0.78, ax: 0.16, ay: 0.18, fx: 0.14, fy: 0.2, px: 1.1, py: 3.7, r: 0.52 },
];

export function blobs(t) {
  return BLOBS.map((b) => ({
    x: b.x + b.ax * Math.sin(t * b.fx + b.px),
    y: b.y + b.ay * Math.cos(t * b.fy + b.py),
    r: b.r,
  }));
}

// A calm palette for when there is no usable artwork (a video with no poster,
// a blank placeholder image): hue taken from a hash of the title, so a given
// title always gets the same colours and different titles differ. Kept dark
// and soft so white text stays readable. Empty text gives the default palette.
export function paletteFromText(text) {
  const t = String(text ?? "").trim().toLowerCase();
  if (!t) return DEFAULT_PALETTE;
  let h = 2166136261; // FNV-1a
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  const hue = (h % 360) / 360;
  return [0, 0.11, -0.09, 0.22].map((o, i) => tuneColor(hslToRgb(hue + o, 0.55 + 0.08 * (i % 2), 0.34 - 0.03 * i)));
}
