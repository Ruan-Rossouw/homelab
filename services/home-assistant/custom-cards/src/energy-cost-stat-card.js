// Energy Cost Stat Card
//
// A single-number tile — current total, projected total, highest,
// lowest, or average per-bucket cost over whatever period the Energy
// dashboard's date-picker currently has selected. One config-driven card
// (`stat: "total" | "highest" | "lowest" | "average"`) rather than four
// near-identical files, per ../CLAUDE.md "Minimizing duplication" — the
// user only needs one Lovelace resource (one ?v=N) and four short YAML
// entries to get all four tiles.
//
// Split out of energy-cost-card.js, which used to show "total" and
// "projected" inline in its own header — the user asked for these (plus
// highest/lowest/average, never shown anywhere before) as separate
// small tile-style cards instead, so each can be arranged/sized
// independently in the dashboard grid.
//
// Architecturally this is NOT the same kind of thing as the breakdown
// card's removed average stat (see the commit that removed it,
// 29a576d): that was about backing a value with a real HA *entity*
// synced to the live date-picker, which is impossible (the date-picker's
// selection lives only in the browser's hass.connection memory, no
// entity can read it). This card computes its number the same way every
// other card in this directory does — from data the shared
// energy-date-selection collection already provides — and just displays
// it, live, same page, same session. No entity involved, no problem.
//
// This file is compiled by esbuild (see ../package.json) — edit this
// source, not the generated ../energy-cost-stat-card.js.

import { attachToEnergyCollection } from "./lib/energy-collection.js";
import { discoverGridCostStatIds, sumCostByBucket } from "./lib/energy-cost-sources.js";
import { buildRunningTotalSeries, computeProjection } from "./lib/energy-cost-projection.js";
import { formatCurrency, formatTimeForSpan, haStyleTimeTiers } from "./lib/format.js";
import { observeChartResize } from "./lib/svg-chart.js";

// mdi path data, verbatim from @mdi/svg (unpkg.com/@mdi/svg@7.4.47/svg/),
// fetched and inlined the same way energy-cost-card.js's legend icons
// were — no ha-svg-icon/@mdi/js dependency, consistent with this
// codebase's hand-rolled, dependency-free approach.
const ICONS = {
  total: "M5,6H23V18H5V6M14,9A3,3 0 0,1 17,12A3,3 0 0,1 14,15A3,3 0 0,1 11,12A3,3 0 0,1 14,9M9,8A2,2 0 0,1 7,10V14A2,2 0 0,1 9,16H19A2,2 0 0,1 21,14V10A2,2 0 0,1 19,8H9M1,10H3V20H19V22H1V10Z",
  highest: "M16,6L18.29,8.29L13.41,13.17L9.41,9.17L2,16.59L3.41,18L9.41,12L13.41,16L19.71,9.71L22,12V6H16Z",
  lowest: "M16,18L18.29,15.71L13.41,10.83L9.41,14.83L2,7.41L3.41,6L9.41,12L13.41,8L19.71,14.29L22,12V18H16Z",
  average: "M16,11.78L20.24,4.45L21.97,5.45L16.74,14.5L10.23,10.75L5.46,19H22V21H2V3H4V17.54L9.5,8L16,11.78Z",
  // arrow-expand-vertical, from Templarian/MaterialDesign (the same @mdi
  // icon set the others above were pulled from) — a combined highest+lowest
  // tile reads as a "range", not a single trend direction, so neither the
  // highest nor lowest arrow alone fits.
  range: "M13,9V15H16L12,19L8,15H11V9H8L12,5L16,9H13M4,2H20V4H4V2M4,20H20V22H4V20Z",
};

const DEFAULT_LABELS = {
  total: "Grid Cost",
  highest: "Highest",
  lowest: "Lowest",
  average: "Average",
  range: "Highest / Lowest",
};

const STATS = ["total", "highest", "lowest", "average", "range"];

// Fixed strip height for the sparkline feature row — small enough to stay
// a "feature," not a second chart. See _renderSparkline's comment for why
// this exists at all.
const SPARKLINE_HEIGHT = 28;

// Card-shell.js's shared CHART_CARD_STYLES targets the chart cards'
// header/total/tooltip/legend rules, none of which this card uses — its
// layout (icon + primary/secondary info row) is a different shape, so it
// gets its own small stylesheet instead of importing that one. Sizing
// verified against real HA source: components/tile/ha-tile-icon.ts
// (--tile-icon-size: 36px, --mdc-icon-size: 24px, a 0.2-opacity colored
// circle behind a solid-colored icon) and ha-tile-info.ts (primary:
// --ha-font-size-m/font-weight-medium, secondary: --ha-font-size-s/
// font-weight-normal, both color: --primary-text-color — HA's real
// tile-info spec keeps the secondary line the *primary* text color, not
// --secondary-text-color, so matched that rather than "fixing" it to
// what might look more expected). Row layout (icon left, info right,
// 10px gap) from components/tile/ha-tile-container.ts's `.content` rule.
//
// .primary's size is a deliberate deviation from that verified HA spec,
// not a correction to it: the user asked for the number itself, "the
// most valuable part of the card," to read bigger than HA's literal
// --ha-font-size-m. Bumped one step up HA's own font-size scale
// (--ha-font-size-l) rather than inventing an arbitrary px value.
//
// .sparkline: the empty space a bare icon+info tile leaves when it has no
// configured "feature" row is real HA behavior, not a bug in the CSS
// above (confirmed against ha-tile-container.ts/hui-tile-card.ts — a
// feature-less tile's own default grid size, columns: 6, is wider than
// this card's). HA fills that space with a feature (mini-graph/bar/
// buttons); this is that same real mechanism, not an invented one.
const STAT_CARD_STYLES = `
  :host { display: flex; height: 100%; }
  ha-card {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 16px;
    min-height: 0;
  }
  .header {
    font-size: 1rem;
    font-weight: 500;
    color: var(--primary-text-color);
    margin-bottom: 8px;
    flex: none;
  }
  .row {
    flex: 1;
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .icon-circle {
    position: relative;
    flex: none;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .icon-circle::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: var(--tile-color, var(--state-icon-color, var(--primary-color)));
    opacity: 0.2;
  }
  .icon-circle svg {
    position: relative;
    width: 24px;
    height: 24px;
    color: var(--tile-color, var(--state-icon-color, var(--primary-color)));
  }
  .info {
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .primary {
    font-size: var(--ha-font-size-l, 16px);
    font-weight: var(--ha-font-weight-medium, 500);
    line-height: 1.4;
    color: var(--primary-text-color);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .secondary {
    font-size: var(--ha-font-size-s, 12px);
    font-weight: var(--ha-font-weight-normal, 400);
    line-height: 1.4;
    color: var(--primary-text-color);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .secondary[hidden] { display: none; }
  .sparkline {
    flex: none;
    margin-top: 8px;
    height: ${SPARKLINE_HEIGHT}px;
  }
  .sparkline[hidden] { display: none; }
  .sparkline svg {
    display: block;
    width: 100%;
    height: ${SPARKLINE_HEIGHT}px;
  }
  .message {
    color: var(--secondary-text-color);
    font-size: 0.9rem;
  }
`;

class EnergyCostStatCard extends HTMLElement {
  setConfig(config) {
    this._config = config || {};
    if (!STATS.includes(this._config.stat)) {
      throw new Error(`energy-cost-stat-card: "stat" must be one of ${STATS.join(", ")}`);
    }

    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.innerHTML = `
        <style>${STAT_CARD_STYLES}</style>
        <ha-card>
          <div class="header"></div>
          <div class="row">
            <div class="icon-circle">
              <svg viewBox="0 0 24 24"><path fill="currentColor" d="${ICONS[this._config.stat]}"></path></svg>
            </div>
            <div class="info">
              <div class="primary"></div>
              <div class="secondary" hidden></div>
            </div>
          </div>
          <div class="sparkline" hidden></div>
        </ha-card>
      `;
    }

    const firstRender = !this._sparklineEl;

    this._headerEl = this.shadowRoot.querySelector(".header");
    this._primaryEl = this.shadowRoot.querySelector(".primary");
    this._secondaryEl = this.shadowRoot.querySelector(".secondary");
    this._sparklineEl = this.shadowRoot.querySelector(".sparkline");

    if (firstRender) {
      this._resizeObserver = observeChartResize(this._sparklineEl, () => {
        this._renderSparkline(this._sparklinePoints);
      });
    }
    // Matches every other card in this directory: no title unless the
    // user explicitly configures one (see energy-cost-card.js's own
    // header-removal commit for the HA source this was verified
    // against — hui-energy-usage-graph-card.ts only renders a header
    // when .title is set, no default fallback string).
    this._headerEl.hidden = !this._config.title;
    this._headerEl.textContent = this._config.title || "";

    this._attachToCollection();
  }

  set hass(hass) {
    this._hass = hass;
    this._attachToCollection();
  }

  connectedCallback() {
    this._connected = true;
    this._attachToCollection();
  }

  disconnectedCallback() {
    this._connected = false;
    if (this._unsub) {
      this._unsub();
      this._unsub = undefined;
    }
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
    }
  }

  getCardSize() {
    return 2;
  }

  // Shrunk from the original grid_columns: 3 default now that the
  // sparkline feature row gives a tile a real reason to fill whatever
  // width it's given — the old wider default was compensating for empty
  // space that a feature row now fills on its own. grid_rows bumped 1->2
  // for the same reason: the sparkline is real added vertical content,
  // not free. (The user has already independently landed on rows: 2 via
  // their own grid_options override, which matches.)
  getLayoutOptions() {
    return {
      grid_columns: 2,
      grid_rows: 2,
      grid_min_columns: 2,
    };
  }

  _attachToCollection() {
    if (!this._hass || !this._connected || this._unsub) {
      return;
    }

    this._unsub = attachToEnergyCollection(
      this._hass,
      this._config,
      (data) => this._update(data),
      () => {
        this._primaryEl.textContent = "";
        this._secondaryEl.hidden = false;
        this._secondaryEl.textContent = "Waiting for an Energy date-selection card…";
        this._renderSparkline(null);
      }
    );
  }

  async _update(data) {
    const prefs = data.prefs;
    const stats = data.stats;

    const costStatIds = await discoverGridCostStatIds(this._hass, prefs);
    if (!costStatIds.length) {
      this._primaryEl.textContent = "";
      this._secondaryEl.hidden = false;
      this._secondaryEl.textContent = "No grid cost tracking configured";
      this._renderSparkline(null);
      return;
    }

    const deltaByBucketStart = sumCostByBucket(stats, costStatIds);

    if (this._config.stat === "total") {
      this._updateTotal(data, deltaByBucketStart);
      return;
    }

    // Real buckets only, unpadded — sumCostByBucket already only returns
    // buckets with a real (non-null) change, so no separate exclusion
    // step is needed here for "not-yet-happened" placeholder buckets:
    // unlike the chart cards, this card never adds any (that padding was
    // purely to make a chart visually span the full period; a plain
    // number has no such need). Same real-buckets-only set the old,
    // removed breakdown-card average used (captured before its own
    // tail-padding step) — see 29a576d.
    const entries = [...deltaByBucketStart.entries()]; // [bucketStartMs, cost][]
    if (!entries.length) {
      this._primaryEl.textContent = "";
      this._secondaryEl.hidden = false;
      this._secondaryEl.textContent = "No data yet for this period";
      this._renderSparkline(null);
      return;
    }

    // Same underlying per-bucket trend backs the sparkline regardless of
    // which of average/highest/lowest/range this tile highlights — it's
    // period context, not specific to one stat. Sorted chronologically:
    // entries' insertion order isn't guaranteed to be ascending (it's
    // whatever order the WS response's stats came back in), but a
    // sparkline reads left-to-right as time.
    const sortedPoints = entries
      .slice()
      .sort((a, b) => a[0] - b[0])
      .map(([x, y]) => ({ x, y }));
    this._renderSparkline(sortedPoints);

    if (this._config.stat === "average") {
      const values = entries.map(([, v]) => v);
      const value = values.reduce((sum, v) => sum + v, 0) / values.length;
      this._primaryEl.textContent = this._formatCurrency(value);
      this._secondaryEl.hidden = !!this._config.title;
      this._secondaryEl.textContent = this._config.title ? "" : DEFAULT_LABELS.average;
      return;
    }

    // Track which bucket produced the extreme value, not just the value
    // itself — a bare "R 46.57" with no indication of *when* isn't
    // actionable. reduce() rather than Math.max/min(...values) since we
    // need the whole [x, y] pair, not just y.
    const maxEntry = entries.reduce((best, e) => (e[1] > best[1] ? e : best));
    const minEntry = entries.reduce((best, e) => (e[1] < best[1] ? e : best));

    if (this._config.stat === "highest" || this._config.stat === "lowest") {
      const [x, y] = this._config.stat === "highest" ? maxEntry : minEntry;
      const dateStr = this._formatBucketDate(x, data);
      this._primaryEl.textContent = this._formatCurrency(y);
      // Unlike average/total, the secondary line here carries real
      // information (when this happened), not just a redundant repeat of
      // the stat's name — so it stays visible even when a title is set,
      // dropping only the now-redundant label prefix.
      this._secondaryEl.hidden = false;
      this._secondaryEl.textContent = this._config.title
        ? dateStr
        : `${DEFAULT_LABELS[this._config.stat]} · ${dateStr}`;
      return;
    }

    // "range": both extremes in one tile, per the user's own suggestion to
    // merge the highest/lowest cards rather than needing two side by side.
    // Additive, not a replacement — "highest"/"lowest" above still work
    // standalone for anyone who'd rather keep them separate.
    const maxDateStr = this._formatBucketDate(maxEntry[0], data);
    const minDateStr = this._formatBucketDate(minEntry[0], data);
    // Lowest first, then highest — reads as an ascending range rather than
    // a "biggest number first" framing, per the user's own preference.
    // Extra spacing around the dash (vs. a single space either side) gives
    // the two values visual breathing room instead of reading as one
    // cramped run of text.
    this._primaryEl.textContent = `${this._formatCurrency(minEntry[1])}   –   ${this._formatCurrency(maxEntry[1])}`;
    this._secondaryEl.hidden = false;
    this._secondaryEl.textContent = `Lowest ${minDateStr} · Highest ${maxDateStr}`;
  }

  // Same date-formatting cascade the chart cards' axis labels use (a real
  // port of HA's own formatTimeLabel(), see format.js), driven by the
  // currently selected period's span so a "Today" view reads as an hour
  // and a "This year" view reads as a month, matching how the charts
  // already format the same kind of timestamp elsewhere on the dashboard.
  _formatBucketDate(timestampMs, data) {
    const locale = this._hass?.locale?.language;
    const spanMs = data.start && data.end ? data.end.getTime() - data.start.getTime() : 0;
    return formatTimeForSpan(timestampMs, locale, spanMs, haStyleTimeTiers());
  }

  // Same running-total + projection math energy-cost-card.js's chart
  // uses internally (see lib/energy-cost-projection.js) — this mode is
  // the direct replacement for what used to be that card's own header.
  _updateTotal(data, deltaByBucketStart) {
    const { series, runningTotal } = buildRunningTotalSeries(deltaByBucketStart);
    this._primaryEl.textContent = this._formatCurrency(runningTotal);
    // "total" shows the cumulative bill-so-far curve rather than the
    // discrete per-bucket costs the other stats' sparklines show — matches
    // this tile's own identity (a running total) and the shape of the
    // full "Grid Cost" line chart elsewhere on the dashboard, rather than
    // the breakdown bar chart's shape.
    this._renderSparkline(series);

    const projection = computeProjection(data, series, runningTotal);
    // Only meaningful as a forward-looking estimate — for an
    // already-elapsed period, projection.total *is* runningTotal, so a
    // "Projected: R X" line under the identical "R X" primary would just
    // be a redundant duplicate (same reasoning energy-cost-card.js's
    // header used before this was split out).
    if (projection && projection.isEstimate) {
      this._secondaryEl.hidden = false;
      this._secondaryEl.textContent = `Projected: ${this._formatCurrency(projection.total)}`;
    } else {
      this._secondaryEl.hidden = true;
    }
  }

  // Renders (or hides) the sparkline feature row. Not svg-chart.js's full
  // chart machinery — no axes, no gridlines, no tooltip, no zoom, a
  // strip this small has none of that, just a scaled line+fill in the
  // tile's own icon color. viewBox width is set to the container's real
  // measured clientWidth (not an arbitrary fixed coordinate count) so
  // preserveAspectRatio="none" doesn't distort — same 1:1-with-CSS-pixels
  // principle CLAUDE.md documents for the full chart cards, just without
  // needing the height half of that (height is a fixed constant here,
  // there's no text/glyphs in a sparkline to distort).
  //
  // points: [{x, y}, ...] sorted ascending by x, or null/short to hide.
  _renderSparkline(points) {
    this._sparklinePoints = points;
    if (!this._sparklineEl) return;

    // A single bucket (e.g. day 1 of a new period) has no trend to draw —
    // hide rather than render a degenerate flat/1-point line.
    if (!points || points.length < 2) {
      this._sparklineEl.hidden = true;
      this._sparklineEl.innerHTML = "";
      return;
    }

    this._sparklineEl.hidden = false;
    const width = this._sparklineEl.clientWidth || 100;
    const height = SPARKLINE_HEIGHT;

    const ys = points.map((p) => p.y);
    const minY = Math.min(0, ...ys);
    const maxY = Math.max(...ys, minY + 0.0001);
    const scaleX = (i) => (i / (points.length - 1)) * width;
    const scaleY = (y) => height - ((y - minY) / (maxY - minY)) * height;

    const linePoints = points.map((p, i) => `${scaleX(i).toFixed(1)},${scaleY(p.y).toFixed(1)}`).join(" ");
    const areaPoints = `0,${height.toFixed(1)} ${linePoints} ${width.toFixed(1)},${height.toFixed(1)}`;
    const color = "var(--tile-color, var(--state-icon-color, var(--primary-color)))";

    this._sparklineEl.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
        <polygon points="${areaPoints}" fill="${color}" opacity="0.2"></polygon>
        <polyline points="${linePoints}" fill="none" stroke="${color}" stroke-width="1.5"></polyline>
      </svg>
    `;
  }

  _formatCurrency(value) {
    return formatCurrency(value, {
      symbol: this._config.currency_symbol || "R",
      locale: this._hass?.locale?.language,
    });
  }
}

customElements.define("energy-cost-stat-card", EnergyCostStatCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "energy-cost-stat-card",
  name: "Energy Cost Stat",
  description:
    "A grid-cost number (current total + projected, highest, lowest, average per bucket, or highest+lowest combined) for the Energy dashboard's currently selected period. Set `stat:` to total, highest, lowest, average, or range.",
});
