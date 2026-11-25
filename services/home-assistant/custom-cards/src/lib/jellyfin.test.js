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

import { mediaControls, controlCall } from "./panel-scene.js";

const player = (state, features, id = "media_player.kitchen_homepod") => ({ entity_id: id, state, attributes: { supported_features: features } });
// The real HomePod: PAUSE|SEEK|VOLUME_SET|PREVIOUS|NEXT|TURN_ON|TURN_OFF|PLAY_MEDIA|VOLUME_STEP|STOP|PLAY|SHUFFLE|BROWSE_MEDIA|REPEAT_SET
const HOMEPOD = 1 | 2 | 4 | 16 | 32 | 128 | 256 | 512 | 1024 | 4096 | 16384 | 32768 | 131072 | 262144;

test("mediaControls offers what the player supports and nothing else", () => {
  const c = mediaControls(player("playing", HOMEPOD));
  assert.deepEqual([c.playPause, c.previous, c.next, c.volume, c.any], [true, true, true, true, true]);
  const none = mediaControls(player("playing", 128 | 256)); // only turn on/off
  assert.deepEqual([none.playPause, none.previous, none.next, none.volume, none.any], [false, false, false, false, false]);
  assert.equal(mediaControls(undefined).any, false);
  const onlyPlay = mediaControls(player("paused", 16384));
  assert.deepEqual([onlyPlay.playPause, onlyPlay.next], [true, false]);
});

test("play/pause is explicit: pause while playing, play otherwise", () => {
  assert.deepEqual(controlCall("playpause", player("playing", HOMEPOD)), ["media_player", "media_pause", { entity_id: "media_player.kitchen_homepod" }]);
  assert.equal(controlCall("playpause", player("paused", HOMEPOD))[1], "media_play");
  assert.equal(controlCall("playpause", player("idle", HOMEPOD))[1], "media_play");
});

test("controlCall maps buttons to services and refuses unsupported ones", () => {
  const hp = player("playing", HOMEPOD);
  assert.equal(controlCall("next", hp)[1], "media_next_track");
  assert.equal(controlCall("previous", hp)[1], "media_previous_track");
  assert.equal(controlCall("volume_up", hp)[1], "volume_up");
  assert.equal(controlCall("volume_down", hp)[1], "volume_down");
  const bare = player("playing", 16384);
  assert.equal(controlCall("next", bare), null);
  assert.equal(controlCall("volume_up", bare), null);
  assert.equal(controlCall("explode", hp), null);
  assert.equal(controlCall("next", { state: "playing", attributes: { supported_features: HOMEPOD } }), null); // no entity_id
});

import { jellyfinForTv, carouselItems, carouselPick } from "./panel-scene.js";

const sensorWith = (state, attrs) => ({ state, attributes: attrs });
const tvPaused = (title) => ({ state: "paused", attributes: { media_title: title } });
const mutiny = { title: "Mutiny", year: 2026, poster: "https://x/m.jpg", overview: "o" };
const farm = { title: "Clarkson's Farm", episode_title: "Reaping", poster: "https://x/f.jpg" };

test("jellyfinForTv prefers the item playing now when it matches", () => {
  const s = sensorWith("paused", { data: mutiny, last: farm });
  assert.equal(jellyfinForTv(s, tvPaused("Mutiny")).title, "Mutiny");
});

test("jellyfinForTv falls back to the remembered last item when Jellyfin dropped it", () => {
  // Moonfin left playback: the sensor is idle with no current data, but the Apple TV still says paused.
  const s = sensorWith("idle", { data: "{}", last: JSON.stringify(mutiny) });
  assert.equal(jellyfinForTv(s, tvPaused("Mutiny")).title, "Mutiny");
  assert.equal(jellyfinForTv(s, tvPaused("mutiny")).title, "Mutiny"); // case-insensitive
});

test("jellyfinForTv never shows a remembered item under a different title", () => {
  const s = sensorWith("idle", { data: {}, last: mutiny });
  assert.equal(jellyfinForTv(s, tvPaused("Something else")), null);
  assert.equal(jellyfinForTv(s, tvPaused("")), null);
});

test("jellyfinForTv is only for a paused TV and copes with junk", () => {
  const s = sensorWith("idle", { data: {}, last: mutiny });
  assert.equal(jellyfinForTv(s, { state: "idle", attributes: { media_title: "Mutiny" } }), null);
  assert.equal(jellyfinForTv(s, { state: "playing", attributes: { media_title: "Mutiny" } }), null);
  assert.equal(jellyfinForTv(sensorWith("idle", { last: "not json" }), tvPaused("Mutiny")), null);
  assert.equal(jellyfinForTv(sensorWith("idle", { last: {} }), tvPaused("Mutiny")), null);
  assert.equal(jellyfinForTv(undefined, tvPaused("Mutiny")), null);
});

const lib = (resume, recent) => ({ attributes: { resume, recent } });
const it = (title, extra = {}) => ({ title, poster: `https://x/${title}.jpg`, ...extra });

test("carouselItems puts continue-watching first and labels each item", () => {
  const items = carouselItems(lib([it("A", { type: "Episode" })], [it("B", { type: "Movie" }), it("C", { type: "Movie" })]));
  assert.deepEqual(items.map((i) => [i.title, i.label]), [["A", "Continue watching"], ["B", "Recently added"], ["C", "Recently added"]]);
});

test("carouselItems lists a title once, accepts JSON strings, drops items without a poster, and caps the list", () => {
  const items = carouselItems(lib(JSON.stringify([it("Show", { type: "Series" })]), [it("show", { type: "Series" }), { title: "No poster" }, it("Show", { type: "Movie" })]));
  assert.deepEqual(items.map((i) => i.title), ["Show", "Show"]); // same title, different type, is kept
  assert.equal(carouselItems(lib([], Array.from({ length: 30 }, (_, n) => it("T" + n)))).length, 14);
  assert.deepEqual(carouselItems(undefined), []);
  assert.deepEqual(carouselItems(lib("garbage", null)), []);
});

test("carouselPick steps through the list on a fixed clock", () => {
  const items = [it("A"), it("B"), it("C")];
  assert.equal(carouselPick(items, 0).title, "A");
  assert.equal(carouselPick(items, 14999).title, "A");
  assert.equal(carouselPick(items, 15000).title, "B");
  assert.equal(carouselPick(items, 45000).title, "A"); // wraps
  assert.equal(carouselPick([], 123), null);
});
