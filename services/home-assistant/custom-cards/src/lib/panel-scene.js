// Pure scene logic for wall-panel-card — no DOM, no HA objects beyond plain
// state objects ({ state, attributes }), so it can be unit-tested with
// `node --test` (see panel-scene.test.js).
//
// A "scene" is what the wall panel should show right now, derived from what
// is happening in the house. Priority, highest first:
//
//   cinema   a video is playing on the TV            -> black, backlight min
//   music    a music player is playing                -> album art
//   browsing the TV is paused, or on and idle         -> artwork / poster
//   sleep    inside the sleep window, nothing playing -> black
//   away     nobody home                              -> dim clock
//   morning  inside the morning window                -> greeting + summary
//   day      anything else                            -> clock + summary
//
// Sleep is checked *after* media on purpose: starting a film at 01:00 must
// still go to Cinema, not stay asleep.

export const SCENES = ["cinema", "music", "browsing", "sleep", "away", "morning", "day"];

const VIDEO_TYPES = new Set(["video", "movie", "tvshow", "episode", "tv_show"]);
const MUSIC_TYPES = new Set(["music", "track", "album", "playlist", "podcast"]);

// "HH:MM" -> minutes since midnight, or null when malformed.
export function parseClock(text) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(text ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

// True when `now` falls in [start, end), handling windows that wrap past
// midnight (22:30 -> 06:00). start === end means "never".
export function inWindow(now, start, end) {
  const s = parseClock(start);
  const e = parseClock(end);
  if (s === null || e === null || s === e) return false;
  const t = now.getHours() * 60 + now.getMinutes();
  return s < e ? t >= s && t < e : t >= s || t < e;
}

export function mediaKind(entity) {
  if (!entity || entity.state !== "playing") return null;
  const type = String(entity.attributes?.media_content_type ?? "").toLowerCase();
  if (MUSIC_TYPES.has(type)) return "music";
  if (VIDEO_TYPES.has(type)) return "video";
  // Unknown type: treat as video only when it clearly isn't a music app.
  const app = String(entity.attributes?.app_name ?? "").toLowerCase();
  if (/music|spotify|podcast|tidal|deezer/.test(app)) return "music";
  return "video";
}

const ACTIVE_TV_STATES = new Set(["playing", "paused", "idle", "buffering"]);

// `input`:
//   now          Date
//   tv           media_player state object (or undefined)
//   music        array of media_player state objects
//   people       array of person state objects
//   sleep        { start, end }   e.g. { start: "22:30", end: "06:00" }
//   morning      { start, end }   e.g. { start: "06:00", end: "10:00" }
export function computeScene(input) {
  const { now, tv, music = [], people = [], sleep, morning } = input;

  const tvKind = mediaKind(tv);
  if (tvKind === "video") return { scene: "cinema", source: tv };

  const musicSource = [tv, ...music].find((e) => mediaKind(e) === "music");
  if (musicSource) return { scene: "music", source: musicSource };

  if (tv && (tv.state === "paused" || tv.state === "idle")) {
    return { scene: "browsing", source: tv };
  }

  const tvActive = !!tv && ACTIVE_TV_STATES.has(tv.state);
  if (!tvActive && sleep && inWindow(now, sleep.start, sleep.end)) {
    return { scene: "sleep", source: null };
  }

  if (people.length > 0 && people.every((p) => p.state !== "home")) {
    return { scene: "away", source: null };
  }

  if (morning && inWindow(now, morning.start, morning.end)) {
    return { scene: "morning", source: null };
  }

  return { scene: "day", source: null };
}

// Per-scene hold times (ms): a *candidate* scene must stay the candidate for
// this long before it is adopted. Stops a one-second pause or an app
// switching from flashing the panel. Leaving a scene is governed by the
// scene being entered, so "cinema" ends only after `browsing`'s hold.
export const DEFAULT_HOLD_MS = {
  cinema: 5000,
  music: 3000,
  browsing: 8000,
  sleep: 0,
  away: 30000,
  morning: 0,
  day: 3000,
};

// Immutable stepper. `state` starts as { scene: null }. `candidateSince` is
// when the current candidate first appeared, not when the scene began.
export function stepScene(state, candidate, nowMs, hold = DEFAULT_HOLD_MS) {
  if (state.scene === null) {
    return { scene: candidate, candidate: null, candidateSince: 0 };
  }
  if (candidate === state.scene) {
    return { scene: state.scene, candidate: null, candidateSince: 0 };
  }
  const candidateSince = state.candidate === candidate ? state.candidateSince : nowMs;
  if (nowMs - candidateSince >= (hold[candidate] ?? 0)) {
    return { scene: candidate, candidate: null, candidateSince: 0 };
  }
  return { scene: state.scene, candidate, candidateSince };
}

// ---- Jellyfin now-playing (sensor.jellyfin_now_playing, see
// ../../packages/jellyfin_now_playing.yaml) ---------------------------------

// The sensor's `data` attribute is a JSON string or, after HA's native
// rendering, already an object. Returns null unless something is playing.
export function parseJellyfin(entity) {
  if (!entity || (entity.state !== "playing" && entity.state !== "paused")) return null;
  let d = entity.attributes?.data;
  if (typeof d === "string") {
    try { d = JSON.parse(d); } catch (e) { return null; }
  }
  if (!d || typeof d !== "object" || !d.title) return null;
  return d;
}

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Only borrow Jellyfin's description when it is clearly the same thing the TV
// is showing: the Apple TV's title must equal Jellyfin's series or episode
// title (punctuation and case ignored), so a stale or different session can
// never put the wrong film's description under the right poster.
export function matchesJellyfin(tv, jf) {
  if (!tv || !jf) return false;
  if (tv.state !== "playing" && tv.state !== "paused") return false;
  const t = norm(tv.attributes?.media_title);
  if (!t) return false;
  return t === norm(jf.title) || t === norm(jf.episode_title);
}

// The episode line and the info chips under the title.
export function jellyfinFacts(jf) {
  const parts = [];
  if (jf.season != null) parts.push(`S${jf.season}`);
  if (jf.episode != null) parts.push(`E${jf.episode}`);
  if (jf.episode_title) parts.push(jf.episode_title);
  const chips = [];
  if (jf.year) chips.push(String(jf.year));
  if (jf.rating != null) chips.push(`★ ${jf.rating}`);
  if (jf.runtime_min) chips.push(`${jf.runtime_min} min`);
  if (jf.official_rating) chips.push(jf.official_rating);
  if (Array.isArray(jf.genres) && jf.genres.length) chips.push(jf.genres.slice(0, 2).join(" · "));
  return { line: parts.join(" · "), chips };
}
