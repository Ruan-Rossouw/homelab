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
  function computeScene(input) {
    const {
      now,
      tv,
      music = [],
      people = [],
      sleep,
      morning,
      tvPower,
      browsingTimeoutMs = DEFAULT_BROWSING_TIMEOUT_MS
    } = input;
    const off = tvIsOff(tv, tvPower, now, browsingTimeoutMs);
    const tvKind = mediaKind(tv);
    if (tvKind === "video" && !(tvPower && POWER_OFF_STATES.has(tvPower.state))) {
      return { scene: "cinema", source: tv };
    }
    const musicSource = [tv, ...music].find((e) => mediaKind(e) === "music");
    if (musicSource) return { scene: "music", source: musicSource };
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
  function jellyfinForTv(sensor, tv) {
    if (!sensor || !tv || tv.state !== "paused") return null;
    const now = parseJellyfin(sensor);
    if (now && matchesJellyfin(tv, now)) return now;
    const last = asObject(sensor.attributes?.last);
    if (last && last.title && matchesJellyfin(tv, last)) return last;
    return null;
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

  // src/wall-panel-card.js
  var DEFAULT_BRIGHTNESS = {
    cinema: 0,
    sleep: 0,
    away: 0.12,
    music: 0.3,
    browsing: 0.2,
    morning: 0.5,
    day: 0.4
  };
  var STYLES = `
  :host { display: block; }
  .stage {
    position: fixed; inset: 0; z-index: 2147483000;
    overflow: hidden; color: #f4f6fa;
    font-family: Roboto, "Noto Sans", sans-serif;
    background: #000;
  }
  .layer { position: absolute; inset: 0; opacity: 0; transition: opacity 0.8s ease; }
  .layer.on { opacity: 1; }
  .bg-day { background: linear-gradient(160deg, #0b1f3a 0%, #123a5e 55%, #1b5a73 100%); }
  .bg-morning { background: linear-gradient(160deg, #3a1d3f 0%, #8a3e55 50%, #e0955a 100%); }
  .bg-away { background: #05070b; }
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
`;
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
        ...config,
        brightness: { ...DEFAULT_BRIGHTNESS, ...config.brightness || {} },
        hold_ms: { ...DEFAULT_HOLD_MS, ...config.hold_ms || {} }
      };
      if (!this.shadowRoot) {
        this.attachShadow({ mode: "open" });
        this.shadowRoot.innerHTML = `<style>${STYLES}</style><div class="stage"></div>`;
        this._stage = this.shadowRoot.querySelector(".stage");
        this._stage.addEventListener("click", (e) => this._onTap(e));
      }
      this._sceneState = { scene: null, candidate: null, candidateSince: 0 };
      this._renderedKey = null;
      this._shapes = {};
      this._palettes = {};
      this._artBlobs = {};
      this._artPending = {};
      this._artOrder = [];
    }
    set hass(hass) {
      this._hass = hass;
      this._initSelfUpdate();
      this._tick();
    }
    connectedCallback() {
      this._timer = setInterval(() => this._tick(), 15e3);
      this._initSelfUpdate();
    }
    disconnectedCallback() {
      clearInterval(this._timer);
      clearTimeout(this._holdTimer);
      clearInterval(this._updateTimer);
      this._updateTimer = null;
      this._updateStarted = false;
      this._stopFluid();
    }
    getCardSize() {
      return 12;
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
        browsingTimeoutMs: Number(c.browsing_timeout_min) * 6e4
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
      this._render(shown, shown === scene ? source : this._lastSources[shown] || null, now);
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
    _render(scene, source, now) {
      const c = this._config;
      const jf = scene === "browsing" ? this._matchedJellyfin(source) : null;
      const car = scene === "browsing" && !jf && source?.state === "idle" ? this._carouselItem(now) : null;
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
        this._summaryKey()
      ].join("|");
      if (key === this._renderedKey) return;
      this._renderedKey = key;
      this._currentArt = art;
      this._setBacklight(scene);
      const body = {
        cinema: () => "",
        sleep: () => c.sleep_clock ? this._clockOnly(now, true) : "",
        away: () => this._clockOnly(now, true),
        day: () => this._summary(now, false),
        morning: () => this._summary(now, true),
        music: () => this._nowPlaying(source, now, "music"),
        browsing: () => car ? this._carouselHtml(car, now) : this._nowPlaying(source, now, "browsing", jf)
      }[scene]();
      const layerFor = {
        day: "bg-day",
        morning: "bg-morning",
        away: "bg-away",
        music: "bg-art",
        browsing: "bg-art"
      }[scene];
      this._stopFluid();
      const carKey = car ? `${car.label}|${car.title}` : "";
      const fade = !!car && carKey !== this._lastCarKey;
      this._lastCarKey = carKey;
      const useFluid = scene === "music" || scene === "browsing";
      const fallback = scene === "music" ? DEFAULT_PALETTE : paletteFromText(car && car.title || jf && jf.title || source?.attributes?.media_title || "");
      if (!useFluid) this._fluidT0 = null;
      const backdrop = useFluid ? `<canvas class="fluid" width="96" height="60"></canvas><div class="veil ${scene === "music" ? "light" : "dim"}"></div>` : "";
      this._stage.innerHTML = `
      <div class="layer ${layerFor || ""} on">${layerFor === "bg-art" ? backdrop : ""}</div>
      <div class="content${fade ? " fade" : ""}">${body}</div>`;
      if (fade) {
        const content = this._stage.querySelector(".content");
        setTimeout(() => {
          if (content) content.classList.remove("fade");
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
    _clockOnly(now, small) {
      return `<div class="clock ${small ? "small" : "hero"}">${fmtTime(now)}</div>`;
    }
    _summaryKey() {
      const c = this._config;
      return [c.weather, c.battery, c.grid, c.geyser, ...c.people || []].map((id) => {
        const e = this._entity(id);
        return e ? `${e.state}/${e.attributes?.temperature ?? ""}` : "";
      }).join(",");
    }
    _summary(now, morning) {
      const c = this._config;
      const home = (c.people || []).map((id) => this._entity(id)).filter((p) => p && p.state === "home").map(firstName).filter(Boolean);
      const hour = now.getHours();
      const greeting = morning ? `Good morning${home.length ? ", " + esc(joinNames(home)) : ""}` : hour >= 17 ? "Good evening" : "";
      const wx = this._entity(c.weather);
      const temp = wx?.attributes?.temperature;
      const unit = wx?.attributes?.temperature_unit ?? "\xB0C";
      const cond = WX_TEXT[wx?.state] ?? (wx?.state ?? "");
      const weather = wx ? `<div class="wx"><div class="temp">${temp != null ? Math.round(temp) : "\u2013"}${esc(unit)}</div><div class="cond">${esc(cond)}</div></div>` : "";
      const tiles = [];
      const bat = this._entity(c.battery);
      if (bat && !Number.isNaN(Number(bat.state))) {
        const pct = Math.max(0, Math.min(100, Number(bat.state)));
        const accent = pct < 25 ? "#ff7a59" : pct < 50 ? "#ffc857" : "#7fd6c2";
        tiles.push(`<div class="tile" style="--accent:${accent}"><div class="label">Battery</div><div class="value">${Math.round(pct)}<small>%</small></div><div class="bar"><i style="width:${pct}%"></i></div></div>`);
      }
      const grid = this._entity(c.grid);
      if (grid) {
        const on = grid.state === "on";
        tiles.push(`<div class="tile"><div class="label">Grid</div><div class="value"><span class="dot ${on ? "" : "warn"}"></span>${on ? "On" : "Off"}</div><div class="sub">${on ? "Mains available" : "Running on battery"}</div></div>`);
      }
      const gey = this._entity(c.geyser);
      if (gey && !Number.isNaN(Number(gey.state))) {
        const w = Number(gey.state);
        const heating = w > 100;
        tiles.push(`<div class="tile"><div class="label">Geyser</div><div class="value"><span class="dot ${heating ? "warn" : "off"}"></span>${heating ? (w / 1e3).toFixed(1) : "Idle"}<small>${heating ? "kW" : ""}</small></div><div class="sub">${heating ? "Heating" : "Not heating"}</div></div>`);
      }
      return `
      <div class="top">
        <div>${greeting ? `<div class="greeting">${greeting}</div>` : ""}<div class="clock hero">${fmtTime(now)}</div><div class="date">${esc(fmtDate(now))}</div></div>
        ${weather}
      </div>
      ${tiles.length ? `<div class="row">${tiles.join("")}</div>` : ""}`;
    }
    _nowPlaying(source, now, kind, jf = null) {
      const a = source?.attributes || {};
      const art = this._artUrl(source);
      const isMusic = kind === "music";
      const facts = jf ? jellyfinFacts(jf) : null;
      const title = jf ? jf.title : a.media_title || (isMusic ? "Playing" : a.app_name || "Apple TV");
      const sub = facts ? facts.line : isMusic ? a.media_artist || "" : a.media_series_title || a.media_artist || a.app_name || "";
      const album = isMusic && !sameText(a.media_album_name, a.media_artist) && !sameText(a.media_album_name, a.media_title) ? a.media_album_name || "" : "";
      const where = isMusic ? source?.attributes?.friendly_name || "" : a.app_name || "";
      const dur = Number(a.media_duration);
      let pos = Number(a.media_position);
      if (Number.isFinite(pos) && source?.state === "playing" && a.media_position_updated_at) {
        pos += (now.getTime() - new Date(a.media_position_updated_at).getTime()) / 1e3;
      }
      const showBar = Number.isFinite(dur) && dur > 0 && Number.isFinite(pos);
      const pct = showBar ? Math.max(0, Math.min(100, pos / dur * 100)) : 0;
      const kicker = isMusic ? "Now playing" : source?.state === "paused" ? "Paused" : a.app_name || "Apple TV";
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
      const entity = this._hass.states[el.dataset.ent];
      const call = controlCall(el.dataset.act, entity);
      if (!call) return;
      el.classList.add("pressed");
      this._hass.callService(call[0], call[1], call[2]);
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
