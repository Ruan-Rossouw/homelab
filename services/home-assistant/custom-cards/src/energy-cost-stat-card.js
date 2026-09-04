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
import { formatCurrency } from "./lib/format.js";

// mdi path data, verbatim from @mdi/svg (unpkg.com/@mdi/svg@7.4.47/svg/),
// fetched and inlined the same way energy-cost-card.js's legend icons
// were — no ha-svg-icon/@mdi/js dependency, consistent with this
// codebase's hand-rolled, dependency-free approach.
const ICONS = {
  total: "M5,6H23V18H5V6M14,9A3,3 0 0,1 17,12A3,3 0 0,1 14,15A3,3 0 0,1 11,12A3,3 0 0,1 14,9M9,8A2,2 0 0,1 7,10V14A2,2 0 0,1 9,16H19A2,2 0 0,1 21,14V10A2,2 0 0,1 19,8H9M1,10H3V20H19V22H1V10Z",
  highest: "M16,6L18.29,8.29L13.41,13.17L9.41,9.17L2,16.59L3.41,18L9.41,12L13.41,16L19.71,9.71L22,12V6H16Z",
  lowest: "M16,18L18.29,15.71L13.41,10.83L9.41,14.83L2,7.41L3.41,6L9.41,12L13.41,8L19.71,14.29L22,12V18H16Z",
  average: "M16,11.78L20.24,4.45L21.97,5.45L16.74,14.5L10.23,10.75L5.46,19H22V21H2V3H4V17.54L9.5,8L16,11.78Z",
};

const DEFAULT_LABELS = {
  total: "Grid Cost",
  highest: "Highest",
  lowest: "Lowest",
  average: "Average",
};

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
    font-size: var(--ha-font-size-m, 14px);
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
  .message {
    color: var(--secondary-text-color);
    font-size: 0.9rem;
  }
`;

class EnergyCostStatCard extends HTMLElement {
  setConfig(config) {
    this._config = config || {};
    if (!["total", "highest", "lowest", "average"].includes(this._config.stat)) {
      throw new Error('energy-cost-stat-card: "stat" must be one of total, highest, lowest, average');
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
        </ha-card>
      `;
    }

    this._headerEl = this.shadowRoot.querySelector(".header");
    this._primaryEl = this.shadowRoot.querySelector(".primary");
    this._secondaryEl = this.shadowRoot.querySelector(".secondary");
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
  }

  getCardSize() {
    return 1;
  }

  getLayoutOptions() {
    return {
      grid_columns: 3,
      grid_rows: 1,
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
    const values = [...deltaByBucketStart.values()];
    if (!values.length) {
      this._primaryEl.textContent = "";
      this._secondaryEl.hidden = false;
      this._secondaryEl.textContent = "No data yet for this period";
      return;
    }

    let value;
    if (this._config.stat === "highest") {
      value = Math.max(...values);
    } else if (this._config.stat === "lowest") {
      value = Math.min(...values);
    } else {
      value = values.reduce((sum, v) => sum + v, 0) / values.length;
    }

    this._primaryEl.textContent = this._formatCurrency(value);
    this._secondaryEl.hidden = !!this._config.title;
    this._secondaryEl.textContent = this._config.title ? "" : DEFAULT_LABELS[this._config.stat];
  }

  // Same running-total + projection math energy-cost-card.js's chart
  // uses internally (see lib/energy-cost-projection.js) — this mode is
  // the direct replacement for what used to be that card's own header.
  _updateTotal(data, deltaByBucketStart) {
    const { series, runningTotal } = buildRunningTotalSeries(deltaByBucketStart);
    this._primaryEl.textContent = this._formatCurrency(runningTotal);

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
    "A single grid-cost number (current total, projected, highest, lowest, or average per bucket) for the Energy dashboard's currently selected period. Set `stat:` to total, highest, lowest, or average.",
});
