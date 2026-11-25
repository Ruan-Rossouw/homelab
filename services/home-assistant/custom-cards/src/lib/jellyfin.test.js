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
