// Run with: npm test   (node's built-in runner, no dependencies)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeScene, inWindow, parseClock, mediaKind, stepScene, DEFAULT_HOLD_MS,
} from "./panel-scene.js";

const at = (hh, mm = 0) => new Date(2026, 10, 23, hh, mm);
const player = (state, attributes = {}) => ({ state, attributes });
const person = (state) => ({ state, attributes: {} });
const base = {
  sleep: { start: "22:30", end: "06:00" },
  morning: { start: "06:00", end: "10:00" },
  people: [person("home"), person("home")],
};

test("parseClock accepts HH:MM and rejects junk", () => {
  assert.equal(parseClock("06:30"), 390);
  assert.equal(parseClock("6:05"), 365);
  assert.equal(parseClock("24:00"), null);
  assert.equal(parseClock("noon"), null);
  assert.equal(parseClock(undefined), null);
});

test("inWindow handles windows that wrap midnight", () => {
  assert.equal(inWindow(at(23), "22:30", "06:00"), true);
  assert.equal(inWindow(at(2), "22:30", "06:00"), true);
  assert.equal(inWindow(at(6), "22:30", "06:00"), false); // end is exclusive
  assert.equal(inWindow(at(12), "22:30", "06:00"), false);
  assert.equal(inWindow(at(22, 29), "22:30", "06:00"), false);
  assert.equal(inWindow(at(22, 30), "22:30", "06:00"), true);
});

test("inWindow: equal or malformed bounds mean never", () => {
  assert.equal(inWindow(at(3), "03:00", "03:00"), false);
  assert.equal(inWindow(at(3), "bad", "06:00"), false);
});

test("mediaKind separates video from music", () => {
  assert.equal(mediaKind(player("playing", { media_content_type: "movie" })), "video");
  assert.equal(mediaKind(player("playing", { media_content_type: "music" })), "music");
  assert.equal(mediaKind(player("playing", { app_name: "Spotify" })), "music");
  assert.equal(mediaKind(player("playing", { app_name: "Infuse" })), "video");
  assert.equal(mediaKind(player("paused", { media_content_type: "movie" })), null);
  assert.equal(mediaKind(undefined), null);
});

test("a playing video is cinema, even in the sleep window", () => {
  const tv = player("playing", { media_content_type: "movie" });
  assert.equal(computeScene({ ...base, now: at(14), tv }).scene, "cinema");
  assert.equal(computeScene({ ...base, now: at(1), tv }).scene, "cinema");
});

test("music on the HomePod wins over an idle TV", () => {
  const r = computeScene({
    ...base, now: at(15), tv: player("idle"),
    music: [player("playing", { media_content_type: "music" })],
  });
  assert.equal(r.scene, "music");
});

test("music on the TV itself is music, not cinema", () => {
  const tv = player("playing", { media_content_type: "music" });
  assert.equal(computeScene({ ...base, now: at(15), tv }).scene, "music");
});

test("paused or idle TV is browsing", () => {
  assert.equal(computeScene({ ...base, now: at(15), tv: player("paused") }).scene, "browsing");
  assert.equal(computeScene({ ...base, now: at(15), tv: player("idle") }).scene, "browsing");
});

test("sleep window with the TV off sleeps; with the TV active it does not", () => {
  assert.equal(computeScene({ ...base, now: at(23), tv: player("standby") }).scene, "sleep");
  assert.equal(computeScene({ ...base, now: at(23), tv: player("off") }).scene, "sleep");
  assert.equal(computeScene({ ...base, now: at(23), tv: player("idle") }).scene, "browsing");
  assert.equal(computeScene({ ...base, now: at(23) }).scene, "sleep");
});

test("nobody home is away; sleep still takes priority at night", () => {
  const people = [person("not_home"), person("not_home")];
  assert.equal(computeScene({ ...base, now: at(14), people }).scene, "away");
  assert.equal(computeScene({ ...base, now: at(23), people }).scene, "sleep");
  assert.equal(computeScene({ ...base, now: at(14), people: [] }).scene, "day");
});

test("morning window then day", () => {
  assert.equal(computeScene({ ...base, now: at(7) }).scene, "morning");
  assert.equal(computeScene({ ...base, now: at(10) }).scene, "day");
  assert.equal(computeScene({ ...base, now: at(16) }).scene, "day");
});

test("stepScene adopts the first scene immediately", () => {
  const s = stepScene({ scene: null }, "day", 0);
  assert.equal(s.scene, "day");
});

test("stepScene holds a new scene until its hold time passes", () => {
  let s = { scene: "day", candidate: null, candidateSince: 0 };
  s = stepScene(s, "cinema", 1000);
  assert.equal(s.scene, "day");
  s = stepScene(s, "cinema", 1000 + DEFAULT_HOLD_MS.cinema - 1);
  assert.equal(s.scene, "day");
  s = stepScene(s, "cinema", 1000 + DEFAULT_HOLD_MS.cinema);
  assert.equal(s.scene, "cinema");
});

test("a flicker back to the current scene cancels the pending change", () => {
  let s = { scene: "day", candidate: null, candidateSince: 0 };
  s = stepScene(s, "cinema", 1000);
  s = stepScene(s, "day", 2000);
  assert.equal(s.candidate, null);
  s = stepScene(s, "cinema", 3000); // the hold clock restarts
  s = stepScene(s, "cinema", 3000 + DEFAULT_HOLD_MS.cinema - 1);
  assert.equal(s.scene, "day");
});

test("zero-hold scenes switch at once", () => {
  const s = stepScene({ scene: "day", candidate: null, candidateSince: 0 }, "sleep", 5000);
  assert.equal(s.scene, "sleep");
});

// ---- TV switched off (the Apple TV never reports it) ------------------------
const MIN = 60000;
const since = (min, now) => new Date(now.getTime() - min * MIN).toISOString();
const tvAt = (state, min, now, attributes = {}) => ({ state, attributes, last_changed: since(min, now) });

test("a paused TV shows browsing, then returns to the general screen once it has sat there too long", () => {
  const now = at(15);
  assert.equal(computeScene({ ...base, now, tv: tvAt("paused", 5, now) }).scene, "browsing");
  assert.equal(computeScene({ ...base, now, tv: tvAt("paused", 16, now) }).scene, "day");
  assert.equal(computeScene({ ...base, now, tv: tvAt("idle", 16, now) }).scene, "day");
});

test("a stale paused TV lets the panel sleep at night", () => {
  const now = at(23, 30);
  assert.equal(computeScene({ ...base, now, tv: tvAt("paused", 40, now) }).scene, "sleep");
  assert.equal(computeScene({ ...base, now, tv: tvAt("paused", 2, now) }).scene, "browsing");
});

test("the browsing timeout is configurable and 0 disables it", () => {
  const now = at(15);
  const tv = tvAt("paused", 30, now);
  assert.equal(computeScene({ ...base, now, tv, browsingTimeoutMs: 45 * MIN }).scene, "browsing");
  assert.equal(computeScene({ ...base, now, tv, browsingTimeoutMs: 10 * MIN }).scene, "day");
  assert.equal(computeScene({ ...base, now, tv, browsingTimeoutMs: 0 }).scene, "browsing");
});

test("a TV with no last_changed is never treated as stale", () => {
  const now = at(15);
  assert.equal(computeScene({ ...base, now, tv: { state: "paused", attributes: {} } }).scene, "browsing");
});

test("playing video is still cinema however long it has been playing", () => {
  const now = at(21);
  const tv = tvAt("playing", 120, now, { media_content_type: "movie" });
  assert.equal(computeScene({ ...base, now, tv }).scene, "cinema");
});

test("a real power entity switches the panel off the info screen at once", () => {
  const now = at(15);
  const tv = tvAt("paused", 1, now);
  assert.equal(computeScene({ ...base, now, tv, tvPower: { state: "on" } }).scene, "browsing");
  assert.equal(computeScene({ ...base, now, tv, tvPower: { state: "off" } }).scene, "day");
  assert.equal(computeScene({ ...base, now, tv, tvPower: { state: "standby" } }).scene, "day");
  const playing = tvAt("playing", 1, now, { media_content_type: "movie" });
  assert.equal(computeScene({ ...base, now, tv: playing, tvPower: { state: "off" } }).scene, "day");
});
