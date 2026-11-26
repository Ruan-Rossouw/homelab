// A calm sky-coloured background for the home screen, driven by how high the
// sun is (Home Assistant's `sun.sun`: elevation and rising/setting) and the
// weather. Pure functions, unit-tested, no DOM.
//
// Design rules (so it stays pleasant and readable on a small panel):
//   * Colours are deliberately deep, never bright: the white clock and tiles
//     must stay legible, so every stop is kept below MAX_LUMINANCE.
//   * Only static CSS gradients (no blur, no animation): light for a Mali-400.
//   * The palette moves smoothly with elevation (linear blend between
//     keyframes), with different warm tones for sunrise and sunset.
//   * Weather mixes the sky toward a grey-blue tint and softens the sun glow.

export const MAX_LUMINANCE = 0.36;

// elevation (degrees) -> [top, middle, bottom] while rising and while setting
const KEYS = [
  { e: -14, rise: ["#050b1a", "#0a1830", "#112747"], set: ["#050b1a", "#0a1830", "#112747"] },
  { e: -6, rise: ["#121f4a", "#363a6e", "#8a5878"], set: ["#101b44", "#32336a", "#7d4c6c"] },
  { e: 0, rise: ["#27386f", "#8b587c", "#d98a5c"], set: ["#23326a", "#7e4a78", "#d3703f"] },
  { e: 8, rise: ["#285894", "#5f80a8", "#c58862"], set: ["#254f89", "#6d729c", "#c78a58"] },
  { e: 25, rise: ["#184a88", "#276ba1", "#3f86ad"], set: ["#184a88", "#276ba1", "#3f86ad"] },
  { e: 55, rise: ["#123a76", "#1f609a", "#3679a6"], set: ["#123a76", "#1f609a", "#3679a6"] },
];

// weather state -> tint colour and how far to mix toward it (0..1)
const WEATHER = {
  sunny: null,
  "clear-night": null,
  partlycloudy: { c: "#60758b", a: 0.14 },
  cloudy: { c: "#566a7e", a: 0.34 },
  fog: { c: "#68788a", a: 0.4 },
  rainy: { c: "#3b4a5c", a: 0.5 },
  pouring: { c: "#2f3d4f", a: 0.58 },
  snowy: { c: "#7a8ea4", a: 0.32 },
  "snowy-rainy": { c: "#566a80", a: 0.42 },
  hail: { c: "#3b4a5c", a: 0.5 },
  lightning: { c: "#2d3849", a: 0.56 },
  "lightning-rainy": { c: "#2a3546", a: 0.6 },
  windy: { c: "#60758b", a: 0.12 },
  "windy-variant": { c: "#60758b", a: 0.16 },
  exceptional: { c: "#3b4a5c", a: 0.4 },
};

export const hexToRgb = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (rgb) => `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// WCAG relative luminance of an [r,g,b] colour.
export function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Three gradient stops (hex) for this sun height, blended between keyframes.
export function skyStops(elevation, rising) {
  const e = Math.max(KEYS[0].e, Math.min(KEYS[KEYS.length - 1].e, elevation));
  let i = 0;
  while (i < KEYS.length - 2 && e > KEYS[i + 1].e) i++;
  const lo = KEYS[i], hi = KEYS[i + 1];
  const t = (e - lo.e) / (hi.e - lo.e);
  const side = rising ? "rise" : "set";
  return lo[side].map((c, k) => mix(hexToRgb(c), hexToRgb(hi[side][k]), t));
}

// Everything needed to paint the sky. Returns null when the sun height is unknown.
export function skyPalette({ elevation, rising, weather }) {
  const el = Number(elevation);
  if (!Number.isFinite(el)) return null;
  const w = WEATHER[weather] || null;
  const stops = skyStops(el, rising !== false).map((rgb) => (w ? mix(rgb, hexToRgb(w.c), w.a) : rgb));
  // Soft sun glow near the horizon (east when rising, west when setting).
  const glowA = Math.max(0, 0.42 - Math.abs(el - 2) * 0.016) * (w ? 1 - w.a * 1.3 : 1);
  const glow = glowA > 0.02 ? {
    x: rising !== false ? 24 : 76,
    y: Math.max(52, 104 - Math.max(0, el) * 1.3),
    rgb: el < 12 ? [255, 168, 104] : [255, 226, 170],
    alpha: Math.min(0.45, glowA),
  } : null;
  const stars = el < -9 && (!w || w.a < 0.2);
  return { stops: stops.map(toHex), rgb: stops, glow, stars };
}

const STAR_SPOTS = [[12, 16, 1], [24, 38, 0.7], [37, 11, 0.9], [51, 27, 0.7], [63, 8, 1], [74, 33, 0.8], [86, 18, 0.9], [92, 44, 0.6], [6, 52, 0.6], [45, 47, 0.5]];

// The CSS `background` value for the palette.
export function skyCss(p) {
  if (!p) return "";
  const layers = [];
  if (p.stars) {
    STAR_SPOTS.forEach(([x, y, a]) => layers.push(`radial-gradient(1.5px 1.5px at ${x}% ${y}%, rgba(255,255,255,${a}), rgba(255,255,255,0))`));
  }
  if (p.glow) {
    const [r, g, b] = p.glow.rgb;
    layers.push(`radial-gradient(ellipse 70% 60% at ${p.glow.x}% ${p.glow.y.toFixed(0)}%, rgba(${r},${g},${b},${p.glow.alpha.toFixed(2)}), rgba(${r},${g},${b},0) 72%)`);
  }
  layers.push(`linear-gradient(180deg, ${p.stops[0]} 0%, ${p.stops[1]} 55%, ${p.stops[2]} 100%)`);
  return layers.join(", ");
}

// Short string that changes only when the picture visibly changes, so the card
// repaints a couple of times an hour instead of every tick.
export function skyKey({ elevation, rising, weather }) {
  const el = Number(elevation);
  return Number.isFinite(el) ? `${Math.round(el * 2) / 2}${rising === false ? "s" : "r"}${weather || ""}` : "";
}
