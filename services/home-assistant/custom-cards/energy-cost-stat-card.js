(() => {
  // src/lib/energy-collection.js
  function collectionKey(config, hass) {
    const configuredKey = config.collection_key;
    if (configuredKey) {
      return `_${configuredKey}`;
    }
    if (hass?.panelUrl) {
      return `_energy_${hass.panelUrl}`;
    }
    return "_energy";
  }
  function attachToEnergyCollection(hass, config, onData, onWaiting) {
    const key = collectionKey(config, hass);
    const collection = hass.connection[key];
    if (!collection) {
      onWaiting();
      return void 0;
    }
    return collection.subscribe(onData);
  }

  // src/lib/energy-cost-sources.js
  async function discoverGridCostStatIds(hass, prefs) {
    const info = await hass.callWS({ type: "energy/info" });
    const costSensors = info.cost_sensors || {};
    return (prefs.energy_sources || []).filter((source) => source.type === "grid").map((source) => source.stat_cost || costSensors[source.stat_energy_from]).filter(Boolean);
  }
  function sumCostByBucket(stats, costStatIds) {
    const byBucketStart = /* @__PURE__ */ new Map();
    for (const statId of costStatIds) {
      for (const point of stats[statId] || []) {
        if (point.change == null) continue;
        byBucketStart.set(point.start, (byBucketStart.get(point.start) || 0) + point.change);
      }
    }
    return byBucketStart;
  }

  // src/lib/energy-cost-projection.js
  function buildRunningTotalSeries(deltaByBucketStart) {
    const bucketStarts = [...deltaByBucketStart.keys()].sort((a, b) => a - b);
    let runningTotal = 0;
    const series = bucketStarts.map((start) => {
      runningTotal += deltaByBucketStart.get(start);
      return { x: start, y: runningTotal };
    });
    return { series, runningTotal };
  }
  function computeProjection(data, series, runningTotal) {
    if (series.length < 2 || !data.start || !data.end) {
      return null;
    }
    const periodStartMs = data.start.getTime();
    const periodEndMs = data.end.getTime();
    const nowMs = Date.now();
    if (nowMs >= periodEndMs) {
      return { endMs: periodEndMs, total: runningTotal, isEstimate: false };
    }
    const elapsedMs = nowMs - periodStartMs;
    const remainingMs = periodEndMs - nowMs;
    if (elapsedMs <= 0) {
      return null;
    }
    const rate = runningTotal / elapsedMs;
    const total = runningTotal + rate * remainingMs;
    return { endMs: periodEndMs, total, isEstimate: true };
  }

  // src/lib/format.js
  function formatCurrency(value, { symbol = "R", locale, compact = false } = {}) {
    const forceDecimal = compact && Math.abs(value) >= 1e3;
    let number;
    try {
      number = new Intl.NumberFormat(locale, {
        notation: compact ? "compact" : "standard",
        maximumFractionDigits: compact ? 1 : 2,
        minimumFractionDigits: forceDecimal ? 1 : compact ? 0 : 2
      }).format(value);
    } catch {
      number = value.toFixed(compact ? 0 : 2);
    }
    return symbol ? `${symbol} ${number}` : number;
  }
  var DAY_MS = 24 * 60 * 60 * 1e3;

  // src/energy-cost-stat-card.js
  var ICONS = {
    total: "M5,6H23V18H5V6M14,9A3,3 0 0,1 17,12A3,3 0 0,1 14,15A3,3 0 0,1 11,12A3,3 0 0,1 14,9M9,8A2,2 0 0,1 7,10V14A2,2 0 0,1 9,16H19A2,2 0 0,1 21,14V10A2,2 0 0,1 19,8H9M1,10H3V20H19V22H1V10Z",
    highest: "M16,6L18.29,8.29L13.41,13.17L9.41,9.17L2,16.59L3.41,18L9.41,12L13.41,16L19.71,9.71L22,12V6H16Z",
    lowest: "M16,18L18.29,15.71L13.41,10.83L9.41,14.83L2,7.41L3.41,6L9.41,12L13.41,8L19.71,14.29L22,12V18H16Z",
    average: "M16,11.78L20.24,4.45L21.97,5.45L16.74,14.5L10.23,10.75L5.46,19H22V21H2V3H4V17.54L9.5,8L16,11.78Z"
  };
  var DEFAULT_LABELS = {
    total: "Grid Cost",
    highest: "Highest",
    lowest: "Lowest",
    average: "Average"
  };
  var STAT_CARD_STYLES = `
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
  var EnergyCostStatCard = class extends HTMLElement {
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
        this._unsub = void 0;
      }
    }
    getCardSize() {
      return 1;
    }
    getLayoutOptions() {
      return {
        grid_columns: 3,
        grid_rows: 1,
        grid_min_columns: 2
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
          this._secondaryEl.textContent = "Waiting for an Energy date-selection card\u2026";
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
        locale: this._hass?.locale?.language
      });
    }
  };
  customElements.define("energy-cost-stat-card", EnergyCostStatCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "energy-cost-stat-card",
    name: "Energy Cost Stat",
    description: "A single grid-cost number (current total, projected, highest, lowest, or average per bucket) for the Energy dashboard's currently selected period. Set `stat:` to total, highest, lowest, or average."
  });
})();
