import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJellyfin, matchesJellyfin, jellyfinFacts } from "./panel-scene.js";

// Shaped like the real sensor output from a live Jellyfin session.
const data = {
  title: "Clarkson's Farm", episode_title: "Reaping", season: 5, episode: 8,
  overview: "With the farm still reeling...", year: 2026, rating: 8.8,
  official_rating: "", runtime_min: 71, genres: ["Documentary", "Comedy", "Reality-TV"],
  type: "Episode", poster: "https://jellyfin.home/Items/abc/Images/Primary",
};
const sensor = (state, d = data) => ({ state, attributes: { data: d } });
const tv = (state, title) => ({ state, attributes: { media_title: title } });

test("parseJellyfin reads an object or a JSON string, only while playing or paused", () => {
  assert.equal(parseJellyfin(sensor("paused")).title, "Clarkson's Farm");
  assert.equal(parseJellyfin(sensor("playing", JSON.stringify(data))).episode, 8);
  assert.equal(parseJellyfin(sensor("idle")), null);
  assert.equal(parseJellyfin(sensor("playing", "not json")), null);
  assert.equal(parseJellyfin(sensor("playing", {})), null);
  assert.equal(parseJellyfin(undefined), null);
});

test("matchesJellyfin accepts the series or episode title, ignoring case and punctuation", () => {
  assert.equal(matchesJellyfin(tv("paused", "Clarkson's Farm"), data), true);
  assert.equal(matchesJellyfin(tv("paused", "CLARKSON’S FARM"), data), true);
  assert.equal(matchesJellyfin(tv("playing", "Reaping"), data), true);
});

test("matchesJellyfin refuses a different show, a stopped TV or a missing title", () => {
  assert.equal(matchesJellyfin(tv("paused", "Blade Runner 2049"), data), false);
  assert.equal(matchesJellyfin(tv("idle", "Clarkson's Farm"), data), false);
  assert.equal(matchesJellyfin(tv("paused", ""), data), false);
  assert.equal(matchesJellyfin(undefined, data), false);
});

test("jellyfinFacts builds the episode line and chips", () => {
  const f = jellyfinFacts(data);
  assert.equal(f.line, "S5 · E8 · Reaping");
  assert.deepEqual(f.chips, ["2026", "★ 8.8", "71 min", "Documentary · Comedy"]);
});

test("jellyfinFacts copes with a movie with sparse data", () => {
  const f = jellyfinFacts({ title: "Heat", year: 1995, official_rating: "R", genres: [], runtime_min: 170 });
  assert.equal(f.line, "");
  assert.deepEqual(f.chips, ["1995", "170 min", "R"]);
});

import { sameText } from "./panel-scene.js";

test("sameText ignores case and punctuation but never matches empty labels", () => {
  assert.equal(sameText("Francois van Coke", "Francois Van Coke"), true);
  assert.equal(sameText("Hurry Up, We're Dreaming", "hurry up we re dreaming"), true);
  assert.equal(sameText("Hurry Up, We're Dreaming", "M83"), false);
  assert.equal(sameText("", ""), false);
  assert.equal(sameText(undefined, "x"), false);
});
