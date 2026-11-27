(() => {
  // src/lib/fluid-palette.js
  var DEFAULT_PALETTE = [
    [92, 52, 140],
    [168, 62, 116],
    [48, 86, 150],
    [196, 110, 70]
  ];
  function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
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
    if (s === 0) {
      const v = Math.round(l * 255);
      return [v, v, v];
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const f = (t) => {
      t = (t % 1 + 1) % 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => Math.round(v * 255));
  }
  function tuneColor([r, g, b]) {
    const [h, s, l] = rgbToHsl(r, g, b);
    return hslToRgb(h, s < 0.08 ? s : Math.max(s, 0.55), Math.min(0.52, Math.max(0.26, l)));
  }
  function dist(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }
  function lumaSpread(data) {
    let sum = 0, sumSq = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      sum += y;
      sumSq += y * y;
      n++;
    }
    if (!n) return 0;
    const mean = sum / n;
    return Math.sqrt(Math.max(0, sumSq / n - mean * mean));
  }
  function extractPalette(data, count = 4) {
    if (lumaSpread(data) < 6) return null;
    const buckets = /* @__PURE__ */ new Map();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      const key = data[i] >> 5 << 6 | data[i + 1] >> 5 << 3 | data[i + 2] >> 5;
      const e = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      e.n++;
      e.r += data[i];
      e.g += data[i + 1];
      e.b += data[i + 2];
      buckets.set(key, e);
    }
    const ranked = [...buckets.values()].map((e) => {
      const rgb = [e.r / e.n, e.g / e.n, e.b / e.n];
      const [, s2, l2] = rgbToHsl(...rgb);
      const extreme = l2 < 0.1 || l2 > 0.92 ? 0.15 : 1;
      return { rgb, score: e.n * (0.25 + s2) * extreme };
    }).sort((a, b) => b.score - a.score);
    const picked = [];
    for (const { rgb } of ranked) {
      if (picked.every((p) => dist(p, rgb) > 70)) picked.push(rgb);
      if (picked.length === count) break;
    }
    const [h, s, l] = rgbToHsl(...picked[0] || DEFAULT_PALETTE[0]);
    for (let k = 1; picked.length < count; k++) {
      picked.push(hslToRgb(h + 0.08 * k * (k % 2 ? 1 : -1), Math.max(s, 0.4), l));
    }
    return picked.map(tuneColor);
  }
  var BLOBS = [
    { x: 0.22, y: 0.28, ax: 0.2, ay: 0.16, fx: 0.21, fy: 0.17, px: 0, py: 1.3, r: 0.6 },
    { x: 0.8, y: 0.22, ax: 0.18, ay: 0.2, fx: 0.16, fy: 0.23, px: 2.1, py: 0.4, r: 0.55 },
    { x: 0.3, y: 0.82, ax: 0.2, ay: 0.14, fx: 0.19, fy: 0.15, px: 4, py: 2.6, r: 0.58 },
    { x: 0.82, y: 0.78, ax: 0.16, ay: 0.18, fx: 0.14, fy: 0.2, px: 1.1, py: 3.7, r: 0.52 }
  ];
  function blobs(t) {
    return BLOBS.map((b) => ({
      x: b.x + b.ax * Math.sin(t * b.fx + b.px),
      y: b.y + b.ay * Math.cos(t * b.fy + b.py),
      r: b.r
    }));
  }
  function paletteFromText(text) {
    const t = String(text ?? "").trim().toLowerCase();
    if (!t) return DEFAULT_PALETTE;
    let h = 2166136261;
    for (let i = 0; i < t.length; i++) {
      h ^= t.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    const hue = h % 360 / 360;
    return [0, 0.11, -0.09, 0.22].map((o, i) => tuneColor(hslToRgb(hue + o, 0.55 + 0.08 * (i % 2), 0.34 - 0.03 * i)));
  }

  // src/lib/self-update.js
  var MIN_GAP_MS = 10 * 60 * 1e3;
  var RELOAD_SCENES = /* @__PURE__ */ new Set(["day", "morning", "away"]);
  function signature(text) {
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = (h << 5) + h + text.charCodeAt(i) | 0;
    return `${text.length}:${(h >>> 0).toString(16)}`;
  }
  function shouldReload({ scene, loadedSig, serverSig, now, record }) {
    if (!serverSig || !loadedSig || serverSig === loadedSig) return false;
    if (!RELOAD_SCENES.has(scene)) return false;
    if (record?.failedSig === serverSig) return false;
    if (record?.t && now - record.t < MIN_GAP_MS) return false;
    return true;
  }
  function afterLoad(record, loadedSig) {
    if (record?.sig && record.sig !== loadedSig) return { ...record, failedSig: record.sig };
    return record || null;
  }

  // src/lib/sky.js
  var KEYS = [
    { e: -14, rise: ["#050b1a", "#0a1830", "#112747"], set: ["#050b1a", "#0a1830", "#112747"] },
    { e: -6, rise: ["#121f4a", "#363a6e", "#8a5878"], set: ["#101b44", "#32336a", "#7d4c6c"] },
    { e: 0, rise: ["#27386f", "#8b587c", "#d98a5c"], set: ["#23326a", "#7e4a78", "#d3703f"] },
    { e: 8, rise: ["#285894", "#5f80a8", "#c58862"], set: ["#254f89", "#6d729c", "#c78a58"] },
    { e: 25, rise: ["#184a88", "#276ba1", "#3f86ad"], set: ["#184a88", "#276ba1", "#3f86ad"] },
    { e: 55, rise: ["#123a76", "#1f609a", "#3679a6"], set: ["#123a76", "#1f609a", "#3679a6"] }
  ];
  var WEATHER = {
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
    exceptional: { c: "#3b4a5c", a: 0.4 }
  };
  var hexToRgb = (h) => {
    const n = parseInt(h.slice(1), 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  };
  var toHex = (rgb) => `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
  var mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  function skyStops(elevation, rising) {
    const e = Math.max(KEYS[0].e, Math.min(KEYS[KEYS.length - 1].e, elevation));
    let i = 0;
    while (i < KEYS.length - 2 && e > KEYS[i + 1].e) i++;
    const lo = KEYS[i], hi = KEYS[i + 1];
    const t = (e - lo.e) / (hi.e - lo.e);
    const side = rising ? "rise" : "set";
    return lo[side].map((c, k) => mix(hexToRgb(c), hexToRgb(hi[side][k]), t));
  }
  function skyPalette({ elevation, rising, weather }) {
    const el = Number(elevation);
    if (!Number.isFinite(el)) return null;
    const w = WEATHER[weather] || null;
    const stops = skyStops(el, rising !== false).map((rgb) => w ? mix(rgb, hexToRgb(w.c), w.a) : rgb);
    const glowA = Math.max(0, 0.42 - Math.abs(el - 2) * 0.016) * (w ? 1 - w.a * 1.3 : 1);
    const glow = glowA > 0.02 ? {
      x: rising !== false ? 24 : 76,
      y: Math.max(52, 104 - Math.max(0, el) * 1.3),
      rgb: el < 12 ? [255, 168, 104] : [255, 226, 170],
      alpha: Math.min(0.45, glowA)
    } : null;
    const stars = el < -9 && (!w || w.a < 0.2);
    return { stops: stops.map(toHex), rgb: stops, glow, stars };
  }
  var STAR_SPOTS = [[12, 16, 1], [24, 38, 0.7], [37, 11, 0.9], [51, 27, 0.7], [63, 8, 1], [74, 33, 0.8], [86, 18, 0.9], [92, 44, 0.6], [6, 52, 0.6], [45, 47, 0.5]];
  function skyCss(p) {
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
  function skyKey({ elevation, rising, weather }) {
    const el = Number(elevation);
    return Number.isFinite(el) ? `${Math.round(el * 2) / 2}${rising === false ? "s" : "r"}${weather || ""}` : "";
  }

  // src/lib/todo.js
  function parseDue(due) {
    if (!due) return null;
    const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(due);
    const date = day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : new Date(due);
    return Number.isNaN(date.getTime()) ? null : { date, allDay: !!day };
  }
  var startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  var pad = (n) => String(n).padStart(2, "0");
  function dueInfo(due, now) {
    const p = parseDue(due);
    if (!p) return { when: "none", label: "", at: Infinity };
    const days = Math.round((startOfDay(p.date) - startOfDay(now)) / 864e5);
    const time = p.allDay ? "" : `${pad(p.date.getHours())}:${pad(p.date.getMinutes())}`;
    const overdue = p.allDay ? days < 0 : p.date.getTime() < now.getTime();
    let day;
    if (days === 0) day = "Today";
    else if (days === 1) day = "Tomorrow";
    else if (days === -1) day = "Yesterday";
    else if (days > 1 && days < 7) day = p.date.toLocaleDateString("en-GB", { weekday: "long" });
    else day = p.date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    const when = overdue ? "overdue" : days === 0 ? "today" : "later";
    return { when, label: time ? `${day} ${time}` : day, at: p.date.getTime() };
  }
  var RANK = { overdue: 0, today: 1, later: 2, none: 3 };
  function openTodos(items, now) {
    return (items || []).filter((i) => i && i.status === "needs_action" && (i.summary || "").trim()).map((i, order) => ({ uid: i.uid, summary: i.summary.trim(), order, ...dueInfo(i.due, now) })).sort((a, b) => RANK[a.when] - RANK[b.when] || (a.at === b.at ? a.order - b.order : a.at - b.at));
  }
  function shareRows(counts, total) {
    const rows = counts.map(() => 0);
    let left = total;
    let dealt = true;
    while (left > 0 && dealt) {
      dealt = false;
      counts.forEach((n, i) => {
        if (left > 0 && rows[i] < n) {
          rows[i] += 1;
          left -= 1;
          dealt = true;
        }
      });
    }
    return rows;
  }

  // src/lib/panel-scene.js
  var VIDEO_TYPES = /* @__PURE__ */ new Set(["video", "movie", "tvshow", "episode", "tv_show"]);
  var MUSIC_TYPES = /* @__PURE__ */ new Set(["music", "track", "album", "playlist", "podcast"]);
  function parseClock(text) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(text ?? "").trim());
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }
  function inWindow(now, start, end) {
    const s = parseClock(start);
    const e = parseClock(end);
    if (s === null || e === null || s === e) return false;
    const t = now.getHours() * 60 + now.getMinutes();
    return s < e ? t >= s && t < e : t >= s || t < e;
  }
  function mediaKind(entity) {
    if (!entity || entity.state !== "playing") return null;
    const type = String(entity.attributes?.media_content_type ?? "").toLowerCase();
    if (MUSIC_TYPES.has(type)) return "music";
    if (VIDEO_TYPES.has(type)) return "video";
    const app = String(entity.attributes?.app_name ?? "").toLowerCase();
    if (/music|spotify|podcast|tidal|deezer/.test(app)) return "music";
    return "video";
  }
  var ACTIVE_TV_STATES = /* @__PURE__ */ new Set(["playing", "paused", "idle", "buffering"]);
  var POWER_OFF_STATES = /* @__PURE__ */ new Set(["off", "standby", "unavailable", "unknown"]);
  function tvIsOff(tv, tvPower, now, timeoutMs) {
    if (tvPower && POWER_OFF_STATES.has(tvPower.state)) return true;
    if (!tv || !(timeoutMs > 0)) return false;
    if (tv.state !== "paused" && tv.state !== "idle") return false;
    const since = Date.parse(tv.last_changed);
    return Number.isFinite(since) && now.getTime() - since > timeoutMs;
  }
  var DEFAULT_BROWSING_TIMEOUT_MS = 15 * 60 * 1e3;
  var DEFAULT_MUSIC_LINGER_MS = 30 * 1e3;
  function recentlyPausedMusic(players, now, lingerMs) {
    if (!(lingerMs > 0)) return null;
    return players.find((e) => {
      if (!e || e.state !== "paused") return false;
      const type = String(e.attributes?.media_content_type ?? "").toLowerCase();
      const app = String(e.attributes?.app_name ?? "").toLowerCase();
      if (!(MUSIC_TYPES.has(type) || /music|spotify|podcast|tidal|deezer/.test(app))) return false;
      const since = Date.parse(e.last_changed);
      return Number.isFinite(since) && now.getTime() - since < lingerMs;
    }) || null;
  }
  function computeScene(input) {
    const {
      now,
      tv,
      music = [],
      people = [],
      sleep,
      morning,
      tvPower,
      browsingTimeoutMs = DEFAULT_BROWSING_TIMEOUT_MS,
      musicLingerMs = DEFAULT_MUSIC_LINGER_MS,
      grid
    } = input;
    const off = tvIsOff(tv, tvPower, now, browsingTimeoutMs);
    const tvKind = mediaKind(tv);
    if (tvKind === "video" && !(tvPower && POWER_OFF_STATES.has(tvPower.state))) {
      return { scene: "cinema", source: tv };
    }
    const musicSource = [tv, ...music].find((e) => mediaKind(e) === "music");
    if (musicSource) return { scene: "music", source: musicSource };
    const lingering = recentlyPausedMusic([tv, ...music], now, musicLingerMs);
    if (lingering) return { scene: "music", source: lingering };
    if (tv && (tv.state === "paused" || tv.state === "idle") && !off) {
      return { scene: "browsing", source: tv };
    }
    const tvActive = !!tv && ACTIVE_TV_STATES.has(tv.state) && !off;
    if (!tvActive && sleep && inWindow(now, sleep.start, sleep.end)) {
      return { scene: "sleep", source: null };
    }
    if (people.length > 0 && people.every((p) => p.state !== "home")) {
      return { scene: "away", source: null };
    }
    if (grid && grid.state === "off") {
      return { scene: "outage", source: null };
    }
    if (morning && inWindow(now, morning.start, morning.end)) {
      return { scene: "morning", source: null };
    }
    return { scene: "day", source: null };
  }
  var DEFAULT_HOLD_MS = {
    cinema: 5e3,
    music: 3e3,
    browsing: 8e3,
    sleep: 0,
    away: 3e4,
    outage: 5e3,
    morning: 0,
    day: 3e3
  };
  function stepScene(state, candidate, nowMs, hold = DEFAULT_HOLD_MS) {
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
  function parseJellyfin(entity) {
    if (!entity || entity.state !== "playing" && entity.state !== "paused") return null;
    let d = entity.attributes?.data;
    if (typeof d === "string") {
      try {
        d = JSON.parse(d);
      } catch (e) {
        return null;
      }
    }
    if (!d || typeof d !== "object" || !d.title) return null;
    return d;
  }
  var norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  function matchesJellyfin(tv, jf) {
    if (!tv || !jf) return false;
    if (tv.state !== "playing" && tv.state !== "paused") return false;
    const t = norm(tv.attributes?.media_title);
    if (!t) return false;
    return t === norm(jf.title) || t === norm(jf.episode_title);
  }
  function sameText(a, b) {
    const x = norm(a);
    return x !== "" && x === norm(b);
  }
  function jellyfinFacts(jf) {
    const parts = [];
    if (jf.season != null) parts.push(`S${jf.season}`);
    if (jf.episode != null) parts.push(`E${jf.episode}`);
    if (jf.episode_title) parts.push(jf.episode_title);
    const chips = [];
    if (jf.year) chips.push(String(jf.year));
    if (jf.rating != null) chips.push(`\u2605 ${jf.rating}`);
    if (jf.runtime_min) chips.push(`${jf.runtime_min} min`);
    if (jf.official_rating) chips.push(jf.official_rating);
    if (Array.isArray(jf.genres) && jf.genres.length) chips.push(jf.genres.slice(0, 2).join(" \xB7 "));
    return { line: parts.join(" \xB7 "), chips };
  }
  var FEATURE = { PAUSE: 1, VOLUME_SET: 4, PREVIOUS: 16, NEXT: 32, VOLUME_STEP: 1024, PLAY: 16384 };
  function mediaControls(entity) {
    const f = Number(entity?.attributes?.supported_features) || 0;
    const has = (bit) => (f & bit) !== 0;
    const playPause = has(FEATURE.PAUSE) || has(FEATURE.PLAY);
    return {
      playPause,
      previous: has(FEATURE.PREVIOUS),
      next: has(FEATURE.NEXT),
      volume: has(FEATURE.VOLUME_STEP) || has(FEATURE.VOLUME_SET),
      any: playPause || has(FEATURE.PREVIOUS) || has(FEATURE.NEXT) || has(FEATURE.VOLUME_STEP) || has(FEATURE.VOLUME_SET)
    };
  }
  function controlCall(action, entity) {
    const id = entity?.entity_id;
    if (!id) return null;
    const c = mediaControls(entity);
    switch (action) {
      case "playpause":
        if (!c.playPause) return null;
        return ["media_player", entity.state === "playing" ? "media_pause" : "media_play", { entity_id: id }];
      case "previous":
        return c.previous ? ["media_player", "media_previous_track", { entity_id: id }] : null;
      case "next":
        return c.next ? ["media_player", "media_next_track", { entity_id: id }] : null;
      case "volume_up":
        return c.volume ? ["media_player", "volume_up", { entity_id: id }] : null;
      case "volume_down":
        return c.volume ? ["media_player", "volume_down", { entity_id: id }] : null;
      default:
        return null;
    }
  }
  function asObject(v) {
    if (typeof v === "string") {
      try {
        v = JSON.parse(v);
      } catch (e) {
        return null;
      }
    }
    return v && typeof v === "object" ? v : null;
  }
  function jellyfinSource(sensor, tv) {
    if (!sensor || !tv || tv.state !== "paused") return null;
    const now = parseJellyfin(sensor);
    if (now && matchesJellyfin(tv, now)) return { data: now, from: "now" };
    const last = asObject(sensor.attributes?.last);
    if (last && last.title && matchesJellyfin(tv, last)) return { data: last, from: "last" };
    return null;
  }
  function jellyfinForTv(sensor, tv) {
    const hit = jellyfinSource(sensor, tv);
    return hit ? hit.data : null;
  }
  var DEFAULT_LAST_FILM_MS = 2 * 60 * 1e3;
  function carouselWanted(sensor, tv, nowMs, lastFilmMs = DEFAULT_LAST_FILM_MS) {
    if (!tv) return false;
    if (tv.state === "idle") return true;
    if (tv.state !== "paused") return false;
    const hit = jellyfinSource(sensor, tv);
    if (!hit || hit.from !== "last") return false;
    const since = Date.parse(sensor.last_changed);
    return Number.isFinite(since) && nowMs - since >= lastFilmMs;
  }
  function asList(v) {
    if (typeof v === "string") {
      try {
        v = JSON.parse(v);
      } catch (e) {
        return [];
      }
    }
    return Array.isArray(v) ? v.filter((i) => i && i.title && i.poster) : [];
  }
  function carouselItems(library, max = 14) {
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    const add = (items, label) => {
      for (const it of items) {
        const key = `${String(it.title).toLowerCase()}|${it.type || ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ ...it, label });
      }
    };
    add(asList(library?.attributes?.resume), "Continue watching");
    add(asList(library?.attributes?.recent), "Recently added");
    return out.slice(0, max);
  }
  function carouselPick(items, nowMs, stepMs = 15e3) {
    if (!items.length) return null;
    return items[Math.floor(nowMs / stepMs) % items.length];
  }
  function outageRuntimeMin({ soc, ah, volts, loadW, reservePct = 10, capacityWh }) {
    const cap = Number.isFinite(Number(capacityWh)) && Number(capacityWh) > 0 ? Number(capacityWh) : Number(ah) * Number(volts);
    const n = [soc, cap, loadW].map(Number);
    if (n.some((v) => !Number.isFinite(v)) || n[2] < 20) return null;
    const usableWh = n[1] * Math.max(0, n[0] - reservePct) / 100;
    return Math.round(usableWh / n[2] * 60);
  }
  function fmtMinutes(min) {
    if (!Number.isFinite(min) || min < 0) return "";
    const h = Math.floor(min / 60), m = min % 60;
    return h > 0 ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
  }

  // src/wall-panel-card.js
  var DEFAULT_BRIGHTNESS = {
    cinema: 0,
    sleep: 0,
    away: 0.12,
    outage: 0.3,
    music: 0.3,
    browsing: 0.2,
    morning: 0.5,
    day: 0.4
  };
  var STYLES = `
  :host { display: block; }
  .stage {
    position: fixed; inset: 0; z-index: 2147483000;
    overflow: hidden; color: #f4f6fa; touch-action: none;
    font-family: Roboto, "Noto Sans", sans-serif;
    background: #000;
  }
  .layer { position: absolute; inset: 0; }
  .bg-day { background: linear-gradient(160deg, #0b1f3a 0%, #123a5e 55%, #1b5a73 100%); }
  .bg-morning { background: linear-gradient(160deg, #3a1d3f 0%, #8a3e55 50%, #e0955a 100%); }
  .bg-away { background: #05070b; }
  .bg-outage { background: linear-gradient(160deg, #1a1208 0%, #2b1d0c 60%, #3a2610 100%); }
  .outage { display: flex; flex-direction: column; height: 100%; }
  .outage .oh { display: flex; justify-content: space-between; align-items: baseline; }
  .outage .otitle { font-size: 40px; font-weight: 300; color: #ffc857; letter-spacing: 1px; }
  .outage .osince { font-size: 28px; opacity: 0.7; }
  .outage .obig { display: flex; align-items: baseline; gap: 28px; margin-top: 30px; }
  .outage .opct { font-size: 190px; font-weight: 200; line-height: 1; font-variant-numeric: tabular-nums; }
  .outage .opct small { font-size: 60px; opacity: 0.7; margin-left: 6px; }
  .outage .orun { font-size: 44px; font-weight: 300; }
  .outage .orun span { display: block; font-size: 24px; opacity: 0.6; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 4px; }
  .outage .bar { height: 14px; margin-top: 24px; }
  .outage .row { margin-right: 230px; }
  .bg-art { background: #080a10; }
  .bg-art canvas { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0.85; }
  .bg-art .veil { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.38); }
  .bg-art canvas.fluid { opacity: 1; }
  .bg-art .veil.light { background: rgba(0, 0, 0, 0.14); }
  .bg-art .veil.dim { background: rgba(0, 0, 0, 0.26); }
  .content { position: absolute; inset: 0; padding: 56px 72px; display: flex; flex-direction: column; }

  .clock { font-weight: 200; letter-spacing: -2px; line-height: 1; font-variant-numeric: tabular-nums; }
  .clock.hero { font-size: 250px; margin-top: 20px; }
  .clock.small { font-size: 72px; letter-spacing: 0; opacity: 0.85; }
  .date { font-size: 34px; font-weight: 300; opacity: 0.8; margin-top: 8px; letter-spacing: 1px; }
  .greeting { font-size: 40px; font-weight: 300; opacity: 0.9; margin-bottom: 4px; }

  .row { display: flex; gap: 24px; margin-top: auto; }
  .tile {
    flex: 1; background: rgba(255, 255, 255, 0.09); border-radius: 28px;
    padding: 26px 30px; min-width: 0;
  }
  .tile .label { font-size: 22px; opacity: 0.65; text-transform: uppercase; letter-spacing: 2px; }
  .tile .value { font-size: 58px; font-weight: 300; margin-top: 6px; white-space: nowrap; }
  .tile .value small { font-size: 26px; opacity: 0.7; margin-left: 6px; font-weight: 300; }
  .tile .sub { font-size: 24px; opacity: 0.7; margin-top: 4px; }
  .bar { height: 10px; border-radius: 5px; background: rgba(255, 255, 255, 0.15); margin-top: 14px; overflow: hidden; }
  .bar > i { display: block; height: 100%; border-radius: 5px; background: var(--accent, #7fd6c2); }
  .dot { display: inline-block; width: 14px; height: 14px; border-radius: 50%; margin-right: 10px; background: #5fdc8c; vertical-align: middle; }
  .dot.warn { background: #ff9f43; box-shadow: 0 0 12px #ff9f43; }
  .dot.off { background: #666; }
  .top { display: flex; justify-content: space-between; align-items: flex-start; }
  .wx { text-align: right; }
  .wx .temp { font-size: 96px; font-weight: 200; line-height: 1; }
  .wx .cond { font-size: 30px; opacity: 0.8; margin-top: 6px; }

  .media { display: flex; align-items: center; gap: 72px; height: 100%; }
  .art { flex: none; border-radius: 26px; background-size: cover; background-position: center;
         box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55); background-color: rgba(255,255,255,0.08); }
  .media.square .art { width: 420px; height: 420px; }
  .media.poster .art { width: 400px; height: 600px; }
  .media.wide .art { width: 560px; height: 315px; }
  .media.wide .title { font-size: 56px; }
  .media.none .art { display: none; }
  .media.none .title { font-size: 76px; }
  .media.none .meta { max-width: 980px; }
  .meta { min-width: 0; flex: 1; }
  .kicker { font-size: 24px; letter-spacing: 3px; text-transform: uppercase; opacity: 0.65; }
  .title { font-size: 66px; font-weight: 300; line-height: 1.08; margin-top: 12px;
           display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .artist { font-size: 38px; opacity: 0.85; margin-top: 14px; font-weight: 300; }
  .album { font-size: 28px; opacity: 0.6; margin-top: 8px; }
  .progress { margin-top: 36px; }
  .progress .bar { height: 8px; }
  .progress .times { display: flex; justify-content: space-between; font-size: 22px; opacity: 0.6; margin-top: 10px; }
  .media.desc .title { font-size: 60px; -webkit-line-clamp: 2; }
  .media.desc .progress { margin-top: 26px; }
  .chips { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 22px; }
  .chip { padding: 6px 16px; border-radius: 18px; background: rgba(255, 255, 255, 0.12); font-size: 22px; letter-spacing: 0.5px; }
  .overview { font-size: 26px; line-height: 1.35; opacity: 0.8; margin-top: 22px;
              display: -webkit-box; -webkit-line-clamp: 6; -webkit-box-orient: vertical; overflow: hidden; }
  .content.fade { animation: wpfade 0.9s ease; }
  @keyframes wpfade { from { opacity: 0; } to { opacity: 1; } }
  .controls { display: flex; align-items: center; gap: 20px; margin-top: 28px; }
  .ctl { width: 76px; height: 76px; border-radius: 50%; border: 0; padding: 0; color: #fff;
         background: rgba(255, 255, 255, 0.14); display: flex; align-items: center; justify-content: center;
         touch-action: manipulation; cursor: pointer; -webkit-tap-highlight-color: transparent; }
  .ctl svg { width: 34px; height: 34px; fill: currentColor; }
  .ctl.big { width: 96px; height: 96px; background: rgba(255, 255, 255, 0.26); }
  .ctl.big svg { width: 44px; height: 44px; }
  .ctl.small { width: 62px; height: 62px; }
  .ctl.small svg { width: 26px; height: 26px; }
  .ctl.wide { width: auto; border-radius: 48px; padding: 0 34px 0 26px; gap: 14px; font: 500 28px Roboto, "Noto Sans", sans-serif; }
  .ctl.pressed { transform: scale(0.92); background: rgba(255, 255, 255, 0.4); }
  .vol { display: flex; align-items: center; gap: 12px; margin-left: 22px; padding-left: 28px;
         border-left: 2px solid rgba(255, 255, 255, 0.16); font-size: 26px; opacity: 0.95; }
  .vol span { min-width: 64px; text-align: center; font-variant-numeric: tabular-nums; }
  .badge { display: inline-block; margin-top: 26px; padding: 8px 20px; border-radius: 22px;
           background: rgba(255,255,255,0.14); font-size: 24px; letter-spacing: 1px; }
  .corner { position: absolute; right: 72px; bottom: 44px; }
  .content, .dots, .homebtn, .sheet-bg .sheet { transform: translate(var(--sx, 0px), var(--sy, 0px)); transition: transform 4s ease-in-out; }
  .content.enter { animation: wpenter 0.9s cubic-bezier(.2,.7,.2,1); }
  @keyframes wpenter { from { opacity: 0; transform: scale(1.04); } to { opacity: 1; transform: none; } }
  .row .tile.power { flex: 1.3; }
  .row .tile.tap { cursor: pointer; -webkit-tap-highlight-color: transparent; }
  .pwr-line { display: flex; align-items: baseline; gap: 18px; }
  .pwr-state { font-size: 24px; opacity: 0.8; }
  .pwr-meta { display: flex; justify-content: space-between; font-size: 22px; opacity: 0.7; margin-top: 10px; }
  .mini { flex: 1.5; display: flex; align-items: center; gap: 22px; padding: 18px 22px; cursor: pointer; }
  .mini .mart { flex: none; width: 112px; height: 112px; border-radius: 18px; background-size: cover; background-position: center;
                background-color: rgba(255,255,255,0.1); box-shadow: 0 8px 24px rgba(0,0,0,0.4); }
  .mini .mtxt { min-width: 0; flex: 1; }
  .mini .mtitle { font-size: 30px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mini .mart-sub { font-size: 22px; opacity: 0.7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
  .mini .mbtns { display: flex; gap: 12px; margin-top: 12px; }
  .mini .ctl { width: 58px; height: 58px; }
  .mini .ctl svg { width: 26px; height: 26px; }
  .mini.idle { opacity: 0.7; }
  .minibar { display: flex; align-items: center; gap: 22px; margin-top: 22px; padding: 12px 26px 12px 14px; border-radius: 44px;
             background: rgba(255,255,255,0.09); cursor: pointer; }
  .minibar .mart { width: 72px; height: 72px; border-radius: 50%; background-size: cover; background-position: center; background-color: rgba(255,255,255,0.1); flex: none; }
  .minibar .mtxt { flex: 1; min-width: 0; font-size: 28px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .minibar .mtxt span { opacity: 0.65; margin-left: 14px; font-size: 24px; }
  .minibar .ctl { width: 60px; height: 60px; }
  .minibar .ctl svg { width: 26px; height: 26px; }
  .minibar.idle { opacity: 0.65; }
  .orb { position: absolute; right: 72px; bottom: 210px; width: 132px; height: 132px; cursor: pointer; }
  .orb .mart { position: absolute; inset: 10px; border-radius: 50%; background-size: cover; background-position: center;
               background-color: rgba(255,255,255,0.12); box-shadow: 0 10px 30px rgba(0,0,0,0.45); }
  .orb svg.ring { position: absolute; inset: 0; width: 132px; height: 132px; transform: rotate(-90deg); }
  .orb.idle { opacity: 0.6; }
  .dots { position: absolute; left: 0; right: 0; bottom: 14px; display: flex; justify-content: center; gap: 14px; pointer-events: none; }
  .dots i { width: 10px; height: 10px; border-radius: 50%; background: rgba(255,255,255,0.28); }
  .dots i.on { background: rgba(255,255,255,0.85); }
  .sheet-bg { position: absolute; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 5;
              animation: wpfade 0.25s ease; }
  .sheet { width: 620px; padding: 40px 48px; border-radius: 36px; background: rgba(28,34,46,0.96); box-shadow: 0 30px 80px rgba(0,0,0,0.6); }
  .sheet h2 { margin: 0; font-size: 40px; font-weight: 300; }
  .sheet .sstate { font-size: 26px; opacity: 0.75; margin-top: 8px; }
  .sheet .srow { display: flex; gap: 18px; margin-top: 30px; }
  .sheet .sbtn { flex: 1; height: 92px; border-radius: 28px; border: 0; color: #fff; font: 400 30px Roboto, "Noto Sans", sans-serif;
                 background: rgba(255,255,255,0.12); touch-action: manipulation; }
  .sheet .sbtn.on { background: #e8833a; }
  .sheet .sbtn.sel { background: rgba(127,214,194,0.35); }
  .sheet.wide { width: 1080px; padding: 36px 44px; }
  .sheet.wide .phead { display: flex; justify-content: space-between; align-items: baseline; }
  .sheet.wide .pgrid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-top: 26px; }
  .sheet.wide .pt { background: rgba(255,255,255,0.08); border-radius: 24px; padding: 20px 24px; min-width: 0; }
  .sheet.wide .pt .label { font-size: 20px; opacity: 0.6; text-transform: uppercase; letter-spacing: 2px; }
  .sheet.wide .pt .value { font-size: 52px; font-weight: 300; margin-top: 4px; white-space: nowrap; }
  .sheet.wide .pt .value small { font-size: 24px; opacity: 0.7; margin-left: 6px; }
  .sheet.wide .pt .sub { font-size: 22px; opacity: 0.7; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sheet.wide .pt .bar { margin-top: 12px; height: 8px; }
  .sheet.wide .pfoot { margin-top: 22px; font-size: 22px; opacity: 0.55; text-align: center; }
  .sheet.wide .pt.tap { cursor: pointer; position: relative; -webkit-tap-highlight-color: transparent; }
  .sheet.wide .pt.tap::after { content: "\u203A"; position: absolute; right: 20px; top: 12px; font-size: 34px; opacity: 0.35; }
  .sheet .dhead { display: flex; align-items: center; gap: 24px; }
  .sheet .dhead h2 { flex: 1; }
  .sheet .back { border: 0; background: rgba(255,255,255,0.1); color: #fff; font: 400 24px Roboto, "Noto Sans", sans-serif;
                 padding: 10px 22px; border-radius: 22px; touch-action: manipulation; }
  .sheet .rng { display: flex; gap: 8px; }
  .sheet .rng button { border: 0; background: rgba(255,255,255,0.08); color: #fff; font: 400 22px Roboto, "Noto Sans", sans-serif;
                       padding: 8px 20px; border-radius: 20px; touch-action: manipulation; }
  .sheet .rng button.sel { background: rgba(127,214,194,0.35); }
  .sheet .dbig { font-size: 78px; font-weight: 300; margin-top: 18px; }
  .sheet .dbig small { font-size: 26px; opacity: 0.65; margin-left: 12px; }
  .sheet svg.graph { width: 100%; height: 250px; margin-top: 10px; display: block; }
  .sheet .gx { display: flex; justify-content: space-between; font-size: 20px; opacity: 0.5; margin-top: 4px; }
  .sheet .gload { height: 250px; display: flex; align-items: center; justify-content: center; font-size: 26px; opacity: 0.5; }
  .sheet .sgrid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-top: 18px; }
  .sheet .sgrid .pt { padding: 14px 18px; }
  .sheet .sgrid .pt .value { font-size: 38px; }
  .sheet-bg.full { background: linear-gradient(160deg, #0b1f3a 0%, #123a5e 55%, #1b5a73 100%); align-items: stretch; justify-content: stretch; animation: wpfade 0.35s ease; }
  .sheet-bg.full .sheet { width: auto; flex: 1; border-radius: 0; background: transparent; box-shadow: none; padding: 44px 72px 40px; display: flex; flex-direction: column; }
  .sheet-bg.full .sheet.wide { width: auto; padding: 44px 72px 40px; }
  .sheet-bg.full .pgrid { margin-top: 24px; gap: 18px; }
  .sheet-bg.full .pt { padding: 16px 22px; }
  .sheet-bg.full .pt.tariff { grid-column: 1 / -1; display: flex; align-items: center; gap: 36px; padding: 16px 26px; }
  .pt.tariff .tl { flex: none; }
  .pt.tariff .tl .value { font-size: 46px; }
  .pt.tariff .tr { flex: 1; min-width: 0; }
  .pt.tariff .tr .sub { font-size: 24px; opacity: 0.85; white-space: normal; }
  .pt.tariff .bar { margin-top: 12px; height: 10px; }
  .sheet-bg.full .pt { background: rgba(255,255,255,0.09); }
  .sheet-bg.full .sheet.wide .pt .value { font-size: 54px; }
  .sheet-bg.full svg.graph { height: 300px; }
  .sheet-bg.full .dbig { font-size: 92px; }
  .homebtn { position: absolute; left: 26px; top: 22px; z-index: 4; border: 0; padding: 0; color: #fff; background: rgba(255,255,255,0.1);
             width: 56px; height: 56px; border-radius: 50%; display: flex; align-items: center; justify-content: center; opacity: 0.55;
             touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
  .homebtn svg { width: 28px; height: 28px; fill: currentColor; }
  .homebtn.pill { width: auto; height: 48px; border-radius: 24px; padding: 0 22px 0 16px; gap: 10px; font: 400 22px Roboto, "Noto Sans", sans-serif; }
  .homebtn.pill svg { width: 24px; height: 24px; }
  .sheet .sclose { margin-top: 26px; text-align: center; font-size: 22px; opacity: 0.5; }

  .todos { position: absolute; right: 72px; top: 214px; width: 400px; padding: 14px 26px 10px; border-radius: 28px;
           background: rgba(255,255,255,0.09); }
  .todos .tsec { cursor: pointer; -webkit-tap-highlight-color: transparent; }
  .todos .tsec + .tsec { border-top: 1px solid rgba(255,255,255,0.16); margin-top: 4px; padding-top: 6px; }
  .todos .th { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 2px; }
  .todos .label { font-size: 22px; opacity: 0.65; text-transform: uppercase; letter-spacing: 2px; }
  .todos .th span { font-size: 22px; opacity: 0.55; }
  .todos .ti { display: flex; align-items: center; gap: 16px; height: 48px; }
  .todos.split .ti { height: 37px; }
  .todos.split .tt { font-size: 26px; }
  .todos.split .label { font-size: 20px; }
  .todos .ti i { flex: none; width: 18px; height: 18px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.55); }
  .todos .ti.overdue i { border-color: #ff7a59; }
  .todos .ti.today i { border-color: #ffc857; }
  .todos .tt { flex: 1; min-width: 0; font-size: 28px; font-weight: 300; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .todos .td { flex: none; font-size: 20px; opacity: 0.65; }
  .todos .ti.overdue .td { color: #ff9a80; opacity: 1; }
  .todos .ti.today .td { color: #ffd27a; opacity: 1; }

  .tlist { margin-top: 22px; display: grid; grid-template-columns: 1fr; gap: 10px; align-content: start; }
  .tlist.two { grid-template-columns: 1fr 1fr; column-gap: 18px; }
  .trow { display: flex; align-items: center; gap: 8px; min-height: 76px; padding: 0 20px 0 6px; border-radius: 24px;
          background: rgba(255,255,255,0.09); min-width: 0; }
  .trow .tick { flex: none; width: 76px; height: 76px; border: 0; padding: 0; background: transparent; display: flex;
                align-items: center; justify-content: center; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
  .trow .tick i { width: 36px; height: 36px; border-radius: 50%; border: 3px solid rgba(255,255,255,0.6); position: relative; }
  .trow.overdue .tick i { border-color: #ff7a59; }
  .trow.today .tick i { border-color: #ffc857; }
  .trow .tt { flex: 1; min-width: 0; font-size: 30px; font-weight: 300; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .trow .td { flex: none; font-size: 22px; opacity: 0.65; }
  .trow.overdue .td { color: #ff9a80; opacity: 1; }
  .trow.today .td { color: #ffd27a; opacity: 1; }
  .trow.done .tt { text-decoration: line-through; opacity: 0.5; }
  .trow.done .tick i { border-color: #5fdc8c; background: #5fdc8c; }
  .trow.done .tick i::after { content: ""; position: absolute; left: 9px; top: 3px; width: 8px; height: 17px;
                              border: solid #10261a; border-width: 0 4px 4px 0; transform: rotate(45deg); }
  .trow .undo { flex: none; border: 0; background: rgba(255,255,255,0.16); color: #fff; font: 400 24px Roboto, "Noto Sans", sans-serif;
                padding: 12px 24px; border-radius: 26px; touch-action: manipulation; }
  .tempty { margin-top: 140px; text-align: center; font-size: 40px; font-weight: 300; opacity: 0.7; }
`;
  var TODO_PANEL_ROWS = 4;
  var TODO_SHEET_ROWS = 6;
  var TODO_UNDO_MS = 8e3;
  var WX_TEXT = {
    "clear-night": "Clear",
    cloudy: "Cloudy",
    exceptional: "Exceptional",
    fog: "Foggy",
    hail: "Hail",
    lightning: "Thunder",
    "lightning-rainy": "Thunderstorm",
    partlycloudy: "Partly cloudy",
    pouring: "Heavy rain",
    rainy: "Rain",
    snowy: "Snow",
    "snowy-rainy": "Sleet",
    sunny: "Sunny",
    windy: "Windy",
    "windy-variant": "Windy"
  };
  var esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  function fmtTime(d) {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  function fmtDate(d) {
    return d.toLocaleDateString(void 0, { weekday: "long", day: "numeric", month: "long" });
  }
  function fmtDuration(sec) {
    if (!Number.isFinite(sec) || sec < 0) return "";
    const s = Math.floor(sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor(s % 3600 / 60);
    const r = String(s % 60).padStart(2, "0");
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
  }
  function firstName(person) {
    const n = person?.attributes?.friendly_name ?? "";
    return n.split(" ")[0];
  }
  function joinNames(names) {
    if (names.length <= 1) return names.join("");
    return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
  }
  var WallPanelCard = class extends HTMLElement {
    setConfig(config) {
      if (!config || !config.tv) {
        throw new Error("wall-panel-card: `tv` (a media_player entity) is required");
      }
      this._config = {
        music: [],
        people: [],
        sleep: { start: "22:30", end: "06:00" },
        morning: { start: "06:00", end: "10:00" },
        sleep_clock: false,
        browsing_timeout_min: 15,
        auto_update: true,
        auto_update_minutes: 5,
        last_film_minutes: 2,
        sky: true,
        sun: "sun.sun",
        pixel_shift: true,
        pixel_shift_minutes: 3,
        pixel_shift_px: 3,
        music_linger_seconds: 30,
        nav_return_minutes: 5,
        ...config,
        brightness: { ...DEFAULT_BRIGHTNESS, ...config.brightness || {} },
        hold_ms: { ...DEFAULT_HOLD_MS, ...config.hold_ms || {} }
      };
      if (!this.shadowRoot) {
        this.attachShadow({ mode: "open" });
        this.shadowRoot.innerHTML = `<style>${STYLES}</style><div class="stage"></div>`;
        this._stage = this.shadowRoot.querySelector(".stage");
        this._stage.addEventListener("click", (e) => this._onTap(e));
        this._initSwipe();
      }
      this._sceneState = { scene: null, candidate: null, candidateSince: 0 };
      this._manual = null;
      this._sheet = null;
      this._renderedKey = null;
      this._todoItems = {};
      this._todoDone = {};
      this._unwatchTodos();
      this._shapes = {};
      this._palettes = {};
      this._artBlobs = {};
      this._artPending = {};
      this._artOrder = [];
    }
    set hass(hass) {
      this._hass = hass;
      this._initSelfUpdate();
      this._watchTodos();
      this._tick();
    }
    connectedCallback() {
      this._timer = setInterval(() => this._tick(), 15e3);
      this._shiftTimer = setInterval(() => this._shiftPixels(), 6e4);
      this._initSelfUpdate();
    }
    disconnectedCallback() {
      clearInterval(this._timer);
      clearInterval(this._shiftTimer);
      clearTimeout(this._holdTimer);
      clearInterval(this._updateTimer);
      this._updateTimer = null;
      this._updateStarted = false;
      this._unwatchTodos();
      this._stopFluid();
    }
    getCardSize() {
      return 12;
    }
    // ---- Lists: to-dos and shopping ---------------------------------------------
    _lists() {
      const c = this._config || {};
      return [{ key: "todo", id: c.todo, title: "To do" }, { key: "shopping", id: c.shopping, title: "Shopping" }].filter((l) => l.id);
    }
    // An entity's state is only a count, so subscribe to the items themselves:
    // edits made elsewhere (a phone, the HA app) show up at once.
    _watchTodos() {
      const conn = this._hass?.connection;
      if (!conn?.subscribeMessage) return;
      this._todoSubs = this._todoSubs || {};
      this._todoRetryAt = this._todoRetryAt || {};
      for (const { id } of this._lists()) {
        if (this._todoSubs[id] || Date.now() < (this._todoRetryAt[id] || 0)) continue;
        const sub = conn.subscribeMessage((msg) => {
          this._todoItems[id] = msg?.items || [];
          this._renderedKey = null;
          this._tick();
        }, { type: "todo/item/subscribe", entity_id: id });
        this._todoSubs[id] = sub;
        sub.catch(() => {
          delete this._todoSubs[id];
          this._todoRetryAt[id] = Date.now() + 6e4;
        });
      }
    }
    _unwatchTodos() {
      const subs = Object.values(this._todoSubs || {});
      this._todoSubs = {};
      subs.forEach((sub) => sub.then((off) => off && off()).catch(() => {
      }));
    }
    _todos(id, now) {
      return openTodos(this._todoItems[id], now);
    }
    _todoPanel(now) {
      const lists = this._lists().map((l) => ({ ...l, items: this._todos(l.id, now) })).filter((l) => l.items.length);
      if (!lists.length) return "";
      const share = shareRows(lists.map((l) => l.items.length), TODO_PANEL_ROWS);
      const section = (l, n) => `<div class="tsec" data-act="list" data-list="${l.key}"><div class="th"><div class="label">${l.title}</div><span>${l.items.length > n ? `${n} of ${l.items.length}` : l.items.length}</span></div>${l.items.slice(0, n).map((t) => `<div class="ti ${t.when}"><i></i><span class="tt">${esc(t.summary)}</span>${t.label ? `<span class="td">${esc(t.label)}</span>` : ""}</div>`).join("")}</div>`;
      return `<div class="todos${lists.length > 1 ? " split" : ""}">${lists.map((l, i) => section(l, share[i])).join("")}</div>`;
    }
    // One whole list. It does not scroll (swipes belong to page navigation), so
    // it shows as many as fit, most pressing first.
    _todoSheetHtml(key) {
      const list = this._lists().find((l) => l.key === key);
      if (!list) return "";
      const rows = this._todos(list.id, /* @__PURE__ */ new Date()).filter((t) => !this._todoDone[t.uid]);
      Object.values(this._todoDone).filter((d) => d.id === list.id).sort((a, b) => a.index - b.index).forEach((d) => rows.splice(Math.min(d.index, rows.length), 0, { ...d.item, done: true }));
      const max = TODO_SHEET_ROWS * 2;
      const shown = rows.slice(0, max);
      const open = rows.filter((t) => !t.done).length;
      const row = (t) => `<div class="trow ${t.done ? "done" : t.when}">
      <button class="tick" data-act="${t.done ? "td_undo" : "td_done"}" data-uid="${esc(t.uid)}" aria-label="${t.done ? "Undo" : "Done"}"><i></i></button>
      <span class="tt">${esc(t.summary)}</span>${t.done ? `<button class="undo" data-act="td_undo" data-uid="${esc(t.uid)}">Undo</button>` : t.label ? `<span class="td">${esc(t.label)}</span>` : ""}</div>`;
      const overdue = rows.filter((t) => !t.done && t.when === "overdue").length;
      return `<div class="sheet-bg full" data-act="noop"><div class="sheet wide" data-act="noop">
      <div class="dhead"><button class="back" data-act="g_close">\u2039 Home</button><h2>${list.title}</h2><div class="sstate">${open} open${overdue ? ` \xB7 ${overdue} overdue` : ""}</div></div>
      ${shown.length ? `<div class="tlist${shown.length > TODO_SHEET_ROWS ? " two" : ""}">${shown.map(row).join("")}</div>` : `<div class="tempty">All done</div>`}
      ${rows.length > max ? `<div class="pfoot">+${rows.length - max} more on your phone</div>` : ""}</div></div>`;
    }
    // Ticking completes the item straight away; the row stays for a few seconds
    // with an Undo, for a tap that was not meant.
    _todoTick(uid, undo) {
      const list = this._lists().find((l) => this._sheet === `list:${l.key}`);
      if (!list) return;
      const id = list.id;
      const set = (status) => this._hass.callService("todo", "update_item", { entity_id: id, item: uid, status });
      const forget = () => {
        const d = this._todoDone[uid];
        if (d) clearTimeout(d.timer);
        delete this._todoDone[uid];
      };
      if (undo) {
        if (!this._todoDone[uid]) return;
        forget();
        this._todoItems[id] = (this._todoItems[id] || []).map((i) => i.uid === uid ? { ...i, status: "needs_action" } : i);
        Promise.resolve(set("needs_action")).catch(() => {
        });
      } else {
        const open = this._todos(id, /* @__PURE__ */ new Date()).filter((t) => !this._todoDone[t.uid]);
        const index = open.findIndex((t) => t.uid === uid);
        if (index < 0) return;
        this._todoDone[uid] = {
          id,
          item: open[index],
          index,
          timer: setTimeout(() => {
            forget();
            this._syncSheet();
          }, TODO_UNDO_MS)
        };
        Promise.resolve(set("completed")).catch(() => {
          forget();
          this._syncSheet();
        });
      }
      this._armSheet(6e4);
      this._renderedKey = null;
      this._tick();
    }
    // Burn-in / image-retention guard: nudge the static layout by a few pixels
    // every few minutes (slowly, so it is not noticeable). The backgrounds stay put.
    _shiftPixels() {
      const c = this._config;
      if (!c || !this._stage || c.pixel_shift === false) return;
      const every = Math.max(1, Number(c.pixel_shift_minutes) || 3);
      this._shiftTicks = (this._shiftTicks || 0) + 1;
      if (this._shiftTicks % every !== 0) return;
      const px = Number(c.pixel_shift_px) || 3;
      const steps = [[0, 0], [1, 1], [-1, 1], [1, -1], [-1, -1], [0, 1], [1, 0], [-1, 0]];
      this._shiftIdx = ((this._shiftIdx || 0) + 1) % steps.length;
      const [x, y] = steps[this._shiftIdx];
      this._stage.style.setProperty("--sx", `${x * px}px`);
      this._stage.style.setProperty("--sy", `${y * px}px`);
    }
    _entity(id) {
      return id ? this._hass?.states?.[id] : void 0;
    }
    _tick() {
      if (!this._config || !this._hass) return;
      const c = this._config;
      const now = /* @__PURE__ */ new Date();
      const { scene, source } = computeScene({
        now,
        tv: this._entity(c.tv),
        music: (c.music || []).map((id) => this._entity(id)).filter(Boolean),
        people: (c.people || []).map((id) => this._entity(id)).filter(Boolean),
        sleep: c.sleep,
        morning: c.morning,
        tvPower: this._entity(c.tv_power),
        grid: this._entity(c.grid),
        browsingTimeoutMs: Number(c.browsing_timeout_min) * 6e4,
        musicLingerMs: Number(c.music_linger_seconds) * 1e3
      });
      const nowMs = Date.now();
      this._sceneState = stepScene(this._sceneState, scene, nowMs, c.hold_ms);
      clearTimeout(this._holdTimer);
      const cand = this._sceneState.candidate;
      if (cand) {
        const wait = Math.max(50, c.hold_ms[cand] - (nowMs - this._sceneState.candidateSince) + 20);
        this._holdTimer = setTimeout(() => this._tick(), wait);
      }
      this._lastSources = this._lastSources || {};
      if (source) this._lastSources[scene] = source;
      const shown = this._sceneState.scene;
      const autoSource = shown === scene ? source : this._lastSources[shown] || null;
      const manual = this._activeManual(shown);
      if (manual) {
        this._render(manual.scene, manual.scene === "music" ? this._musicSource() : this._entity(c.tv), now, { forceCar: manual.scene === "browsing", manual: true, auto: shown });
      } else {
        this._render(shown, autoSource, now, { auto: shown });
      }
    }
    // ---- Manual navigation ------------------------------------------------------
    // Three pages (home, music, movies), reached by swiping. A manual page ends
    // after `nav_return_minutes` without touch, or as soon as the automatic scene
    // changes (a film starts, the music stops, bedtime).
    _pageOf(scene) {
      return scene === "music" ? 1 : scene === "browsing" ? 2 : 0;
    }
    _activeManual(shown) {
      const m = this._manual;
      if (!m) return null;
      const navigable = ["day", "morning", "away", "music", "browsing"].includes(shown);
      if (Date.now() > m.until || !navigable || shown !== m.base) {
        this._manual = null;
        return null;
      }
      return m;
    }
    _musicSource() {
      const players = (this._config.music || []).map((id) => this._entity(id)).filter(Boolean);
      return players.find((e) => e.state === "playing") || players.find((e) => e.state === "paused") || players[0] || null;
    }
    // Swipes arrive as touch events on the kiosk's old WebView (a horizontal drag
    // is otherwise taken over by the browser and the pointer stream is cancelled)
    // and as pointer events with a mouse; both feed one handler.
    _initSwipe() {
      let start = null;
      const down = (x, y) => {
        start = { x, y, t: Date.now() };
      };
      const up = (x, y) => {
        if (!start) return;
        const dx = x - start.x, dy = y - start.y, dt = Date.now() - start.t;
        start = null;
        if (Math.abs(dx) > 80 && Math.abs(dx) > 1.6 * Math.abs(dy) && dt < 900 && Date.now() - (this._lastSwipe || 0) > 400) {
          this._lastSwipe = Date.now();
          this._navigate(dx < 0 ? 1 : -1);
        }
      };
      const st = this._stage;
      st.addEventListener("touchstart", (e) => {
        const t = e.changedTouches[0];
        down(t.clientX, t.clientY);
      }, { passive: true });
      st.addEventListener("touchend", (e) => {
        const t = e.changedTouches[0];
        up(t.clientX, t.clientY);
      }, { passive: true });
      st.addEventListener("touchcancel", () => {
        start = null;
      }, { passive: true });
      st.addEventListener("pointerdown", (e) => {
        if (e.pointerType === "mouse") down(e.clientX, e.clientY);
      });
      st.addEventListener("pointerup", (e) => {
        if (e.pointerType === "mouse") up(e.clientX, e.clientY);
      });
    }
    _navigate(dir) {
      if (!this._hass || this._config.navigation === false || this._sheet) return;
      const shown = this._sceneState.scene;
      if (!["day", "morning", "away", "music", "browsing"].includes(shown)) return;
      const cur = this._manual ? this._pageOf(this._manual.scene) : this._pageOf(shown);
      const next = Math.max(0, Math.min(2, cur + dir));
      if (next === cur) return;
      this._manual = {
        scene: ["day", "music", "browsing"][next],
        base: shown,
        until: Date.now() + Number(this._config.nav_return_minutes) * 6e4
      };
      this._renderedKey = null;
      this._tick();
    }
    _touchNav() {
      if (this._manual) this._manual.until = Date.now() + Number(this._config.nav_return_minutes) * 6e4;
    }
    // Jellyfin's description and poster, only when it is clearly what the TV shows.
    _matchedJellyfin(tv) {
      const id = this._config.jellyfin;
      if (!id) return null;
      return jellyfinForTv(this._entity(id), tv);
    }
    // The idle carousel ("Continue watching", then "Recently added"): one item at
    // a time, stepped on a fixed clock. Null when the library sensor is not
    // configured or has nothing, so the screen falls back to the plain info layout.
    _carouselItem(now) {
      const id = this._config.jellyfin_library;
      if (!id) return null;
      const items = carouselItems(this._entity(id));
      const item = carouselPick(items, now.getTime());
      if (item && items.length > 1) {
        const next = carouselPick(items, now.getTime() + 15e3);
        if (next && next.poster) this._fetchArt(next.poster);
      }
      return item;
    }
    _artUrl(entity) {
      const pic = entity?.attributes?.entity_picture_local || entity?.attributes?.entity_picture;
      if (!pic) return "";
      return /^https?:/.test(pic) ? pic : this._hass.hassUrl ? this._hass.hassUrl(pic) : pic;
    }
    _setBacklight(scene) {
      const bridge = window.KioskBridge;
      if (!bridge || typeof bridge.setBrightness !== "function") return;
      if (this._lastBacklightScene === scene) return;
      this._lastBacklightScene = scene;
      try {
        bridge.setBrightness(this._config.brightness[scene] ?? 0.4);
      } catch (e) {
      }
    }
    _render(scene, source, now, opts = {}) {
      const c = this._config;
      const lastFilmMs = Number.isFinite(Number(this._config.last_film_minutes)) ? Number(this._config.last_film_minutes) * 6e4 : DEFAULT_LAST_FILM_MS;
      const wantCar = scene === "browsing" && (opts.forceCar || carouselWanted(this._entity(c.jellyfin), source, now.getTime(), lastFilmMs));
      const car = wantCar ? this._carouselItem(now) : null;
      const jf = scene === "browsing" && !car ? this._matchedJellyfin(source) : null;
      const art = car && car.poster || jf && jf.poster || this._artUrl(source);
      const progressBucket = Math.floor(now.getTime() / 15e3);
      const key = [
        scene,
        fmtTime(now),
        art,
        source?.state,
        source?.attributes?.media_title,
        source?.attributes?.volume_level,
        scene === "music" || scene === "browsing" ? progressBucket : 0,
        jf ? `${jf.title}|${jf.episode}|${(jf.overview || "").length}` : "",
        car ? `${car.label}|${car.title}` : "",
        this._summaryKey(),
        opts.manual ? "m" : "",
        this._skyFor(scene) ? skyKey(this._skyArgs()) : ""
      ].join("|");
      this._syncSheet();
      if (key === this._renderedKey) return;
      this._renderedKey = key;
      this._currentArt = art;
      this._setBacklight(scene);
      const body = {
        cinema: () => "",
        sleep: () => c.sleep_clock ? this._clockOnly(now, true) : "",
        away: () => this._clockOnly(now, true),
        outage: () => this._outage(now),
        day: () => this._summary(now, false),
        morning: () => this._summary(now, true),
        music: () => this._nowPlaying(source, now, "music"),
        browsing: () => car ? this._carouselHtml(car, now) : this._nowPlaying(source, now, "browsing", jf)
      }[scene]();
      const layerFor = {
        day: "bg-day",
        morning: "bg-morning",
        away: "bg-away",
        outage: "bg-outage",
        music: "bg-art",
        browsing: "bg-art"
      }[scene];
      this._stopFluid();
      const carKey = car ? `${car.label}|${car.title}` : "";
      const fade = !!car && carKey !== this._lastCarKey;
      this._lastCarKey = carKey;
      const entering = this._lastShownScene != null && this._lastShownScene !== scene;
      this._lastShownScene = scene;
      const useFluid = scene === "music" || scene === "browsing";
      const fallback = scene === "music" ? DEFAULT_PALETTE : paletteFromText(car && car.title || jf && jf.title || source?.attributes?.media_title || "");
      if (!useFluid) this._fluidT0 = null;
      const backdrop = useFluid ? `<canvas class="fluid" width="96" height="60"></canvas><div class="veil ${scene === "music" ? "light" : "dim"}"></div>` : "";
      this._stage.innerHTML = `
      <div class="layer ${this._skyFor(scene) ? "" : layerFor || ""} on"${this._skyFor(scene) ? ` style="background:${skyCss(this._skyFor(scene))}"` : ""}>${layerFor === "bg-art" ? backdrop : ""}</div>
      <div class="content${entering ? " enter" : fade ? " fade" : ""}">${body}</div>${this._dotsHtml(scene)}${this._homeBtnHtml(scene)}`;
      this._sheetHtmlLast = null;
      this._syncSheet();
      if (fade || entering) {
        const content = this._stage.querySelector(".content");
        setTimeout(() => {
          if (content) content.classList.remove("fade", "enter");
        }, 1200);
      }
      if (useFluid) this._startFluid(art, fallback);
      const artEl = this._stage.querySelector(".art");
      if (artEl && art) {
        const known = this._artBlobs[art];
        if (known !== void 0) artEl.style.backgroundImage = `url(${JSON.stringify(known || art)})`;
        this._fetchArt(art);
        if (!this._shapes[art]) this._learnShape(art);
      }
    }
    // Artwork comes in any shape (portrait poster, square cover, landscape
    // still), so size the frame from the real image, remembered per URL so the
    // 15 s re-render doesn't flicker the box.
    _learnShape(url) {
      const probe = new Image();
      probe.onload = () => {
        const r = probe.naturalWidth / (probe.naturalHeight || 1);
        this._shapes[url] = this._isBlank(probe) ? "none" : r > 1.25 ? "wide" : r < 0.8 ? "poster" : "square";
        const media = this._stage.querySelector(".media");
        if (media && this._currentArt === url) {
          media.classList.remove("square", "poster", "wide", "none");
          media.classList.add(this._shapes[url]);
        }
      };
      this._fetchArt(url).then((src) => {
        probe.src = src || url;
      });
    }
    // Some players hand over a placeholder (e.g. a plain white image) instead of
    // real artwork. Draw it tiny and measure the pixel variance: no detail means
    // no art, so show the text-only layout instead of a blank rectangle.
    _isBlank(img) {
      try {
        const c = document.createElement("canvas");
        c.width = 24;
        c.height = 24;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0, 24, 24);
        const d = ctx.getImageData(0, 0, 24, 24).data;
        let sum = 0, sumSq = 0;
        const n = d.length / 4;
        for (let i = 0; i < d.length; i += 4) {
          const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          sum += y;
          sumSq += y * y;
        }
        const mean = sum / n;
        return Math.sqrt(Math.max(0, sumSq / n - mean * mean)) < 6;
      } catch (e) {
        return false;
      }
    }
    // ---- Self-update ----------------------------------------------------------
    // The kiosk never reloads its page and HA lets browsers cache this file for
    // 31 days, so a new card on the server would never reach the panel. Compare
    // the running copy with the server's every few minutes; if they differ (and
    // the scene is calm, see lib/self-update.js) refresh the cached copy and
    // reload. `auto_update: false` turns it off.
    _initSelfUpdate() {
      if (this._updateStarted || !this._config || this._config.auto_update === false) return;
      const own = performance.getEntriesByType("resource").filter((e) => /wall-panel-card\.js/.test(e.name)).pop();
      if (!own) return;
      this._updateStarted = true;
      this._selfUrl = own.name;
      const base = own.name.split("?")[0];
      fetch(own.name).then((r) => r.text()).then((text) => {
        this._loadedSig = signature(text);
        this._writeUpdateRecord(afterLoad(this._readUpdateRecord(), this._loadedSig));
      }).catch(() => {
      });
      const ms = Math.max(5e3, Number(this._config.auto_update_minutes) * 6e4 || 3e5);
      this._updateTimer = setInterval(() => this._checkForUpdate(base), ms);
    }
    _readUpdateRecord() {
      try {
        return JSON.parse(localStorage.getItem("wallPanelCard.update") || "null");
      } catch (e) {
        return null;
      }
    }
    _writeUpdateRecord(record) {
      try {
        localStorage.setItem("wallPanelCard.update", JSON.stringify(record));
      } catch (e) {
      }
    }
    async _checkForUpdate(base) {
      if (!this._loadedSig) return;
      try {
        const r = await fetch(`${base}?check=${Date.now()}`, { cache: "no-store" });
        if (!r.ok) return;
        const serverSig = signature(await r.text());
        const record = this._readUpdateRecord();
        const now = Date.now();
        if (!shouldReload({ scene: this._sceneState.scene, loadedSig: this._loadedSig, serverSig, now, record })) return;
        this._writeUpdateRecord({ ...record || {}, t: now, sig: serverSig });
        await fetch(this._selfUrl, { cache: "reload" });
        location.reload();
      } catch (e) {
      }
    }
    // ---- Music scene: Apple Music-style fluid background -------------------
    // Four soft colour blobs, taken from the artwork's own palette, drift slowly
    // on a tiny canvas (96x60) that CSS scales up, so the GPU does the smoothing
    // and the CPU only paints ~8 small frames a second.
    _startFluid(url, fallback) {
      const canvas = this._stage.querySelector("canvas.fluid");
      if (!canvas) return;
      if (this._fluidT0 == null) this._fluidT0 = performance.now();
      const begin = (palette) => {
        if (!this._stage.contains(canvas)) return;
        this._fluid = { canvas, palette };
        this._drawFluid();
        if (this._config.fluid !== false) {
          this._fluidTimer = setInterval(() => this._drawFluid(), 125);
        }
      };
      if (!url) return begin(fallback);
      if (this._palettes[url]) return begin(this._palettes[url]);
      this._drawFluidOnce(canvas, fallback);
      const img = new Image();
      img.onload = () => {
        const palette = this._paletteOf(img);
        if (palette) this._palettes[url] = palette;
        this._stopFluid();
        begin(palette || fallback);
      };
      img.onerror = () => begin(fallback);
      this._fetchArt(url).then((src) => {
        if (src) img.src = src;
        else begin(fallback);
      });
    }
    // Fetch artwork once, in CORS mode, and keep a same-origin blob copy. Showing
    // it and reading its colours then use that one copy: the page may only read
    // pixels of cross-origin art (Jellyfin posters) that was fetched with CORS,
    // and a plain no-CORS load for display would cache a copy that later CORS
    // reads cannot reuse. Resolves to the blob URL, or null if the fetch failed.
    _fetchArt(url) {
      if (this._artBlobs[url] !== void 0) return Promise.resolve(this._artBlobs[url]);
      if (this._artPending[url]) return this._artPending[url];
      this._artPending[url] = fetch(url, { mode: "cors" }).then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.blob();
      }).then((b) => {
        const blobUrl = URL.createObjectURL(b);
        this._artBlobs[url] = blobUrl;
        this._artOrder.push(url);
        while (this._artOrder.length > 5) {
          const old = this._artOrder.shift();
          URL.revokeObjectURL(this._artBlobs[old]);
          delete this._artBlobs[old];
        }
        this._showFetchedArt(url);
        return blobUrl;
      }).catch(() => {
        this._artBlobs[url] = null;
        this._showFetchedArt(url);
        return null;
      }).then((v) => {
        delete this._artPending[url];
        return v;
      });
      return this._artPending[url];
    }
    // Swap the on-screen artwork to its same-origin copy (looks identical).
    _showFetchedArt(url) {
      if (this._currentArt !== url || this._artBlobs[url] === void 0) return;
      const artEl = this._stage && this._stage.querySelector(".art");
      if (artEl) artEl.style.backgroundImage = `url(${JSON.stringify(this._artBlobs[url] || url)})`;
    }
    _paletteOf(img) {
      try {
        const c = document.createElement("canvas");
        c.width = 24;
        c.height = 24;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0, 24, 24);
        return extractPalette(ctx.getImageData(0, 0, 24, 24).data, 4);
      } catch (e) {
        return null;
      }
    }
    _stopFluid() {
      clearInterval(this._fluidTimer);
      this._fluidTimer = null;
      this._fluid = null;
    }
    _drawFluid() {
      if (!this._fluid) return;
      this._drawFluidOnce(this._fluid.canvas, this._fluid.palette);
    }
    _drawFluidOnce(canvas, palette) {
      const ctx = canvas.getContext("2d");
      const W = canvas.width, H = canvas.height;
      const t = (performance.now() - (this._fluidT0 ?? performance.now())) / 1e3;
      const base = palette[0].map((v) => Math.round(v * 0.3));
      ctx.fillStyle = `rgb(${base.join(",")})`;
      ctx.fillRect(0, 0, W, H);
      blobs(t).forEach((b, i) => {
        const c = palette[i % palette.length].join(",");
        const x = b.x * W, y = b.y * H, r = b.r * W;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(${c},0.95)`);
        g.addColorStop(1, `rgba(${c},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      });
    }
    // Usable pack size in Wh from the `battery_kwh` card key (e.g. the Energy
    // dashboard's battery capacity); null when not set, so callers fall back to
    // amp-hours x volts.
    _capacityWh() {
      const k = Number(this._config.battery_kwh);
      return Number.isFinite(k) && k > 0 ? k * 1e3 : null;
    }
    // Power cut: how full the battery is, what is drawing from it, roughly how
    // long it will last, and what the grid has cost today so far. (The geyser is
    // never on the battery, so it is not part of this load.)
    _outage(now) {
      const c = this._config;
      const num = (id) => Number(this._entity(id)?.state);
      const soc = num(c.battery);
      let load = num(c.load_power);
      if (!(load > 0)) {
        const d = num(c.battery_power);
        if (d > 0) load = d;
      }
      const reserve = Number.isFinite(Number(c.battery_reserve_pct)) ? Number(c.battery_reserve_pct) : 10;
      const run = outageRuntimeMin({ soc, ah: num(c.battery_ah), volts: num(c.battery_volts), loadW: load, reservePct: reserve, capacityWh: this._capacityWh() });
      const grid = this._entity(c.grid);
      const since = grid && Date.parse(grid.last_changed);
      const out = Number.isFinite(since) ? fmtMinutes(Math.max(0, Math.round((now.getTime() - since) / 6e4))) : "";
      const pct = Number.isFinite(soc) ? Math.max(0, Math.min(100, soc)) : 0;
      const accent = pct < 25 ? "#ff7a59" : pct < 50 ? "#ffc857" : "#7fd6c2";
      const cost = this._entity(c.grid_cost);
      const unit = cost?.attributes?.unit_of_measurement;
      const money = Number.isFinite(Number(cost?.state)) ? `${unit === "ZAR" ? "R" : unit ? unit + " " : ""}${Number(cost.state).toFixed(2)}` : "";
      const tiles = [];
      if (Number.isFinite(load) && load > 0) {
        tiles.push(`<div class="tile"><div class="label">Using</div><div class="value">${load >= 1e3 ? (load / 1e3).toFixed(1) : Math.round(load)}<small>${load >= 1e3 ? "kW" : "W"}</small></div><div class="sub">from the battery</div></div>`);
      }
      if (money) tiles.push(`<div class="tile"><div class="label">Grid today</div><div class="value">${esc(money)}</div><div class="sub">so far</div></div>`);
      return `<div class="outage">
      <div class="oh"><div class="otitle">Power cut</div>${out ? `<div class="osince">out for ${esc(out)}</div>` : ""}</div>
      <div class="obig" style="--accent:${accent}">
        <div class="opct">${Math.round(pct)}<small>%</small></div>
        ${run != null ? `<div class="orun"><span>Battery lasts about</span>${esc(fmtMinutes(run))}</div>` : ""}
      </div>
      <div class="bar" style="--accent:${accent}"><i style="width:${pct}%"></i></div>
      ${tiles.length ? `<div class="row">${tiles.join("")}</div>` : ""}
    </div>
    <div class="corner clock small">${fmtTime(now)}</div>`;
    }
    // Sun height and weather for the sky background (home and morning screens).
    _skyArgs() {
      const sun = this._entity(this._config.sun);
      return { elevation: sun?.attributes?.elevation, rising: sun?.attributes?.rising, weather: this._entity(this._config.weather)?.state };
    }
    _skyFor(scene) {
      if (this._config.sky === false || scene !== "day" && scene !== "morning") return null;
      return skyPalette(this._skyArgs());
    }
    _clockOnly(now, small) {
      return `<div class="clock ${small ? "small" : "hero"}">${fmtTime(now)}</div>`;
    }
    _summaryKey() {
      const c = this._config;
      return [c.weather, c.battery, c.battery_power, c.tariff_block, c.grid_from, c.grid_to, c.pv_power, c.load_power, c.grid_cost, c.battery_ah, c.battery_volts, c.grid, c.geyser, c.geyser_switch, c.geyser_timer, ...c.music || [], ...c.people || []].map((id) => {
        const e = this._entity(id);
        return e ? `${e.state}/${e.attributes?.temperature ?? ""}/${e.attributes?.media_title ?? ""}/${e.attributes?.finishes_at ?? ""}` : "";
      }).join(",");
    }
    _summary(now, morning) {
      const c = this._config;
      const home = (c.people || []).map((id) => this._entity(id)).filter((p) => p && p.state === "home").map(firstName).filter(Boolean);
      const hour = now.getHours();
      const salute = morning ? "Good morning" : hour >= 17 ? "Good evening" : "";
      const greeting = salute && home.length ? `${salute}, ${esc(joinNames(home))}` : salute;
      const wx = this._entity(c.weather);
      const temp = wx?.attributes?.temperature;
      const unit = wx?.attributes?.temperature_unit ?? "\xB0C";
      const cond = WX_TEXT[wx?.state] ?? (wx?.state ?? "");
      const weather = wx ? `<div class="wx"><div class="temp">${temp != null ? Math.round(temp) : "\u2013"}${esc(unit)}</div><div class="cond">${esc(cond)}</div></div>` : "";
      const tiles = [];
      const bat = this._entity(c.battery);
      const grid = this._entity(c.grid);
      if (bat && !Number.isNaN(Number(bat.state))) {
        const pct = Math.max(0, Math.min(100, Number(bat.state)));
        const accent = pct < 25 ? "#ff7a59" : pct < 50 ? "#ffc857" : "#7fd6c2";
        const w = Number(this._entity(c.battery_power)?.state);
        const flow = Number.isFinite(w) ? w > 30 ? "Discharging" : w < -30 ? "Charging" : "Idle" : "";
        const flowW = Number.isFinite(w) && Math.abs(w) > 30 ? ` ${Math.abs(Math.round(w))} W` : "";
        const gridOn = grid ? grid.state === "on" : null;
        tiles.push(`<div class="tile power tap" data-act="power" style="--accent:${accent}"><div class="label">Power</div>
        <div class="pwr-line"><div class="value">${Math.round(pct)}<small>%</small></div>${flow ? `<div class="pwr-state">${flow}${flowW}</div>` : ""}</div>
        <div class="bar"><i style="width:${pct}%"></i></div>
        ${gridOn === null ? "" : `<div class="pwr-meta"><span><span class="dot ${gridOn ? "" : "warn"}"></span>${gridOn ? "Grid on" : "Running on battery"}</span></div>`}</div>`);
      } else if (grid) {
        const on = grid.state === "on";
        tiles.push(`<div class="tile"><div class="label">Grid</div><div class="value"><span class="dot ${on ? "" : "warn"}"></span>${on ? "On" : "Off"}</div><div class="sub">${on ? "Mains available" : "Running on battery"}</div></div>`);
      }
      const gey = this._entity(c.geyser);
      if (gey && !Number.isNaN(Number(gey.state))) {
        const g = this._geyserState();
        tiles.push(`<div class="tile tap" data-act="geyser"><div class="label">Geyser</div><div class="value"><span class="dot ${g.heating ? "warn" : g.on ? "" : "off"}"></span>${g.heating ? (g.watts / 1e3).toFixed(1) : g.on ? "On" : "Off"}<small>${g.heating ? "kW" : ""}</small></div><div class="sub">${esc(g.sub)}</div></div>`);
      }
      const mini = this._miniPlayer() || {};
      if (mini.tile) tiles.push(mini.tile);
      const todos = this._todoPanel(now);
      return `
      <div class="top">
        <div>${greeting ? `<div class="greeting">${greeting}</div>` : ""}<div class="clock hero">${fmtTime(now)}</div><div class="date">${esc(fmtDate(now))}</div></div>
        ${weather}
      </div>
      ${todos}${mini.floating || ""}
      ${tiles.length ? `<div class="row">${tiles.join("")}</div>` : ""}${mini.after || ""}`;
    }
    // Geyser: power draw says whether it is heating; the switch says whether it is
    // allowed to; the timer (the one already configured in HA) says for how long.
    _geyserState() {
      const c = this._config;
      const watts = Number(this._entity(c.geyser)?.state) || 0;
      const sw = this._entity(c.geyser_switch);
      const on = sw ? sw.state === "on" : watts > 100;
      const heating = watts > 100;
      const timer = this._entity(c.geyser_timer);
      let left = "";
      if (timer && timer.state === "active") {
        const ms = Date.parse(timer.attributes?.finishes_at) - Date.now();
        if (Number.isFinite(ms) && ms > 0) {
          const m = Math.ceil(ms / 6e4);
          left = m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m left` : `${m} min left`;
        }
      }
      const sub = left || (heating ? "Heating" : on ? "On, not heating" : "Tap to control");
      return { watts, on, heating, timerActive: timer?.state === "active", left, sub, hasTimer: !!timer, hasSwitch: !!sw };
    }
    _sheetKey() {
      const g = this._geyserState();
      return `${g.on}|${g.heating}|${g.left}|${g.timerActive}`;
    }
    _sheetHtml() {
      if (this._sheet.indexOf("list:") === 0) return this._todoSheetHtml(this._sheet.slice(5));
      if (typeof this._sheet === "string" && this._sheet.indexOf("power:") === 0) return this._powerDetailHtml(this._sheet.slice(6));
      return this._sheet === "power" ? this._powerSheetHtml() : this._geyserSheetHtml();
    }
    _kw(w) {
      const n = Math.abs(Math.round(w));
      return n >= 1e3 ? `${(n / 1e3).toFixed(1)}<small>kW</small>` : `${n}<small>W</small>`;
    }
    // The wide Power screen: where the electricity is coming from and going to.
    _powerSheetHtml() {
      const c = this._config;
      const num = (id) => {
        const v = Number(this._entity(id)?.state);
        return Number.isFinite(v) ? v : null;
      };
      const soc = num(c.battery);
      const flow = num(c.battery_power);
      const gridIn = num(c.grid_from) ?? 0;
      const gridOut = num(c.grid_to) ?? 0;
      const pv = num(c.pv_power) ?? 0;
      const gridNet = gridIn - gridOut;
      const home = flow == null ? null : Math.max(0, gridNet + flow + pv);
      const volts = num(c.battery_volts), ah = num(c.battery_ah);
      const reserve = Number.isFinite(Number(c.battery_reserve_pct)) ? Number(c.battery_reserve_pct) : 10;
      let batLine = "Idle";
      if (flow != null && flow < -30) {
        const capWh = this._capacityWh() || (ah != null && volts != null ? ah * volts : null);
        const whLeft = capWh != null && soc != null ? capWh * (100 - soc) / 100 : null;
        const mins = whLeft != null ? Math.round(whLeft / Math.abs(flow) * 60) : null;
        batLine = mins != null && mins < 600 ? `Charging \xB7 full in ${fmtMinutes(mins)}` : `Charging ${Math.abs(Math.round(flow))} W`;
      } else if (flow != null && flow > 30) {
        const mins = outageRuntimeMin({ soc, ah, volts, loadW: flow, reservePct: reserve, capacityWh: this._capacityWh() });
        batLine = mins != null && mins < 6e3 ? `Discharging \xB7 ${fmtMinutes(mins)} left` : `Discharging ${Math.round(flow)} W`;
      }
      const gridOn = this._entity(c.grid)?.state !== "off";
      const g = this._geyserState();
      const cost = this._entity(c.grid_cost);
      const unit = cost?.attributes?.unit_of_measurement;
      const money = Number.isFinite(Number(cost?.state)) ? `${unit === "ZAR" ? "R" : unit ? unit + " " : ""}${Number(cost.state).toFixed(2)}` : "";
      const inK = num(c.grid_today_kwh), outK = num(c.grid_export_today_kwh), pvK = num(c.pv_today_kwh);
      const accent = soc == null ? "#7fd6c2" : soc < 25 ? "#ff7a59" : soc < 50 ? "#ffc857" : "#7fd6c2";
      const tile = (label, value, sub, act = "") => `<div class="pt${act ? " tap" : ""}"${act ? ` data-act="${act}"` : ""}><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${esc(sub)}</div></div>`;
      const tb = this._entity(c.tariff_block);
      let tariffHtml = "";
      if (tb && tb.state !== "unavailable" && tb.state !== "unknown") {
        const a = tb.attributes || {};
        const left = Number(a.left_in_block_kwh), pct = Number(a.progress_pct);
        const rate = Number(a.rate), next = Number(a.next_rate);
        const hasNext = Number.isFinite(left) && Number.isFinite(next);
        const bar = Number.isFinite(pct) ? `<div class="bar" style="--accent:${pct >= 90 ? "#ff7a59" : pct >= 70 ? "#ffc857" : "#7fd6c2"}"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div>` : "";
        tariffHtml = `<div class="pt tariff"><div class="tl"><div class="label">Tariff block</div><div class="value">${esc(tb.state)}<small>R${rate.toFixed(2)}/kWh</small></div></div>
        <div class="tr"><div class="sub">${hasNext ? `<b>${left.toFixed(0)} kWh</b> until block ${Number(tb.state) + 1} (R${next.toFixed(2)}/kWh) \xB7 ${Number(a.monthly_kwh).toFixed(0)} kWh used this month` : `Top block: every extra kWh costs R${rate.toFixed(2)} \xB7 ${Number(a.monthly_kwh).toFixed(0)} kWh this month`}</div>${bar}</div></div>`;
      }
      const foot = [
        volts != null ? `Battery ${volts.toFixed(1)} V` : "",
        num(c.battery_temp) != null ? `${Math.round(num(c.battery_temp))}\xB0C` : "",
        num(c.grid_volts) != null ? `Grid ${Math.round(num(c.grid_volts))} V` : ""
      ].filter(Boolean).join("  \xB7  ");
      return `<div class="sheet-bg full" data-act="noop"><div class="sheet wide" data-act="noop">
      <div class="dhead"><button class="back" data-act="g_close">\u2039 Home</button><h2>Power</h2><div class="sstate">${gridOn ? "Grid on" : "Power cut, running on battery"}</div></div>
      <div class="pgrid">
        <div class="pt tap" data-act="pd_battery" style="--accent:${accent}"><div class="label">Battery</div><div class="value">${soc != null ? Math.round(soc) : "\u2013"}<small>%</small></div><div class="bar"><i style="width:${soc ?? 0}%"></i></div><div class="sub" style="margin-top:10px">${esc(batLine)}</div></div>
        ${tile("Home using", home != null ? this._kw(home) : "\u2013", "right now", "pd_home")}
        ${tile("Grid", this._kw(gridNet), gridNet > 30 ? "importing" : gridNet < -30 ? "exporting" : "idle", "pd_grid")}
        ${tile("Solar", this._kw(pv), pvK != null ? `${pvK.toFixed(1)} kWh today` : pv > 30 ? "generating" : "not generating")}
        ${tile("Grid today", money ? esc(money) : inK != null ? inK.toFixed(1) + "<small>kWh</small>" : "\u2013", `${inK != null ? inK.toFixed(1) + " kWh in" : ""}${outK != null && outK > 0 ? " \xB7 " + outK.toFixed(1) + " out" : ""}`)}
        ${tile("Geyser", g.heating ? this._kw(g.watts) : g.on ? "On" : "Off", g.left || (g.heating ? "heating" : g.on ? "not heating" : "off"))}
        ${tariffHtml}
      </div>
      ${foot ? `<div class="pfoot">${esc(foot)}</div>` : ""}</div></div>`;
    }
    // ---- Power detail graphs --------------------------------------------------
    // Home Assistant keeps 5-minute averages, so a day is ~288 points: cheap to
    // fetch and draw even on this tablet. Cached for two minutes.
    _loadStats(hours) {
      const c = this._config;
      const ids = [c.battery, c.battery_power, c.grid_from, c.grid_to, c.pv_power].filter(Boolean);
      const cur = this._statsCache && this._statsCache[hours];
      if (cur && Date.now() - cur.t < 12e4) return cur.data;
      if (this._statsLoading || !ids.length) return cur ? cur.data : null;
      this._statsLoading = true;
      const now = Date.now();
      this._hass.callWS({
        type: "recorder/statistics_during_period",
        start_time: new Date(now - hours * 36e5).toISOString(),
        end_time: new Date(now).toISOString(),
        statistic_ids: ids,
        period: "5minute",
        types: ["mean"]
      }).then((r) => r, () => ({})).then((r) => {
        this._statsCache = this._statsCache || {};
        this._statsCache[hours] = { t: Date.now(), data: r, t0: now - hours * 36e5, n: hours * 12 };
        this._statsLoading = false;
        this._syncSheet();
      });
      return cur ? cur.data : null;
    }
    // One value per 5 minutes for the chosen graph, gaps filled with the last value.
    _graphSeries(kind, hours) {
      const entry = this._statsCache && this._statsCache[hours];
      if (!entry) return null;
      const c = this._config, d = entry.data || {};
      const col = (id) => {
        const out = new Array(entry.n).fill(null);
        (d[id] || []).forEach((p) => {
          const i = Math.round((p.start - entry.t0) / 3e5);
          if (i >= 0 && i < entry.n && Number.isFinite(p.mean)) out[i] = p.mean;
        });
        let last = null;
        for (let i = 0; i < out.length; i++) {
          if (out[i] == null) out[i] = last;
          else last = out[i];
        }
        return out;
      };
      const soc = col(c.battery), flow = col(c.battery_power), gin = col(c.grid_from), gout = col(c.grid_to), pv = col(c.pv_power);
      const v = [];
      for (let i = 0; i < entry.n; i++) {
        if (kind === "battery") v.push(soc[i]);
        else if (kind === "grid") v.push(gin[i] == null ? null : gin[i] - (gout[i] || 0));
        else v.push(gin[i] == null || flow[i] == null ? null : Math.max(0, gin[i] - (gout[i] || 0) + flow[i] + (pv[i] || 0)));
      }
      return { values: v, t0: entry.t0, hours };
    }
    _graphHtml(series, opt) {
      const vals = series.values;
      const ok = vals.filter((x) => x != null);
      if (ok.length < 3) return '<div class="gload">No history yet</div>';
      let lo = opt.min != null ? opt.min : Math.min(0, ...ok);
      let hi = opt.max != null ? opt.max : Math.max(1, ...ok) * 1.1;
      if (hi - lo < 1) hi = lo + 1;
      const W = 960, H = 240, n = vals.length;
      const X = (i) => i / (n - 1) * W, Y = (x) => H - (x - lo) / (hi - lo) * (H - 8) - 4;
      let line = "", first = -1, lastI = -1;
      vals.forEach((x, i) => {
        if (x == null) return;
        if (first < 0) first = i;
        lastI = i;
        line += `${line ? "L" : "M"}${X(i).toFixed(1)},${Y(x).toFixed(1)}`;
      });
      const area = `${line}L${X(lastI).toFixed(1)},${Y(lo)}L${X(first).toFixed(1)},${Y(lo)}Z`;
      const grid = [0.25, 0.5, 0.75].map((f) => `<line x1="0" x2="${W}" y1="${(H * f).toFixed(0)}" y2="${(H * f).toFixed(0)}" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>`).join("");
      const zero = lo < 0 ? `<line x1="0" x2="${W}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}" stroke="rgba(255,255,255,0.3)" stroke-width="1.5" stroke-dasharray="6 6"/>` : "";
      const lastV = vals[lastI];
      const ticks = [0, 1, 2, 3, 4].map((f) => fmtTime(new Date(series.t0 + series.hours * 36e5 * f / 4)));
      return `<svg class="graph" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs><linearGradient id="gfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${opt.color}" stop-opacity="0.45"/><stop offset="1" stop-color="${opt.color}" stop-opacity="0.02"/></linearGradient></defs>
      ${grid}${zero}<path d="${area}" fill="url(#gfill)"/><path d="${line}" fill="none" stroke="${opt.color}" stroke-width="3" stroke-linejoin="round"/>
      <circle cx="${X(lastI).toFixed(1)}" cy="${Y(lastV).toFixed(1)}" r="6" fill="${opt.color}"/></svg>
      <div class="gx">${ticks.map((t) => `<span>${t}</span>`).join("")}</div>`;
    }
    _powerDetailHtml(kind) {
      const c = this._config;
      const hours = this._range || 24;
      this._loadStats(hours);
      const ser = this._graphSeries(kind, hours);
      const num = (id) => {
        const v = Number(this._entity(id)?.state);
        return Number.isFinite(v) ? v : null;
      };
      const stat = (vals, t0) => {
        const ok = vals.map((x, i) => [x, i]).filter((p) => p[0] != null);
        if (!ok.length) return null;
        let mx = ok[0], mn = ok[0], sum = 0;
        ok.forEach((p) => {
          if (p[0] > mx[0]) mx = p;
          if (p[0] < mn[0]) mn = p;
          sum += p[0];
        });
        const at = (p) => fmtTime(new Date(t0 + p[1] * 3e5));
        return { max: mx[0], maxAt: at(mx), min: mn[0], minAt: at(mn), avg: sum / ok.length };
      };
      const st = ser ? stat(ser.values, ser.t0) : null;
      const tile = (label, value, sub2) => `<div class="pt"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${esc(sub2 || "")}</div></div>`;
      const kwh = (id) => {
        const v = num(id);
        return v == null ? "\u2013" : `${v.toFixed(1)}<small>kWh</small>`;
      };
      const w = (x) => x == null ? "\u2013" : this._kw(x);
      let title = "", big = "", sub = "", tiles = "", opt = {};
      if (kind === "battery") {
        const soc = num(c.battery), flow = num(c.battery_power);
        title = "Battery";
        opt = { min: 0, max: 100, color: "#7fd6c2" };
        big = `${soc != null ? Math.round(soc) : "\u2013"}<small>%</small>`;
        sub = flow != null && flow < -30 ? `charging at ${Math.abs(Math.round(flow))} W` : flow != null && flow > 30 ? `discharging at ${Math.round(flow)} W` : "resting";
        tiles = tile("Lowest", st ? `${Math.round(st.min)}<small>%</small>` : "\u2013", st ? "at " + st.minAt : "") + tile("Highest", st ? `${Math.round(st.max)}<small>%</small>` : "\u2013", st ? "at " + st.maxAt : "") + tile("Charged today", kwh(c.battery_charge_today), "into the battery") + tile("Discharged today", kwh(c.battery_discharge_today), "out of the battery");
      } else if (kind === "grid") {
        const net = (num(c.grid_from) ?? 0) - (num(c.grid_to) ?? 0);
        title = "Grid";
        opt = { color: "#8ab4ff" };
        big = this._kw(net);
        sub = net > 30 ? "importing now" : net < -30 ? "exporting now" : "idle";
        const cost = this._entity(c.grid_cost), unit = cost?.attributes?.unit_of_measurement;
        const money = Number.isFinite(Number(cost?.state)) ? `${unit === "ZAR" ? "R" : ""}${Number(cost.state).toFixed(2)}` : "\u2013";
        tiles = tile("Imported today", kwh(c.grid_today_kwh), "from the grid") + tile("Exported today", kwh(c.grid_export_today_kwh), "to the grid") + tile("Cost today", esc(money), "so far") + tile("Peak", st ? w(Math.max(0, st.max)) : "\u2013", st ? "at " + st.maxAt : "");
      } else {
        const flow = num(c.battery_power);
        const home = flow == null ? null : Math.max(0, (num(c.grid_from) ?? 0) - (num(c.grid_to) ?? 0) + flow + (num(c.pv_power) ?? 0));
        title = "Home";
        opt = { color: "#ffc857" };
        big = home != null ? this._kw(home) : "\u2013";
        sub = "using right now";
        tiles = tile("Peak", st ? w(st.max) : "\u2013", st ? "at " + st.maxAt : "") + tile("Average", st ? w(st.avg) : "\u2013", `over ${hours} h`) + tile("Lowest", st ? w(st.min) : "\u2013", st ? "at " + st.minAt : "") + tile("Geyser", this._geyserState().heating ? this._kw(this._geyserState().watts) : "Off", "right now");
      }
      return `<div class="sheet-bg full" data-act="noop"><div class="sheet wide" data-act="noop">
      <div class="dhead"><button class="back" data-act="pd_back">\u2039 Power</button><h2>${title}</h2>
        <div class="rng"><button class="${hours === 6 ? "sel" : ""}" data-act="pr_6">6 h</button><button class="${hours === 24 ? "sel" : ""}" data-act="pr_24">24 h</button></div></div>
      <div class="dbig">${big}<small>${esc(sub)}</small></div>
      ${ser ? this._graphHtml(ser, opt) : '<div class="gload">Loading history\u2026</div>'}
      <div class="sgrid">${tiles}</div></div></div>`;
    }
    _geyserSheetHtml() {
      const g = this._geyserState();
      const timer = this._entity(this._config.geyser_timer);
      const dur = String(timer?.attributes?.duration || "1:00:00").split(":");
      const mins = Number(dur[0]) * 60 + Number(dur[1]);
      const durText = mins >= 60 && mins % 60 === 0 ? `${mins / 60} hour${mins === 60 ? "" : "s"}` : `${mins} min`;
      const status = g.heating ? `Heating, ${(g.watts / 1e3).toFixed(1)} kW` : g.on ? "On, not heating" : "Off";
      return `<div class="sheet-bg" data-act="g_close"><div class="sheet" data-act="noop">
      <h2>Geyser</h2><div class="sstate">${esc(status)}${g.left ? " \xB7 " + esc(g.left) : ""}</div>
      <div class="srow">
        <button class="sbtn ${g.on ? "on" : ""}" data-act="g_on">On</button>
        <button class="sbtn ${!g.on ? "sel" : ""}" data-act="g_off">Off</button>
      </div>
      ${g.hasTimer ? `<div class="srow">${g.timerActive ? `<button class="sbtn" data-act="g_cancel">Cancel timer</button>` : `<button class="sbtn" data-act="g_timer">Heat for ${esc(durText)}</button>`}</div>` : ""}
      <div class="sclose">tap outside to close</div></div></div>`;
    }
    // A faint way back to the home page from the music and movies screens.
    _homeBtnHtml(scene) {
      const style = this._config.home_button;
      if (style === false || style === "off" || !["music", "browsing"].includes(scene)) return "";
      const house = '<svg viewBox="0 0 24 24"><path d="M12 3 2 12h3v8h5v-6h4v6h5v-8h3z"/></svg>';
      return style === "pill" ? `<button class="homebtn pill" data-act="nav_home" aria-label="Home">${house}Home</button>` : `<button class="homebtn" data-act="nav_home" aria-label="Home">${house}</button>`;
    }
    _dotsHtml(scene) {
      if (this._config.navigation === false || !["day", "morning", "away", "music", "browsing"].includes(scene)) return "";
      const i = this._pageOf(scene);
      return `<div class="dots">${[0, 1, 2].map((n) => `<i class="${n === i ? "on" : ""}"></i>`).join("")}</div>`;
    }
    // The always-there music tile on the home screen: artwork, title, play/pause
    // and next. Tapping the rest of the tile opens the music screen.
    _miniPlayer() {
      const c = this._config;
      if (!(c.music || []).length || c.mini_player === false) return "";
      const src = this._musicSource();
      if (!src) return "";
      const a = src.attributes || {};
      const live = src.state === "playing" || src.state === "paused";
      const art = live ? this._artUrl(src) : "";
      const ctl = mediaControls(src);
      const id = esc(src.entity_id);
      const icon = src.state === "playing" ? '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
      const next = '<svg viewBox="0 0 24 24"><path d="M6 5l9 7-9 7zM17 5h2v14h-2z"/></svg>';
      const btns = `${ctl.playPause ? `<button class="ctl" data-act="playpause" data-ent="${id}">${icon}</button>` : ""}${live && ctl.next ? `<button class="ctl" data-act="next" data-ent="${id}">${next}</button>` : ""}`;
      this._miniArt = art;
      if (art) this._fetchArt(art);
      const known = art ? this._artBlobs[art] : void 0;
      const bg = art ? `style="background-image:url(${esc(JSON.stringify(known || art))})"` : "";
      const style = c.mini_style || "tile";
      const title = live ? a.media_title || "Playing" : "Nothing playing";
      const artist = live ? a.media_artist || "" : "";
      if (style === "bar") {
        return { after: `<div class="minibar${live ? "" : " idle"}" data-act="open_music"><div class="mart" ${bg}></div>
        <div class="mtxt">${esc(title)}${artist ? `<span>${esc(artist)}</span>` : ""}</div>${btns}</div>` };
      }
      if (style === "orb") {
        const dur = Number(a.media_duration), pos = Number(a.media_position);
        const frac = live && dur > 0 && Number.isFinite(pos) ? Math.max(0, Math.min(1, pos / dur)) : 0;
        const C = 2 * Math.PI * 62;
        return { floating: `<div class="orb${live ? "" : " idle"}" data-act="open_music"><div class="mart" ${bg}></div>
        <svg class="ring" viewBox="0 0 132 132"><circle cx="66" cy="66" r="62" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="4"/>
        <circle cx="66" cy="66" r="62" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-dasharray="${(C * frac).toFixed(1)} ${C.toFixed(1)}"/></svg></div>` };
      }
      return { tile: `<div class="tile mini${live ? "" : " idle"}" data-act="open_music"><div class="mart" ${bg}></div>
      <div class="mtxt"><div class="label">${src.state === "playing" ? "Playing" : src.state === "paused" ? "Paused" : "Music"}</div>
      <div class="mtitle">${esc(live ? a.media_title || "Playing" : "Nothing playing")}</div>
      <div class="mart-sub">${esc(live ? a.media_artist || "" : "")}</div>
      <div class="mbtns">${btns}</div></div></div>` };
    }
    _nowPlaying(source, now, kind, jf = null) {
      const a = source?.attributes || {};
      const isMusic = kind === "music";
      const art = isMusic && source && source.state !== "playing" && source.state !== "paused" ? "" : this._artUrl(source);
      const facts = jf ? jellyfinFacts(jf) : null;
      const idleMusic = isMusic && source && source.state !== "playing" && source.state !== "paused";
      const title = jf ? jf.title : idleMusic ? "Nothing playing" : a.media_title || (isMusic ? "Playing" : a.app_name || "Apple TV");
      const sub = idleMusic ? "" : facts ? facts.line : isMusic ? a.media_artist || "" : a.media_series_title || a.media_artist || a.app_name || "";
      const album = isMusic && !idleMusic && !sameText(a.media_album_name, a.media_artist) && !sameText(a.media_album_name, a.media_title) ? a.media_album_name || "" : "";
      const where = isMusic ? source?.attributes?.friendly_name || "" : a.app_name || "";
      const dur = Number(a.media_duration);
      let pos = Number(a.media_position);
      if (Number.isFinite(pos) && source?.state === "playing" && a.media_position_updated_at) {
        pos += (now.getTime() - new Date(a.media_position_updated_at).getTime()) / 1e3;
      }
      const showBar = !idleMusic && Number.isFinite(dur) && dur > 0 && Number.isFinite(pos);
      const pct = showBar ? Math.max(0, Math.min(100, pos / dur * 100)) : 0;
      const kicker = isMusic ? source?.state === "paused" ? "Paused" : source?.state === "playing" ? "Now playing" : "Music" : source?.state === "paused" ? "Paused" : a.app_name || "Apple TV";
      const shape = !art ? "none" : this._shapes[art] || (isMusic ? "square" : "poster");
      return `
      <div class="media ${shape}${jf ? " desc" : ""}">
        <div class="art"></div>
        <div class="meta">
          <div class="kicker">${esc(kicker)}</div>
          <div class="title">${esc(title)}</div>
          ${sub ? `<div class="artist">${esc(sub)}</div>` : ""}
          ${album ? `<div class="album">${esc(album)}</div>` : ""}
          ${facts && facts.chips.length ? `<div class="chips">${facts.chips.map((c) => `<span class="chip">${esc(c)}</span>`).join("")}</div>` : ""}
          ${jf && jf.overview ? `<div class="overview">${esc(jf.overview)}</div>` : ""}
          ${showBar ? `<div class="progress"><div class="bar"><i style="width:${pct.toFixed(1)}%"></i></div><div class="times"><span>${fmtDuration(pos)}</span><span>${fmtDuration(dur)}</span></div></div>` : ""}
          ${this._controlsHtml(source, isMusic)}
          ${where ? `<div class="badge">${esc(where)}</div>` : ""}
        </div>
      </div>
      <div class="corner clock small">${fmtTime(now)}</div>`;
    }
    // One carousel item: the same poster-and-details layout as the paused info
    // screen, labelled "Continue watching" or "Recently added", with a progress
    // bar for items that are partly watched.
    _carouselHtml(item, now) {
      const facts = jellyfinFacts(item);
      const pct = Number(item.progress_pct);
      const bar = Number.isFinite(pct) && pct > 0 ? `<div class="progress"><div class="bar"><i style="width:${Math.min(100, pct)}%"></i></div><div class="times"><span>${Math.round(pct)}% watched</span></div></div>` : "";
      return `
      <div class="media poster desc">
        <div class="art"></div>
        <div class="meta">
          <div class="kicker">${esc(item.label)}</div>
          <div class="title">${esc(item.title)}</div>
          ${facts.line ? `<div class="artist">${esc(facts.line)}</div>` : ""}
          ${facts.chips.length ? `<div class="chips">${facts.chips.map((c) => `<span class="chip">${esc(c)}</span>`).join("")}</div>` : ""}
          ${item.overview ? `<div class="overview">${esc(item.overview)}</div>` : ""}
          ${bar}
        </div>
      </div>
      <div class="corner clock small">${fmtTime(now)}</div>`;
    }
    // ---- Touch controls ------------------------------------------------------
    // Big circular buttons on the music scene (previous / play-pause / next and
    // volume) and a single Resume button on the paused info screen. Only what the
    // player supports is shown (see mediaControls); taps are handled by one
    // delegated listener on the stage, so the 15 s re-render cannot drop them.
    _controlsHtml(source, isMusic) {
      if (this._config.touch_controls === false || !source) return "";
      const c = mediaControls(source);
      const id = esc(source.entity_id || "");
      const btn = (act, icon, cls = "", label = "") => `<button class="ctl ${cls}" data-act="${act}" data-ent="${id}" aria-label="${act}">${icon}${label}</button>`;
      const ICON = {
        play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
        pause: '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
        next: '<svg viewBox="0 0 24 24"><path d="M6 5l9 7-9 7zM17 5h2v14h-2z"/></svg>',
        prev: '<svg viewBox="0 0 24 24"><path d="M18 5l-9 7 9 7zM5 5h2v14H5z"/></svg>',
        minus: '<svg viewBox="0 0 24 24"><path d="M5 11h14v2H5z"/></svg>',
        plus: '<svg viewBox="0 0 24 24"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>'
      };
      if (isMusic) {
        if (!c.any) return "";
        const playing = source.state === "playing";
        const vol = Number(source.attributes?.volume_level);
        return `<div class="controls">
        ${c.previous ? btn("previous", ICON.prev) : ""}
        ${c.playPause ? btn("playpause", playing ? ICON.pause : ICON.play, "big") : ""}
        ${c.next ? btn("next", ICON.next) : ""}
        ${c.volume ? `<div class="vol">${btn("volume_down", ICON.minus, "small")}<span>${Number.isFinite(vol) ? Math.round(vol * 100) + "%" : ""}</span>${btn("volume_up", ICON.plus, "small")}</div>` : ""}
      </div>`;
      }
      if (source.state === "paused" && c.playPause) {
        return `<div class="controls">${btn("playpause", ICON.play, "wide", "Resume")}</div>`;
      }
      return "";
    }
    _onTap(e) {
      const el = e.target.closest && e.target.closest("[data-act]");
      if (!el || !this._hass) return;
      const now = Date.now();
      if (now - (this._lastTap || 0) < 350) return;
      this._lastTap = now;
      this._touchNav();
      const act = el.dataset.act;
      if (act === "noop") return;
      if (act === "geyser") return this._openSheet("geyser");
      if (act === "power") return this._openSheet("power");
      if (act === "list") return this._openSheet(`list:${el.dataset.list}`);
      if (act === "td_done" || act === "td_undo") return this._todoTick(el.dataset.uid, act === "td_undo");
      if (act.indexOf("pd_") === 0) {
        this._sheet = act === "pd_back" ? "power" : "power:" + act.slice(3);
        this._armSheet(6e4);
        return this._syncSheet();
      }
      if (act.indexOf("pr_") === 0) {
        this._range = Number(act.slice(3));
        this._armSheet(6e4);
        return this._syncSheet();
      }
      if (act === "g_close") return this._closeSheet();
      if (act.startsWith("g_")) return this._geyserAction(act);
      if (act === "nav_home") {
        const base = this._sceneState.scene;
        this._manual = base === "day" || base === "morning" || base === "away" ? null : { scene: "day", base, until: Date.now() + Number(this._config.nav_return_minutes) * 6e4 };
        this._renderedKey = null;
        return this._tick();
      }
      if (act === "open_music") {
        this._manual = {
          scene: "music",
          base: this._sceneState.scene,
          until: Date.now() + Number(this._config.nav_return_minutes) * 6e4
        };
        this._renderedKey = null;
        return this._tick();
      }
      const entity = this._hass.states[el.dataset.ent];
      const call = controlCall(act, entity);
      if (!call) return;
      el.classList.add("pressed");
      this._hass.callService(call[0], call[1], call[2]);
    }
    _openSheet(name = "geyser") {
      this._sheet = name;
      clearTimeout(this._sheetTimer);
      this._sheetTimer = setTimeout(() => this._closeSheet(), name === "geyser" ? 3e4 : 6e4);
      this._syncSheet();
    }
    _armSheet(ms) {
      clearTimeout(this._sheetTimer);
      this._sheetTimer = setTimeout(() => this._closeSheet(), ms);
    }
    _closeSheet() {
      this._sheet = null;
      clearTimeout(this._sheetTimer);
      this._syncSheet();
    }
    // Add, update or remove the geyser sheet in place, so opening it or pressing
    // a button never rebuilds (and flashes) the whole screen.
    _syncSheet() {
      if (!this._stage) return;
      const cur = this._stage.querySelector(".sheet-bg");
      if (!this._sheet) {
        if (cur) cur.remove();
        this._sheetHtmlLast = null;
        this._sheetShown = null;
        return;
      }
      const html = this._sheetHtml();
      if (cur && this._sheetHtmlLast === html) return;
      this._sheetHtmlLast = html;
      const holder = document.createElement("div");
      holder.innerHTML = html;
      const fresh = holder.firstElementChild;
      if (cur || this._sheetShown === this._sheet) fresh.style.animation = "none";
      this._sheetShown = this._sheet;
      if (cur) cur.replaceWith(fresh);
      else this._stage.appendChild(fresh);
    }
    // Uses the geyser's existing HA pieces: script.toggle_geyser (which also
    // verifies the state) and the existing timer, whose own automations switch
    // the geyser on when it starts and off when it finishes.
    _geyserAction(act) {
      const c = this._config;
      const svc = (d, s, data) => this._hass.callService(d, s, data);
      const script = (state) => svc("script", "toggle_geyser", { target_state: state });
      clearTimeout(this._sheetTimer);
      this._sheetTimer = setTimeout(() => this._closeSheet(), 3e4);
      const timerOn = this._entity(c.geyser_timer)?.state === "active";
      if (act === "g_on") script("on");
      else if (act === "g_off") {
        if (timerOn) svc("timer", "cancel", { entity_id: c.geyser_timer });
        script("off");
      } else if (act === "g_timer") svc("timer", "start", { entity_id: c.geyser_timer });
      else if (act === "g_cancel") {
        svc("timer", "cancel", { entity_id: c.geyser_timer });
        script("off");
      }
      setTimeout(() => this._syncSheet(), 1500);
    }
  };
  customElements.define("wall-panel-card", WallPanelCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "wall-panel-card",
    name: "Wall Panel",
    description: "Full-screen, scene-driven wall display: cinema, music, browsing, sleep, away, morning, day."
  });
})();
