import { test } from "node:test";
import assert from "node:assert/strict";
import { skyPalette, skyCss, skyKey, luminance, MAX_LUMINANCE } from "./sky.js";

const WEATHERS = ["sunny", "clear-night", "partlycloudy", "cloudy", "fog", "rainy", "pouring", "snowy", "lightning-rainy", "windy", undefined];

test("every colour stays dark enough for white text, at every height and weather", () => {
  for (let el = -25; el <= 90; el += 1) {
    for (const rising of [true, false]) {
      for (const weather of WEATHERS) {
        const p = skyPalette({ elevation: el, rising, weather });
        p.rgb.forEach((c) => assert.ok(luminance(c) <= MAX_LUMINANCE, `luminance too high at ${el} ${rising} ${weather}`));
      }
    }
  }
});

test("night is darker than day", () => {
  const avg = (p) => p.rgb.reduce((s, c) => s + luminance(c), 0) / 3;
  assert.ok(avg(skyPalette({ elevation: -20, rising: true })) < avg(skyPalette({ elevation: 40, rising: true })) / 3);
});

test("the sky moves smoothly: neighbouring heights give near-identical colours", () => {
  for (let el = -14; el < 55; el += 0.5) {
    const a = skyPalette({ elevation: el, rising: true }).rgb, b = skyPalette({ elevation: el + 0.5, rising: true }).rgb;
    a.forEach((c, i) => c.forEach((v, k) => assert.ok(Math.abs(v - b[i][k]) < 14, `jump at ${el}`)));
  }
});

test("sunrise and sunset use different warm tones", () => {
  const r = skyPalette({ elevation: 0, rising: true }).stops[2], s = skyPalette({ elevation: 0, rising: false }).stops[2];
  assert.notEqual(r, s);
});

test("weather greys the sky and softens the glow", () => {
  const clear = skyPalette({ elevation: 3, rising: true, weather: "sunny" });
  const rain = skyPalette({ elevation: 3, rising: true, weather: "rainy" });
  const sat = (rgb) => Math.max(...rgb) - Math.min(...rgb);
  assert.ok(sat(rain.rgb[1]) < sat(clear.rgb[1]));
  assert.ok(rain.glow.alpha < clear.glow.alpha);
});

test("stars only on a clear night; glow only near the horizon", () => {
  assert.equal(skyPalette({ elevation: -20, rising: false, weather: "clear-night" }).stars, true);
  assert.equal(skyPalette({ elevation: -20, rising: false, weather: "rainy" }).stars, false);
  assert.equal(skyPalette({ elevation: 50, rising: true }).glow, null);
});

test("unknown sun height gives no sky; css and key are well formed", () => {
  assert.equal(skyPalette({ elevation: undefined }), null);
  assert.equal(skyCss(null), "");
  assert.match(skyCss(skyPalette({ elevation: 20, rising: true })), /linear-gradient\(180deg/);
  assert.equal(skyKey({ elevation: 20.3, rising: false, weather: "cloudy" }), "20.5scloudy");
});
