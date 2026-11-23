// Wall Panel Card
//
// A full-screen, scene-driven card for a small always-on wall display (built
// for the Frameo kiosk in devices/frameo-wall-panel, but it works in any
// browser). It watches what is happening in the house — what the TV and the
// speakers are doing, who is home, the time — and shows the matching scene:
//
//   cinema    video playing        -> black, backlight to minimum
//   music     music playing        -> album art, track, progress
//   browsing  TV paused / idle     -> poster or artwork, title, state
//   sleep     night, nothing on    -> black
//   away      nobody home          -> dim clock
//   morning   morning window       -> greeting + summary
//   day       otherwise            -> clock + summary
//
// The scene logic is pure and unit-tested: src/lib/panel-scene.js.
//
// No helper entities (see ../CLAUDE.md): everything is read straight from the
// entities named in the card config. No chart library, no blur filters (the
// target GPU is a Mali-400): artwork backdrops are drawn tiny on a canvas
// and scaled up, which blurs them for free.
//
// If the host page exposes `window.KioskBridge` (the kiosk app does), the
// card also sets the screen backlight per scene. Elsewhere that is a no-op.
//
// This file is compiled by esbuild (see ../package.json) — edit this
// source, not the generated ../wall-panel-card.js.

import { computeScene, stepScene, DEFAULT_HOLD_MS } from "./lib/panel-scene.js";

const DEFAULT_BRIGHTNESS = {
  cinema: 0, sleep: 0, away: 0.12, music: 0.35, browsing: 0.35, morning: 0.5, day: 0.4,
};

const STYLES = `
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
  .art.square { width: 420px; height: 420px; }
  .art.poster { width: 400px; height: 600px; }
  .meta { min-width: 0; flex: 1; }
  .kicker { font-size: 24px; letter-spacing: 3px; text-transform: uppercase; opacity: 0.65; }
  .title { font-size: 66px; font-weight: 300; line-height: 1.08; margin-top: 12px;
           display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .artist { font-size: 38px; opacity: 0.85; margin-top: 14px; font-weight: 300; }
  .album { font-size: 28px; opacity: 0.6; margin-top: 8px; }
  .progress { margin-top: 36px; }
  .progress .bar { height: 8px; }
  .progress .times { display: flex; justify-content: space-between; font-size: 22px; opacity: 0.6; margin-top: 10px; }
  .badge { display: inline-block; margin-top: 26px; padding: 8px 20px; border-radius: 22px;
           background: rgba(255,255,255,0.14); font-size: 24px; letter-spacing: 1px; }
  .corner { position: absolute; right: 72px; bottom: 44px; }
`;

const WX_TEXT = {
  "clear-night": "Clear", cloudy: "Cloudy", exceptional: "Exceptional", fog: "Foggy",
  hail: "Hail", lightning: "Thunder", "lightning-rainy": "Thunderstorm",
  partlycloudy: "Partly cloudy", pouring: "Heavy rain", rainy: "Rain", snowy: "Snow",
  "snowy-rainy": "Sleet", sunny: "Sunny", windy: "Windy", "windy-variant": "Windy",
};

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function fmtTime(d) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function fmtDate(d) {
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}
function fmtDuration(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "";
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
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

class WallPanelCard extends HTMLElement {
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
      ...config,
      brightness: { ...DEFAULT_BRIGHTNESS, ...(config.brightness || {}) },
      hold_ms: { ...DEFAULT_HOLD_MS, ...(config.hold_ms || {}) },
    };
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.innerHTML = `<style>${STYLES}</style><div class="stage"></div>`;
      this._stage = this.shadowRoot.querySelector(".stage");
    }
    this._sceneState = { scene: null, candidate: null, candidateSince: 0 };
    this._renderedKey = null;
    this._artKey = null;
  }

  set hass(hass) {
    this._hass = hass;
    this._tick();
  }

  connectedCallback() {
    this._timer = setInterval(() => this._tick(), 15000);
  }

  disconnectedCallback() {
    clearInterval(this._timer);
    clearTimeout(this._holdTimer);
  }

  getCardSize() { return 12; }

  _entity(id) { return id ? this._hass?.states?.[id] : undefined; }

  _tick() {
    if (!this._config || !this._hass) return;
    const c = this._config;
    const now = new Date();
    const { scene, source } = computeScene({
      now,
      tv: this._entity(c.tv),
      music: (c.music || []).map((id) => this._entity(id)).filter(Boolean),
      people: (c.people || []).map((id) => this._entity(id)).filter(Boolean),
      sleep: c.sleep,
      morning: c.morning,
    });
    const nowMs = Date.now();
    this._sceneState = stepScene(this._sceneState, scene, nowMs, c.hold_ms);
    // If a change is pending, wake up exactly when its hold expires.
    clearTimeout(this._holdTimer);
    const cand = this._sceneState.candidate;
    if (cand) {
      const wait = Math.max(50, c.hold_ms[cand] - (nowMs - this._sceneState.candidateSince) + 20);
      this._holdTimer = setTimeout(() => this._tick(), wait);
    }
    // Remember each scene's own source while it is the live one, so a scene
    // that is being held past its trigger keeps showing what it was showing
    // (e.g. "music" keeps the last track) instead of a different player.
    this._lastSources = this._lastSources || {};
    if (source) this._lastSources[scene] = source;
    const shown = this._sceneState.scene;
    this._render(shown, shown === scene ? source : (this._lastSources[shown] || null), now);
  }

  _artUrl(entity) {
    const pic = entity?.attributes?.entity_picture_local || entity?.attributes?.entity_picture;
    if (!pic) return "";
    return /^https?:/.test(pic) ? pic : (this._hass.hassUrl ? this._hass.hassUrl(pic) : pic);
  }

  _setBacklight(scene) {
    const bridge = window.KioskBridge;
    if (!bridge || typeof bridge.setBrightness !== "function") return;
    if (this._lastBacklightScene === scene) return;
    this._lastBacklightScene = scene;
    try { bridge.setBrightness(this._config.brightness[scene] ?? 0.4); } catch (e) { /* ignore */ }
  }

  _render(scene, source, now) {
    const c = this._config;
    const art = this._artUrl(source);
    const progressBucket = Math.floor(now.getTime() / 15000);
    const key = [
      scene, fmtTime(now), art, source?.state, source?.attributes?.media_title,
      scene === "music" || scene === "browsing" ? progressBucket : 0,
      this._summaryKey(),
    ].join("|");
    if (key === this._renderedKey) return;
    this._renderedKey = key;
    this._setBacklight(scene);

    const body = {
      cinema: () => "",
      sleep: () => (c.sleep_clock ? this._clockOnly(now, true) : ""),
      away: () => this._clockOnly(now, true),
      day: () => this._summary(now, false),
      morning: () => this._summary(now, true),
      music: () => this._nowPlaying(source, now, "music"),
      browsing: () => this._nowPlaying(source, now, "browsing"),
    }[scene]();

    const layerFor = {
      day: "bg-day", morning: "bg-morning", away: "bg-away",
      music: "bg-art", browsing: "bg-art",
    }[scene];
    this._stage.innerHTML = `
      <div class="layer ${layerFor || ""} on">${layerFor === "bg-art" ? '<canvas width="48" height="30"></canvas><div class="veil"></div>' : ""}</div>
      <div class="content">${body}</div>`;
    if (layerFor === "bg-art") this._paintBackdrop(art);
    // Set via the DOM, not inline HTML, so quotes in a URL can't break the CSS.
    const artEl = this._stage.querySelector(".art");
    if (artEl && art) artEl.style.backgroundImage = `url(${JSON.stringify(art)})`;
  }

  // Draw the artwork tiny; CSS scaling then does the blur.
  _paintBackdrop(url) {
    const canvas = this._stage.querySelector("canvas");
    if (!canvas || !url) return;
    const img = new Image();
    img.onload = () => {
      try {
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      } catch (e) { /* ignore */ }
    };
    img.src = url;
  }

  _clockOnly(now, small) {
    return `<div class="clock ${small ? "small" : "hero"}">${fmtTime(now)}</div>`;
  }

  _summaryKey() {
    const c = this._config;
    return [c.weather, c.battery, c.grid, c.geyser, ...(c.people || [])]
      .map((id) => { const e = this._entity(id); return e ? `${e.state}/${e.attributes?.temperature ?? ""}` : ""; })
      .join(",");
  }

  _summary(now, morning) {
    const c = this._config;
    const home = (c.people || []).map((id) => this._entity(id))
      .filter((p) => p && p.state === "home").map(firstName).filter(Boolean);
    const hour = now.getHours();
    const greeting = morning
      ? `Good morning${home.length ? ", " + esc(joinNames(home)) : ""}`
      : (hour >= 17 ? "Good evening" : "");

    const wx = this._entity(c.weather);
    const temp = wx?.attributes?.temperature;
    const unit = wx?.attributes?.temperature_unit ?? "°C";
    const cond = WX_TEXT[wx?.state] ?? (wx?.state ?? "");
    const weather = wx ? `<div class="wx"><div class="temp">${temp != null ? Math.round(temp) : "–"}${esc(unit)}</div><div class="cond">${esc(cond)}</div></div>` : "";

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
      tiles.push(`<div class="tile"><div class="label">Geyser</div><div class="value"><span class="dot ${heating ? "warn" : "off"}"></span>${heating ? (w / 1000).toFixed(1) : "Idle"}<small>${heating ? "kW" : ""}</small></div><div class="sub">${heating ? "Heating" : "Not heating"}</div></div>`);
    }

    return `
      <div class="top">
        <div>${greeting ? `<div class="greeting">${greeting}</div>` : ""}<div class="clock hero">${fmtTime(now)}</div><div class="date">${esc(fmtDate(now))}</div></div>
        ${weather}
      </div>
      ${tiles.length ? `<div class="row">${tiles.join("")}</div>` : ""}`;
  }

  _nowPlaying(source, now, kind) {
    const a = source?.attributes || {};
    const art = this._artUrl(source);
    const isMusic = kind === "music";
    const title = a.media_title || (isMusic ? "Playing" : (a.app_name || "Apple TV"));
    const sub = isMusic
      ? [a.media_artist].filter(Boolean).join("")
      : (a.media_series_title || a.app_name || "");
    const album = isMusic ? (a.media_album_name || "") : "";
    const where = isMusic
      ? (source?.attributes?.friendly_name || "")
      : "";
    const dur = Number(a.media_duration);
    let pos = Number(a.media_position);
    if (Number.isFinite(pos) && source?.state === "playing" && a.media_position_updated_at) {
      pos += (now.getTime() - new Date(a.media_position_updated_at).getTime()) / 1000;
    }
    const showBar = Number.isFinite(dur) && dur > 0 && Number.isFinite(pos);
    const pct = showBar ? Math.max(0, Math.min(100, (pos / dur) * 100)) : 0;
    const kicker = isMusic ? "Now playing" : (source?.state === "paused" ? "Paused" : (a.app_name || "Apple TV"));
    const artClass = isMusic ? "square" : "poster";
    return `
      <div class="media">
        <div class="art ${artClass}"></div>
        <div class="meta">
          <div class="kicker">${esc(kicker)}</div>
          <div class="title">${esc(title)}</div>
          ${sub ? `<div class="artist">${esc(sub)}</div>` : ""}
          ${album ? `<div class="album">${esc(album)}</div>` : ""}
          ${showBar ? `<div class="progress"><div class="bar"><i style="width:${pct.toFixed(1)}%"></i></div><div class="times"><span>${fmtDuration(pos)}</span><span>${fmtDuration(dur)}</span></div></div>` : ""}
          ${where ? `<div class="badge">${esc(where)}</div>` : ""}
        </div>
      </div>
      <div class="corner clock small">${fmtTime(now)}</div>`;
  }
}

customElements.define("wall-panel-card", WallPanelCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "wall-panel-card",
  name: "Wall Panel",
  description: "Full-screen, scene-driven wall display: cinema, music, browsing, sleep, away, morning, day.",
});
