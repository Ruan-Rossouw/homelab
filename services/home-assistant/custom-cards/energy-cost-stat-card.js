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
  function formatTimeForSpan(timestamp, locale, spanMs, tiers) {
    const date = new Date(timestamp);
    const tier = tiers.find((t) => t.maxSpanMs == null || spanMs < t.maxSpanMs) || tiers[tiers.length - 1];
    if (tier.midnightOptions && date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0) {
      return new Intl.DateTimeFormat(locale, tier.midnightOptions).format(date);
    }
    if (tier.formatter) {
      return tier.formatter(date, locale);
    }
    return new Intl.DateTimeFormat(locale, tier.options).format(date);
  }
  var DAY_MS = 24 * 60 * 60 * 1e3;
  function haStyleTimeTiers() {
    return [
      {
        maxSpanMs: 2 * DAY_MS + 1,
        options: { hour: "numeric", minute: "2-digit" },
        // Real code special-cases an exact-midnight tick within this tier to
        // show the date instead of e.g. "12:00 AM" — a real, useful behavior
        // at day boundaries, not a guess.
        midnightOptions: { day: "numeric", month: "short" }
      },
      { maxSpanMs: 7 * DAY_MS + 1, options: { weekday: "short" } },
      { maxSpanMs: 88 * DAY_MS + 1, options: { day: "numeric", month: "short" } },
      {
        // Real code shows the bare month name once a span exceeds ~3 months,
        // adding the year only on a January tick (context resets each year) —
        // month:"long", not "short" (HA's own formatDateMonth/MonthYear use
        // "long"). Needs a formatter (not static options) since which format
        // applies depends on each individual tick's own month.
        formatter: (date, locale) => date.getMonth() === 0 ? new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(date) : new Intl.DateTimeFormat(locale, { month: "long" }).format(date)
      }
    ];
  }

  // src/lib/svg-chart.js
  function observeChartResize(chartEl, onResize) {
    let frame;
    const observer = new ResizeObserver(() => {
      if (frame) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(() => {
        frame = void 0;
        onResize();
      });
    });
    observer.observe(chartEl);
    return observer;
  }

  // src/energy-cost-stat-card.js
  var ICONS = {
    total: "M5,6H23V18H5V6M14,9A3,3 0 0,1 17,12A3,3 0 0,1 14,15A3,3 0 0,1 11,12A3,3 0 0,1 14,9M9,8A2,2 0 0,1 7,10V14A2,2 0 0,1 9,16H19A2,2 0 0,1 21,14V10A2,2 0 0,1 19,8H9M1,10H3V20H19V22H1V10Z",
    highest: "M16,6L18.29,8.29L13.41,13.17L9.41,9.17L2,16.59L3.41,18L9.41,12L13.41,16L19.71,9.71L22,12V6H16Z",
    lowest: "M16,18L18.29,15.71L13.41,10.83L9.41,14.83L2,7.41L3.41,6L9.41,12L13.41,8L19.71,14.29L22,12V18H16Z",
    average: "M16,11.78L20.24,4.45L21.97,5.45L16.74,14.5L10.23,10.75L5.46,19H22V21H2V3H4V17.54L9.5,8L16,11.78Z",
    // arrow-expand-vertical, from Templarian/MaterialDesign (the same @mdi
    // icon set the others above were pulled from) — a combined highest+lowest
    // tile reads as a "range", not a single trend direction, so neither the
    // highest nor lowest arrow alone fits.
    range: "M13,9V15H16L12,19L8,15H11V9H8L12,5L16,9H13M4,2H20V4H4V2M4,20H20V22H4V20Z"
  };
  var DEFAULT_LABELS = {
    total: "Grid Cost",
    highest: "Highest",
    lowest: "Lowest",
    average: "Average",
    range: "Highest / Lowest"
  };
  var STATS = ["total", "highest", "lowest", "average", "range"];
  var SPARKLINE_HEIGHT = 28;
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
  var EnergyCostStatCard = class extends HTMLElement {
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
      const entries = [...deltaByBucketStart.entries()];
      if (!entries.length) {
        this._primaryEl.textContent = "";
        this._secondaryEl.hidden = false;
        this._secondaryEl.textContent = "No data yet for this period";
        this._renderSparkline(null);
        return;
      }
      const sortedPoints = entries.slice().sort((a, b) => a[0] - b[0]).map(([x, y]) => ({ x, y }));
      this._renderSparkline(sortedPoints);
      if (this._config.stat === "average") {
        const values = entries.map(([, v]) => v);
        const value = values.reduce((sum, v) => sum + v, 0) / values.length;
        this._primaryEl.textContent = this._formatCurrency(value);
        this._secondaryEl.hidden = !!this._config.title;
        this._secondaryEl.textContent = this._config.title ? "" : DEFAULT_LABELS.average;
        return;
      }
      const maxEntry = entries.reduce((best, e) => e[1] > best[1] ? e : best);
      const minEntry = entries.reduce((best, e) => e[1] < best[1] ? e : best);
      if (this._config.stat === "highest" || this._config.stat === "lowest") {
        const [x, y] = this._config.stat === "highest" ? maxEntry : minEntry;
        const dateStr = this._formatBucketDate(x, data);
        this._primaryEl.textContent = this._formatCurrency(y);
        this._secondaryEl.hidden = false;
        this._secondaryEl.textContent = this._config.title ? dateStr : `${DEFAULT_LABELS[this._config.stat]} \xB7 ${dateStr}`;
        return;
      }
      const maxDateStr = this._formatBucketDate(maxEntry[0], data);
      const minDateStr = this._formatBucketDate(minEntry[0], data);
      this._primaryEl.textContent = `${this._formatCurrency(minEntry[1])}   \u2013   ${this._formatCurrency(maxEntry[1])}`;
      this._secondaryEl.hidden = false;
      this._secondaryEl.textContent = `Lowest ${minDateStr} \xB7 Highest ${maxDateStr}`;
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
      this._renderSparkline(series);
      const projection = computeProjection(data, series, runningTotal);
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
      const maxY = Math.max(...ys, minY + 1e-4);
      const scaleX = (i) => i / (points.length - 1) * width;
      const scaleY = (y) => height - (y - minY) / (maxY - minY) * height;
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
        locale: this._hass?.locale?.language
      });
    }
  };
  customElements.define("energy-cost-stat-card", EnergyCostStatCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "energy-cost-stat-card",
    name: "Energy Cost Stat",
    description: "A grid-cost number (current total + projected, highest, lowest, average per bucket, or highest+lowest combined) for the Energy dashboard's currently selected period. Set `stat:` to total, highest, lowest, average, or range."
  });
})();
