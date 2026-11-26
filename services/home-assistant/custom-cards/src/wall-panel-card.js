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

import { extractPalette, blobs, DEFAULT_PALETTE, paletteFromText } from "./lib/fluid-palette.js";
import { signature, shouldReload, afterLoad } from "./lib/self-update.js";
import {
  computeScene, stepScene, DEFAULT_HOLD_MS, jellyfinFacts, sameText,
  mediaControls, controlCall, jellyfinForTv, carouselItems, carouselPick, carouselWanted, DEFAULT_LAST_FILM_MS,
  DEFAULT_MUSIC_LINGER_MS, outageRuntimeMin, fmtMinutes,
} from "./lib/panel-scene.js";

const DEFAULT_BRIGHTNESS = {
  cinema: 0, sleep: 0, away: 0.12, outage: 0.3, music: 0.3, browsing: 0.2, morning: 0.5, day: 0.4,
};

const STYLES = `
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
  .sheet.wide .pt.tap::after { content: "›"; position: absolute; right: 20px; top: 12px; font-size: 34px; opacity: 0.35; }
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
  .sheet-bg.full .pgrid { margin-top: 30px; gap: 22px; }
  .sheet-bg.full .pt { background: rgba(255,255,255,0.09); }
  .sheet-bg.full .sheet.wide .pt .value { font-size: 60px; }
  .sheet-bg.full svg.graph { height: 300px; }
  .sheet-bg.full .dbig { font-size: 92px; }
  .homebtn { position: absolute; left: 26px; top: 22px; z-index: 4; border: 0; padding: 0; color: #fff; background: rgba(255,255,255,0.1);
             width: 56px; height: 56px; border-radius: 50%; display: flex; align-items: center; justify-content: center; opacity: 0.55;
             touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
  .homebtn svg { width: 28px; height: 28px; fill: currentColor; }
  .homebtn.pill { width: auto; height: 48px; border-radius: 24px; padding: 0 22px 0 16px; gap: 10px; font: 400 22px Roboto, "Noto Sans", sans-serif; }
  .homebtn.pill svg { width: 24px; height: 24px; }
  .sheet .sclose { margin-top: 26px; text-align: center; font-size: 22px; opacity: 0.5; }
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
      browsing_timeout_min: 15,
      auto_update: true,
      auto_update_minutes: 5,
      last_film_minutes: 2,
      music_linger_seconds: 30,
      nav_return_minutes: 5,
      ...config,
      brightness: { ...DEFAULT_BRIGHTNESS, ...(config.brightness || {}) },
      hold_ms: { ...DEFAULT_HOLD_MS, ...(config.hold_ms || {}) },
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
    this._shapes = {};
    this._palettes = {};
    this._artBlobs = {};   // artwork URL -> same-origin blob URL, or null if it could not be fetched
    this._artPending = {};
    this._artOrder = [];
  }

  set hass(hass) {
    this._hass = hass;
    this._initSelfUpdate(); // idempotent; covers the config arriving after the element connects
    this._tick();
  }

  connectedCallback() {
    this._timer = setInterval(() => this._tick(), 15000);
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
      tvPower: this._entity(c.tv_power),
      grid: this._entity(c.grid),
      browsingTimeoutMs: Number(c.browsing_timeout_min) * 60000,
      musicLingerMs: Number(c.music_linger_seconds) * 1000,
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
    const autoSource = shown === scene ? source : (this._lastSources[shown] || null);
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
  _pageOf(scene) { return scene === "music" ? 1 : scene === "browsing" ? 2 : 0; }

  _activeManual(shown) {
    const m = this._manual;
    if (!m) return null;
    const navigable = ["day", "morning", "away", "music", "browsing"].includes(shown);
    if (Date.now() > m.until || !navigable || shown !== m.base) { this._manual = null; return null; }
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
    const down = (x, y) => { start = { x, y, t: Date.now() }; };
    const up = (x, y) => {
      if (!start) return;
      const dx = x - start.x, dy = y - start.y, dt = Date.now() - start.t;
      start = null;
      if (Math.abs(dx) > 80 && Math.abs(dx) > 1.6 * Math.abs(dy) && dt < 900
          && Date.now() - (this._lastSwipe || 0) > 400) {
        this._lastSwipe = Date.now();
        this._navigate(dx < 0 ? 1 : -1);
      }
    };
    const st = this._stage;
    st.addEventListener("touchstart", (e) => { const t = e.changedTouches[0]; down(t.clientX, t.clientY); }, { passive: true });
    st.addEventListener("touchend", (e) => { const t = e.changedTouches[0]; up(t.clientX, t.clientY); }, { passive: true });
    st.addEventListener("touchcancel", () => { start = null; }, { passive: true });
    st.addEventListener("pointerdown", (e) => { if (e.pointerType === "mouse") down(e.clientX, e.clientY); });
    st.addEventListener("pointerup", (e) => { if (e.pointerType === "mouse") up(e.clientX, e.clientY); });
  }

  _navigate(dir) {
    if (!this._hass || this._config.navigation === false || this._sheet) return;
    const shown = this._sceneState.scene;
    if (!["day", "morning", "away", "music", "browsing"].includes(shown)) return;
    const cur = this._manual ? this._pageOf(this._manual.scene) : this._pageOf(shown);
    const next = Math.max(0, Math.min(2, cur + dir));
    if (next === cur) return;
    this._manual = {
      scene: ["day", "music", "browsing"][next], base: shown,
      until: Date.now() + Number(this._config.nav_return_minutes) * 60000,
    };
    this._renderedKey = null;
    this._tick();
  }

  _touchNav() { if (this._manual) this._manual.until = Date.now() + Number(this._config.nav_return_minutes) * 60000; }

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
    if (item && items.length > 1) { // warm the next poster so the switch is instant
      const next = carouselPick(items, now.getTime() + 15000);
      if (next && next.poster) this._fetchArt(next.poster);
    }
    return item;
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

  _render(scene, source, now, opts = {}) {
    const c = this._config;
    // The carousel takes over when the Apple TV is idle, or once Jellyfin has had
    // no playing item for `last_film_minutes` (see carouselWanted). With no
    // library items to show, the film's details stay.
    const lastFilmMs = Number.isFinite(Number(this._config.last_film_minutes))
      ? Number(this._config.last_film_minutes) * 60000 : DEFAULT_LAST_FILM_MS;
    const wantCar = scene === "browsing"
      && (opts.forceCar || carouselWanted(this._entity(c.jellyfin), source, now.getTime(), lastFilmMs));
    const car = wantCar ? this._carouselItem(now) : null;
    const jf = scene === "browsing" && !car ? this._matchedJellyfin(source) : null;
    const art = (car && car.poster) || (jf && jf.poster) || this._artUrl(source);
    const progressBucket = Math.floor(now.getTime() / 15000);
    const key = [
      scene, fmtTime(now), art, source?.state, source?.attributes?.media_title, source?.attributes?.volume_level,
      scene === "music" || scene === "browsing" ? progressBucket : 0,
      jf ? `${jf.title}|${jf.episode}|${(jf.overview || "").length}` : "",
      car ? `${car.label}|${car.title}` : "",
      this._summaryKey(), opts.manual ? "m" : "",
    ].join("|");
    this._syncSheet();
    if (key === this._renderedKey) return;
    this._renderedKey = key;
    this._currentArt = art;
    this._setBacklight(scene);

    const body = {
      cinema: () => "",
      sleep: () => (c.sleep_clock ? this._clockOnly(now, true) : ""),
      away: () => this._clockOnly(now, true),
      outage: () => this._outage(now),
      day: () => this._summary(now, false),
      morning: () => this._summary(now, true),
      music: () => this._nowPlaying(source, now, "music"),
      browsing: () => (car ? this._carouselHtml(car, now) : this._nowPlaying(source, now, "browsing", jf)),
    }[scene]();

    const layerFor = {
      day: "bg-day", morning: "bg-morning", away: "bg-away", outage: "bg-outage",
      music: "bg-art", browsing: "bg-art",
    }[scene];
    this._stopFluid();
    // Fade only when the carousel moves to a new item, not on every re-render.
    const carKey = car ? `${car.label}|${car.title}` : "";
    const fade = !!car && carKey !== this._lastCarKey;
    this._lastCarKey = carKey;
    const entering = this._lastShownScene != null && this._lastShownScene !== scene;
    this._lastShownScene = scene;
    // Music and the paused/browsing info screen share the Apple Music-style
    // fluid gradient, built from the artwork's palette. With no usable artwork
    // music uses a default palette and the info screen a calm one derived from
    // the title, so it is never a flat black screen.
    const useFluid = scene === "music" || scene === "browsing";
    const fallback = scene === "music"
      ? DEFAULT_PALETTE
      : paletteFromText((car && car.title) || (jf && jf.title) || source?.attributes?.media_title || "");
    if (!useFluid) this._fluidT0 = null;
    const backdrop = useFluid
      ? `<canvas class="fluid" width="96" height="60"></canvas><div class="veil ${scene === "music" ? "light" : "dim"}"></div>`
      : "";
    this._stage.innerHTML = `
      <div class="layer ${layerFor || ""} on">${layerFor === "bg-art" ? backdrop : ""}</div>
      <div class="content${entering ? " enter" : fade ? " fade" : ""}">${body}</div>${this._dotsHtml(scene)}${this._homeBtnHtml(scene)}`;
    this._sheetHtmlLast = null; // the rebuild dropped the sheet element
    this._syncSheet();
    if (fade || entering) {
      // Never leave the content depending on the animation finishing: if the
      // animation clock stalls it would stay transparent. Drop the class after
      // the fade's duration so the content is back to normal either way.
      const content = this._stage.querySelector(".content");
      setTimeout(() => { if (content) content.classList.remove("fade", "enter"); }, 1200);
    }
    if (useFluid) this._startFluid(art, fallback);
    // Set via the DOM, not inline HTML, so quotes in a URL can't break the CSS.
    const artEl = this._stage.querySelector(".art");
    if (artEl && art) {
      // Show it from the CORS-fetched copy once we have one (see _fetchArt); a
      // failed fetch (null) falls back to the plain URL.
      const known = this._artBlobs[art];
      if (known !== undefined) artEl.style.backgroundImage = `url(${JSON.stringify(known || art)})`;
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
      this._shapes[url] = this._isBlank(probe)
        ? "none"
        : (r > 1.25 ? "wide" : r < 0.8 ? "poster" : "square");
      const media = this._stage.querySelector(".media");
      if (media && this._currentArt === url) {
        media.classList.remove("square", "poster", "wide", "none");
        media.classList.add(this._shapes[url]);
      }
    };
    // The same-origin copy lets us read the pixels (blank-artwork check).
    this._fetchArt(url).then((src) => { probe.src = src || url; });
  }

  // Some players hand over a placeholder (e.g. a plain white image) instead of
  // real artwork. Draw it tiny and measure the pixel variance: no detail means
  // no art, so show the text-only layout instead of a blank rectangle.
  _isBlank(img) {
    try {
      const c = document.createElement("canvas");
      c.width = 24; c.height = 24;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0, 24, 24);
      const d = ctx.getImageData(0, 0, 24, 24).data;
      let sum = 0, sumSq = 0;
      const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) {
        const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        sum += y; sumSq += y * y;
      }
      const mean = sum / n;
      return Math.sqrt(Math.max(0, sumSq / n - mean * mean)) < 6;
    } catch (e) {
      return false; // cross-origin / unreadable: assume it is real artwork
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
    }).catch(() => { /* try again on the next page load */ });
    const ms = Math.max(5000, Number(this._config.auto_update_minutes) * 60000 || 300000);
    this._updateTimer = setInterval(() => this._checkForUpdate(base), ms);
  }

  _readUpdateRecord() {
    try { return JSON.parse(localStorage.getItem("wallPanelCard.update") || "null"); } catch (e) { return null; }
  }

  _writeUpdateRecord(record) {
    try { localStorage.setItem("wallPanelCard.update", JSON.stringify(record)); } catch (e) { /* ignore */ }
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
      this._writeUpdateRecord({ ...(record || {}), t: now, sig: serverSig });
      await fetch(this._selfUrl, { cache: "reload" }); // refresh the cached copy first
      location.reload();
    } catch (e) { /* offline or HA restarting: try again next time */ }
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
      if (!this._stage.contains(canvas)) return; // a newer render replaced it
      this._fluid = { canvas, palette };
      this._drawFluid();
      // `fluid: false` keeps the same palette but as a still gradient, for a
      // slow display where even ~8 tiny frames a second is too much.
      if (this._config.fluid !== false) {
        this._fluidTimer = setInterval(() => this._drawFluid(), 125);
      }
    };
    if (!url) return begin(fallback);
    if (this._palettes[url]) return begin(this._palettes[url]);
    this._drawFluidOnce(canvas, fallback); // something pleasant until the art decodes
    const img = new Image();
    img.onload = () => {
      const palette = this._paletteOf(img); // null for a blank placeholder
      if (palette) this._palettes[url] = palette;
      this._stopFluid();
      begin(palette || fallback);
    };
    img.onerror = () => begin(fallback);
    this._fetchArt(url).then((src) => {
      if (src) img.src = src;
      else begin(fallback); // could not fetch it with CORS: no palette to read
    });
  }

  // Fetch artwork once, in CORS mode, and keep a same-origin blob copy. Showing
  // it and reading its colours then use that one copy: the page may only read
  // pixels of cross-origin art (Jellyfin posters) that was fetched with CORS,
  // and a plain no-CORS load for display would cache a copy that later CORS
  // reads cannot reuse. Resolves to the blob URL, or null if the fetch failed.
  _fetchArt(url) {
    if (this._artBlobs[url] !== undefined) return Promise.resolve(this._artBlobs[url]);
    if (this._artPending[url]) return this._artPending[url];
    this._artPending[url] = fetch(url, { mode: "cors" })
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.blob(); })
      .then((b) => {
        const blobUrl = URL.createObjectURL(b);
        this._artBlobs[url] = blobUrl;
        this._artOrder.push(url);
        while (this._artOrder.length > 5) { // keep a few; free the rest
          const old = this._artOrder.shift();
          URL.revokeObjectURL(this._artBlobs[old]);
          delete this._artBlobs[old];
        }
        this._showFetchedArt(url);
        return blobUrl;
      })
      .catch(() => { this._artBlobs[url] = null; this._showFetchedArt(url); return null; })
      .then((v) => { delete this._artPending[url]; return v; });
    return this._artPending[url];
  }

  // Swap the on-screen artwork to its same-origin copy (looks identical).
  _showFetchedArt(url) {
    if (this._currentArt !== url || this._artBlobs[url] === undefined) return;
    const artEl = this._stage && this._stage.querySelector(".art");
    if (artEl) artEl.style.backgroundImage = `url(${JSON.stringify(this._artBlobs[url] || url)})`;
  }

  _paletteOf(img) {
    try {
      const c = document.createElement("canvas");
      c.width = 24; c.height = 24;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0, 24, 24);
      return extractPalette(ctx.getImageData(0, 0, 24, 24).data, 4);
    } catch (e) {
      return null; // unreadable image: use the default palette
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
    const t = ((performance.now() - (this._fluidT0 ?? performance.now())) / 1000);
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

  // Power cut: how full the battery is, what is drawing from it, roughly how
  // long it will last, and what the grid has cost today so far. (The geyser is
  // never on the battery, so it is not part of this load.)
  _outage(now) {
    const c = this._config;
    const num = (id) => Number(this._entity(id)?.state);
    const soc = num(c.battery);
    let load = num(c.load_power);
    if (!(load > 0)) { const d = num(c.battery_power); if (d > 0) load = d; } // fall back to the battery's own discharge
    const reserve = Number.isFinite(Number(c.battery_reserve_pct)) ? Number(c.battery_reserve_pct) : 10;
    const run = outageRuntimeMin({ soc, ah: num(c.battery_ah), volts: num(c.battery_volts), loadW: load, reservePct: reserve });
    const grid = this._entity(c.grid);
    const since = grid && Date.parse(grid.last_changed);
    const out = Number.isFinite(since) ? fmtMinutes(Math.max(0, Math.round((now.getTime() - since) / 60000))) : "";
    const pct = Number.isFinite(soc) ? Math.max(0, Math.min(100, soc)) : 0;
    const accent = pct < 25 ? "#ff7a59" : pct < 50 ? "#ffc857" : "#7fd6c2";
    const cost = this._entity(c.grid_cost);
    const unit = cost?.attributes?.unit_of_measurement;
    const money = Number.isFinite(Number(cost?.state))
      ? `${unit === "ZAR" ? "R" : (unit ? unit + " " : "")}${Number(cost.state).toFixed(2)}` : "";
    const tiles = [];
    if (Number.isFinite(load) && load > 0) {
      tiles.push(`<div class="tile"><div class="label">Using</div><div class="value">${load >= 1000 ? (load / 1000).toFixed(1) : Math.round(load)}<small>${load >= 1000 ? "kW" : "W"}</small></div><div class="sub">from the battery</div></div>`);
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

  _clockOnly(now, small) {
    return `<div class="clock ${small ? "small" : "hero"}">${fmtTime(now)}</div>`;
  }

  _summaryKey() {
    const c = this._config;
    return [c.weather, c.battery, c.battery_power, c.grid_from, c.grid_to, c.pv_power, c.load_power, c.grid_cost, c.battery_ah, c.battery_volts, c.grid, c.geyser, c.geyser_switch, c.geyser_timer, ...(c.music || []), ...(c.people || [])]
      .map((id) => { const e = this._entity(id); return e ? `${e.state}/${e.attributes?.temperature ?? ""}/${e.attributes?.media_title ?? ""}/${e.attributes?.finishes_at ?? ""}` : ""; })
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
    const grid = this._entity(c.grid);
    if (bat && !Number.isNaN(Number(bat.state))) {
      const pct = Math.max(0, Math.min(100, Number(bat.state)));
      const accent = pct < 25 ? "#ff7a59" : pct < 50 ? "#ffc857" : "#7fd6c2";
      const w = Number(this._entity(c.battery_power)?.state);
      // Positive power means the battery is discharging.
      const flow = Number.isFinite(w) ? (w > 30 ? "Discharging" : w < -30 ? "Charging" : "Idle") : "";
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
      tiles.push(`<div class="tile tap" data-act="geyser"><div class="label">Geyser</div><div class="value"><span class="dot ${g.heating ? "warn" : g.on ? "" : "off"}"></span>${g.heating ? (g.watts / 1000).toFixed(1) : g.on ? "On" : "Off"}<small>${g.heating ? "kW" : ""}</small></div><div class="sub">${esc(g.sub)}</div></div>`);
    }
    const mini = this._miniPlayer() || {};
    if (mini.tile) tiles.push(mini.tile);

    return `
      <div class="top">
        <div>${greeting ? `<div class="greeting">${greeting}</div>` : ""}<div class="clock hero">${fmtTime(now)}</div><div class="date">${esc(fmtDate(now))}</div></div>
        ${weather}
      </div>
      ${mini.floating || ""}
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
        const m = Math.ceil(ms / 60000);
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
    if (typeof this._sheet === "string" && this._sheet.indexOf("power:") === 0) return this._powerDetailHtml(this._sheet.slice(6));
    return this._sheet === "power" ? this._powerSheetHtml() : this._geyserSheetHtml();
  }

  _kw(w) {
    const n = Math.abs(Math.round(w));
    return n >= 1000 ? `${(n / 1000).toFixed(1)}<small>kW</small>` : `${n}<small>W</small>`;
  }

  // The wide Power screen: where the electricity is coming from and going to.
  _powerSheetHtml() {
    const c = this._config;
    const num = (id) => { const v = Number(this._entity(id)?.state); return Number.isFinite(v) ? v : null; };
    const soc = num(c.battery);
    const flow = num(c.battery_power);           // + discharging, - charging
    const gridIn = num(c.grid_from) ?? 0;
    const gridOut = num(c.grid_to) ?? 0;
    const pv = num(c.pv_power) ?? 0;
    const gridNet = gridIn - gridOut;
    const home = flow == null ? null : Math.max(0, gridNet + flow + pv);
    const volts = num(c.battery_volts), ah = num(c.battery_ah);
    const reserve = Number.isFinite(Number(c.battery_reserve_pct)) ? Number(c.battery_reserve_pct) : 10;
    let batLine = "Idle";
    if (flow != null && flow < -30) {
      const whLeft = ah != null && volts != null && soc != null ? ah * volts * (100 - soc) / 100 : null;
      const mins = whLeft != null ? Math.round(whLeft / Math.abs(flow) * 60) : null;
      batLine = mins != null && mins < 600 ? `Charging · full in ${fmtMinutes(mins)}` : `Charging ${Math.abs(Math.round(flow))} W`;
    } else if (flow != null && flow > 30) {
      const mins = outageRuntimeMin({ soc, ah, volts, loadW: flow, reservePct: reserve });
      batLine = mins != null && mins < 6000 ? `Discharging · ${fmtMinutes(mins)} left` : `Discharging ${Math.round(flow)} W`;
    }
    const gridOn = this._entity(c.grid)?.state !== "off";
    const g = this._geyserState();
    const cost = this._entity(c.grid_cost);
    const unit = cost?.attributes?.unit_of_measurement;
    const money = Number.isFinite(Number(cost?.state)) ? `${unit === "ZAR" ? "R" : (unit ? unit + " " : "")}${Number(cost.state).toFixed(2)}` : "";
    const inK = num(c.grid_today_kwh), outK = num(c.grid_export_today_kwh), pvK = num(c.pv_today_kwh);
    const accent = soc == null ? "#7fd6c2" : soc < 25 ? "#ff7a59" : soc < 50 ? "#ffc857" : "#7fd6c2";
    const tile = (label, value, sub, act = "") => `<div class="pt${act ? " tap" : ""}"${act ? ` data-act="${act}"` : ""}><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${esc(sub)}</div></div>`;
    const foot = [volts != null ? `Battery ${volts.toFixed(1)} V` : "", num(c.battery_temp) != null ? `${Math.round(num(c.battery_temp))}°C` : "",
      num(c.grid_volts) != null ? `Grid ${Math.round(num(c.grid_volts))} V` : ""].filter(Boolean).join("  ·  ");
    return `<div class="sheet-bg full" data-act="noop"><div class="sheet wide" data-act="noop">
      <div class="dhead"><button class="back" data-act="g_close">\u2039 Home</button><h2>Power</h2><div class="sstate">${gridOn ? "Grid on" : "Power cut, running on battery"}</div></div>
      <div class="pgrid">
        <div class="pt tap" data-act="pd_battery" style="--accent:${accent}"><div class="label">Battery</div><div class="value">${soc != null ? Math.round(soc) : "–"}<small>%</small></div><div class="bar"><i style="width:${soc ?? 0}%"></i></div><div class="sub" style="margin-top:10px">${esc(batLine)}</div></div>
        ${tile("Home using", home != null ? this._kw(home) : "–", "right now", "pd_home")}
        ${tile("Grid", this._kw(gridNet), gridNet > 30 ? "importing" : gridNet < -30 ? "exporting" : "idle", "pd_grid")}
        ${tile("Solar", this._kw(pv), pvK != null ? `${pvK.toFixed(1)} kWh today` : (pv > 30 ? "generating" : "not generating"))}
        ${tile("Grid today", money ? esc(money) : (inK != null ? inK.toFixed(1) + "<small>kWh</small>" : "–"), `${inK != null ? inK.toFixed(1) + " kWh in" : ""}${outK != null && outK > 0 ? " · " + outK.toFixed(1) + " out" : ""}`)}
        ${tile("Geyser", g.heating ? this._kw(g.watts) : g.on ? "On" : "Off", g.left || (g.heating ? "heating" : g.on ? "not heating" : "off"))}
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
    if (cur && Date.now() - cur.t < 120000) return cur.data;
    if (this._statsLoading || !ids.length) return cur ? cur.data : null;
    this._statsLoading = true;
    const now = Date.now();
    this._hass.callWS({
      type: "recorder/statistics_during_period",
      start_time: new Date(now - hours * 3600000).toISOString(),
      end_time: new Date(now).toISOString(),
      statistic_ids: ids, period: "5minute", types: ["mean"],
    }).then((r) => r, () => ({})).then((r) => {
      this._statsCache = this._statsCache || {};
      this._statsCache[hours] = { t: Date.now(), data: r, t0: now - hours * 3600000, n: hours * 12 };
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
        const i = Math.round((p.start - entry.t0) / 300000);
        if (i >= 0 && i < entry.n && Number.isFinite(p.mean)) out[i] = p.mean;
      });
      let last = null;
      for (let i = 0; i < out.length; i++) { if (out[i] == null) out[i] = last; else last = out[i]; }
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
    const X = (i) => (i / (n - 1)) * W, Y = (x) => H - ((x - lo) / (hi - lo)) * (H - 8) - 4;
    let line = "", first = -1, lastI = -1;
    vals.forEach((x, i) => { if (x == null) return; if (first < 0) first = i; lastI = i; line += `${line ? "L" : "M"}${X(i).toFixed(1)},${Y(x).toFixed(1)}`; });
    const area = `${line}L${X(lastI).toFixed(1)},${Y(lo)}L${X(first).toFixed(1)},${Y(lo)}Z`;
    const grid = [0.25, 0.5, 0.75].map((f) => `<line x1="0" x2="${W}" y1="${(H * f).toFixed(0)}" y2="${(H * f).toFixed(0)}" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>`).join("");
    const zero = lo < 0 ? `<line x1="0" x2="${W}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}" stroke="rgba(255,255,255,0.3)" stroke-width="1.5" stroke-dasharray="6 6"/>` : "";
    const lastV = vals[lastI];
    const ticks = [0, 1, 2, 3, 4].map((f) => fmtTime(new Date(series.t0 + (series.hours * 3600000) * f / 4)));
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
    const num = (id) => { const v = Number(this._entity(id)?.state); return Number.isFinite(v) ? v : null; };
    const stat = (vals, t0) => {
      const ok = vals.map((x, i) => [x, i]).filter((p) => p[0] != null);
      if (!ok.length) return null;
      let mx = ok[0], mn = ok[0], sum = 0;
      ok.forEach((p) => { if (p[0] > mx[0]) mx = p; if (p[0] < mn[0]) mn = p; sum += p[0]; });
      const at = (p) => fmtTime(new Date(t0 + p[1] * 300000));
      return { max: mx[0], maxAt: at(mx), min: mn[0], minAt: at(mn), avg: sum / ok.length };
    };
    const st = ser ? stat(ser.values, ser.t0) : null;
    const tile = (label, value, sub) => `<div class="pt"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${esc(sub || "")}</div></div>`;
    const kwh = (id) => { const v = num(id); return v == null ? "–" : `${v.toFixed(1)}<small>kWh</small>`; };
    const w = (x) => (x == null ? "–" : this._kw(x));
    let title = "", big = "", sub = "", tiles = "", opt = {};
    if (kind === "battery") {
      const soc = num(c.battery), flow = num(c.battery_power);
      title = "Battery"; opt = { min: 0, max: 100, color: "#7fd6c2" };
      big = `${soc != null ? Math.round(soc) : "–"}<small>%</small>`;
      sub = flow != null && flow < -30 ? `charging at ${Math.abs(Math.round(flow))} W` : flow != null && flow > 30 ? `discharging at ${Math.round(flow)} W` : "resting";
      tiles = tile("Lowest", st ? `${Math.round(st.min)}<small>%</small>` : "–", st ? "at " + st.minAt : "")
        + tile("Highest", st ? `${Math.round(st.max)}<small>%</small>` : "–", st ? "at " + st.maxAt : "")
        + tile("Charged today", kwh(c.battery_charge_today), "into the battery")
        + tile("Discharged today", kwh(c.battery_discharge_today), "out of the battery");
    } else if (kind === "grid") {
      const net = (num(c.grid_from) ?? 0) - (num(c.grid_to) ?? 0);
      title = "Grid"; opt = { color: "#8ab4ff" };
      big = this._kw(net);
      sub = net > 30 ? "importing now" : net < -30 ? "exporting now" : "idle";
      const cost = this._entity(c.grid_cost), unit = cost?.attributes?.unit_of_measurement;
      const money = Number.isFinite(Number(cost?.state)) ? `${unit === "ZAR" ? "R" : ""}${Number(cost.state).toFixed(2)}` : "–";
      tiles = tile("Imported today", kwh(c.grid_today_kwh), "from the grid")
        + tile("Exported today", kwh(c.grid_export_today_kwh), "to the grid")
        + tile("Cost today", esc(money), "so far")
        + tile("Peak", st ? w(Math.max(0, st.max)) : "–", st ? "at " + st.maxAt : "");
    } else {
      const flow = num(c.battery_power);
      const home = flow == null ? null : Math.max(0, (num(c.grid_from) ?? 0) - (num(c.grid_to) ?? 0) + flow + (num(c.pv_power) ?? 0));
      title = "Home"; opt = { color: "#ffc857" };
      big = home != null ? this._kw(home) : "–";
      sub = "using right now";
      tiles = tile("Peak", st ? w(st.max) : "–", st ? "at " + st.maxAt : "")
        + tile("Average", st ? w(st.avg) : "–", `over ${hours} h`)
        + tile("Lowest", st ? w(st.min) : "–", st ? "at " + st.minAt : "")
        + tile("Geyser", this._geyserState().heating ? this._kw(this._geyserState().watts) : "Off", "right now");
    }
    return `<div class="sheet-bg full" data-act="noop"><div class="sheet wide" data-act="noop">
      <div class="dhead"><button class="back" data-act="pd_back">\u2039 Power</button><h2>${title}</h2>
        <div class="rng"><button class="${hours === 6 ? "sel" : ""}" data-act="pr_6">6 h</button><button class="${hours === 24 ? "sel" : ""}" data-act="pr_24">24 h</button></div></div>
      <div class="dbig">${big}<small>${esc(sub)}</small></div>
      ${ser ? this._graphHtml(ser, opt) : '<div class="gload">Loading history…</div>'}
      <div class="sgrid">${tiles}</div></div></div>`;
  }

  _geyserSheetHtml() {
    const g = this._geyserState();
    const timer = this._entity(this._config.geyser_timer);
    const dur = String(timer?.attributes?.duration || "1:00:00").split(":");
    const mins = Number(dur[0]) * 60 + Number(dur[1]);
    const durText = mins >= 60 && mins % 60 === 0 ? `${mins / 60} hour${mins === 60 ? "" : "s"}` : `${mins} min`;
    const status = g.heating ? `Heating, ${(g.watts / 1000).toFixed(1)} kW` : g.on ? "On, not heating" : "Off";
    return `<div class="sheet-bg" data-act="g_close"><div class="sheet" data-act="noop">
      <h2>Geyser</h2><div class="sstate">${esc(status)}${g.left ? " · " + esc(g.left) : ""}</div>
      <div class="srow">
        <button class="sbtn ${g.on ? "on" : ""}" data-act="g_on">On</button>
        <button class="sbtn ${!g.on ? "sel" : ""}" data-act="g_off">Off</button>
      </div>
      ${g.hasTimer ? `<div class="srow">${g.timerActive
        ? `<button class="sbtn" data-act="g_cancel">Cancel timer</button>`
        : `<button class="sbtn" data-act="g_timer">Heat for ${esc(durText)}</button>`}</div>` : ""}
      <div class="sclose">tap outside to close</div></div></div>`;
  }

  // A faint way back to the home page from the music and movies screens.
  _homeBtnHtml(scene) {
    const style = this._config.home_button;
    if (style === false || style === "off" || !["music", "browsing"].includes(scene)) return "";
    const house = '<svg viewBox="0 0 24 24"><path d="M12 3 2 12h3v8h5v-6h4v6h5v-8h3z"/></svg>';
    return style === "pill"
      ? `<button class="homebtn pill" data-act="nav_home" aria-label="Home">${house}Home</button>`
      : `<button class="homebtn" data-act="nav_home" aria-label="Home">${house}</button>`;
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
    const icon = src.state === "playing"
      ? '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
    const next = '<svg viewBox="0 0 24 24"><path d="M6 5l9 7-9 7zM17 5h2v14h-2z"/></svg>';
    const btns = `${ctl.playPause ? `<button class="ctl" data-act="playpause" data-ent="${id}">${icon}</button>` : ""}${live && ctl.next ? `<button class="ctl" data-act="next" data-ent="${id}">${next}</button>` : ""}`;
    this._miniArt = art;
    if (art) this._fetchArt(art);
    const known = art ? this._artBlobs[art] : undefined;
    const bg = art ? `style="background-image:url(${esc(JSON.stringify(known || art))})"` : "";
    const style = c.mini_style || "tile";
    const title = live ? (a.media_title || "Playing") : "Nothing playing";
    const artist = live ? (a.media_artist || "") : "";
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
      <div class="mtitle">${esc(live ? (a.media_title || "Playing") : "Nothing playing")}</div>
      <div class="mart-sub">${esc(live ? (a.media_artist || "") : "")}</div>
      <div class="mbtns">${btns}</div></div></div>` };
  }

  _nowPlaying(source, now, kind, jf = null) {
    const a = source?.attributes || {};
    const isMusic = kind === "music";
    const art = isMusic && source && source.state !== "playing" && source.state !== "paused" ? "" : this._artUrl(source);
    const facts = jf ? jellyfinFacts(jf) : null;
    const idleMusic = isMusic && source && source.state !== "playing" && source.state !== "paused";
    const title = jf ? jf.title : idleMusic ? "Nothing playing" : (a.media_title || (isMusic ? "Playing" : (a.app_name || "Apple TV")));
    const sub = idleMusic ? "" : facts
      ? facts.line
      : (isMusic
        ? (a.media_artist || "")
        : (a.media_series_title || a.media_artist || a.app_name || ""));
    // Skip the album line when it only repeats the artist or the title.
    const album = isMusic && !idleMusic && !sameText(a.media_album_name, a.media_artist) && !sameText(a.media_album_name, a.media_title)
      ? (a.media_album_name || "") : "";
    const where = isMusic ? (source?.attributes?.friendly_name || "") : (a.app_name || "");
    const dur = Number(a.media_duration);
    let pos = Number(a.media_position);
    if (Number.isFinite(pos) && source?.state === "playing" && a.media_position_updated_at) {
      pos += (now.getTime() - new Date(a.media_position_updated_at).getTime()) / 1000;
    }
    const showBar = !idleMusic && Number.isFinite(dur) && dur > 0 && Number.isFinite(pos);
    const pct = showBar ? Math.max(0, Math.min(100, (pos / dur) * 100)) : 0;
    const kicker = isMusic ? (source?.state === "paused" ? "Paused" : source?.state === "playing" ? "Now playing" : "Music") : (source?.state === "paused" ? "Paused" : (a.app_name || "Apple TV"));
    const shape = !art ? "none" : (this._shapes[art] || (isMusic ? "square" : "poster"));
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
    const bar = Number.isFinite(pct) && pct > 0
      ? `<div class="progress"><div class="bar"><i style="width:${Math.min(100, pct)}%"></i></div><div class="times"><span>${Math.round(pct)}% watched</span></div></div>`
      : "";
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
    const btn = (act, icon, cls = "", label = "") =>
      `<button class="ctl ${cls}" data-act="${act}" data-ent="${id}" aria-label="${act}">${icon}${label}</button>`;
    const ICON = {
      play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
      pause: '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
      next: '<svg viewBox="0 0 24 24"><path d="M6 5l9 7-9 7zM17 5h2v14h-2z"/></svg>',
      prev: '<svg viewBox="0 0 24 24"><path d="M18 5l-9 7 9 7zM5 5h2v14H5z"/></svg>',
      minus: '<svg viewBox="0 0 24 24"><path d="M5 11h14v2H5z"/></svg>',
      plus: '<svg viewBox="0 0 24 24"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>',
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
    // Paused info screen: one button to carry on watching.
    if (source.state === "paused" && c.playPause) {
      return `<div class="controls">${btn("playpause", ICON.play, "wide", "Resume")}</div>`;
    }
    return "";
  }

  _onTap(e) {
    const el = e.target.closest && e.target.closest("[data-act]");
    if (!el || !this._hass) return;
    const now = Date.now();
    if (now - (this._lastTap || 0) < 350) return; // ignore a double-tap / bounce
    this._lastTap = now;
    this._touchNav();
    const act = el.dataset.act;
    if (act === "noop") return;
    if (act === "geyser") return this._openSheet("geyser");
    if (act === "power") return this._openSheet("power");
    if (act.indexOf("pd_") === 0) {
      this._sheet = act === "pd_back" ? "power" : "power:" + act.slice(3);
      this._armSheet(60000);
      return this._syncSheet();
    }
    if (act.indexOf("pr_") === 0) { this._range = Number(act.slice(3)); this._armSheet(60000); return this._syncSheet(); }
    if (act === "g_close") return this._closeSheet();
    if (act.startsWith("g_")) return this._geyserAction(act);
    if (act === "nav_home") {
      const base = this._sceneState.scene;
      this._manual = base === "day" || base === "morning" || base === "away" ? null
        : { scene: "day", base, until: Date.now() + Number(this._config.nav_return_minutes) * 60000 };
      this._renderedKey = null;
      return this._tick();
    }
    if (act === "open_music") {
      this._manual = { scene: "music", base: this._sceneState.scene,
        until: Date.now() + Number(this._config.nav_return_minutes) * 60000 };
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
    this._sheetTimer = setTimeout(() => this._closeSheet(), name === "power" ? 60000 : 30000);
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
    if (!this._sheet) { if (cur) cur.remove(); this._sheetHtmlLast = null; return; }
    const html = this._sheetHtml();
    if (cur && this._sheetHtmlLast === html) return;
    this._sheetHtmlLast = html;
    const holder = document.createElement("div");
    holder.innerHTML = html;
    const fresh = holder.firstElementChild;
    if (cur) { fresh.style.animation = "none"; cur.replaceWith(fresh); } else this._stage.appendChild(fresh);
  }

  // Uses the geyser's existing HA pieces: script.toggle_geyser (which also
  // verifies the state) and the existing timer, whose own automations switch
  // the geyser on when it starts and off when it finishes.
  _geyserAction(act) {
    const c = this._config;
    const svc = (d, s, data) => this._hass.callService(d, s, data);
    const script = (state) => svc("script", "toggle_geyser", { target_state: state });
    clearTimeout(this._sheetTimer);
    this._sheetTimer = setTimeout(() => this._closeSheet(), 30000);
    const timerOn = this._entity(c.geyser_timer)?.state === "active";
    if (act === "g_on") script("on");
    else if (act === "g_off") { if (timerOn) svc("timer", "cancel", { entity_id: c.geyser_timer }); script("off"); }
    else if (act === "g_timer") svc("timer", "start", { entity_id: c.geyser_timer });
    else if (act === "g_cancel") { svc("timer", "cancel", { entity_id: c.geyser_timer }); script("off"); }
    setTimeout(() => this._syncSheet(), 1500);
  }
}

customElements.define("wall-panel-card", WallPanelCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "wall-panel-card",
  name: "Wall Panel",
  description: "Full-screen, scene-driven wall display: cinema, music, browsing, sleep, away, morning, day.",
});
