(() => {
  // src/lib/card-shell.js
  var CHART_CARD_STYLES = `
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
  .total {
    font-size: 1.6rem;
    font-weight: 500;
    color: var(--primary-text-color);
    margin-bottom: 8px;
    flex: none;
  }
  .chart { position: relative; flex: 1; min-height: 0; }
  .chart svg { width: 100%; display: block; }
  .axis-label {
    font-family: Roboto, Noto, sans-serif;
    font-size: var(--ha-font-size-s, 12px);
    fill: var(--primary-text-color);
  }
  .tooltip {
    position: absolute;
    transform: translate(-50%, -100%) translateY(-6px);
    background: var(--card-background-color, #1c1c1c);
    border: 1px solid var(--divider-color);
    border-radius: 4px;
    padding: 4px 8px;
    font-family: Roboto, Noto, sans-serif;
    font-size: var(--ha-font-size-s, 12px);
    color: var(--primary-text-color);
    white-space: nowrap;
    pointer-events: none;
  }
  .message {
    color: var(--secondary-text-color);
    font-size: 0.9rem;
    padding: 8px 0;
  }
`;

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

  // src/lib/nice-axis.js
  function niceNumber(range, round) {
    if (range <= 0) return 1;
    const exponent = Math.floor(Math.log10(range));
    const fraction = range / Math.pow(10, exponent);
    let niceFraction;
    if (round) {
      if (fraction < 1.5) niceFraction = 1;
      else if (fraction < 3) niceFraction = 2;
      else if (fraction < 7) niceFraction = 5;
      else niceFraction = 10;
    } else if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;
    return niceFraction * Math.pow(10, exponent);
  }
  function niceAxisScale(dataMax, targetTickCount) {
    const niceRange = niceNumber(dataMax, false);
    const tickSpacing = niceNumber(niceRange / Math.max(targetTickCount - 1, 1), true);
    const axisMax = Math.ceil(dataMax / tickSpacing) * tickSpacing;
    return { axisMax, tickSpacing };
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
    return `${symbol} ${number}`;
  }
  function formatTimeForSpan(timestamp, locale, spanMs, tiers) {
    const date = new Date(timestamp);
    for (const tier of tiers) {
      if (tier.maxSpanMs == null || spanMs < tier.maxSpanMs) {
        return new Intl.DateTimeFormat(locale, tier.options).format(date);
      }
    }
    return new Intl.DateTimeFormat(locale, tiers[tiers.length - 1].options).format(date);
  }

  // src/lib/svg-chart.js
  var CHART_PADDING = { left: 56, right: 12, top: 10, bottom: 24 };
  function measureChartBox(chartEl) {
    const width = chartEl.clientWidth || 600;
    const height = chartEl.clientHeight || Math.max(width / 2, 200);
    return { width, height };
  }
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
  function renderYGridlines({ domainMaxY, tickSpacing, scaleY, padLeft, width, padRight, formatValue }) {
    const tickCount = Math.round(domainMaxY / tickSpacing);
    return Array.from({ length: tickCount + 1 }, (_, i) => i * tickSpacing).map((v) => {
      const y = scaleY(v).toFixed(1);
      return `
        <line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" stroke="var(--divider-color)" stroke-width="1"></line>
        <text x="${padLeft - 6}" y="${y}" text-anchor="end" dominant-baseline="middle" class="axis-label">${formatValue(v)}</text>
      `;
    }).join("");
  }

  // src/lib/tick-labels.js
  function selectLabelIndexes(itemCount, targetCount) {
    if (itemCount <= 0) return [];
    const count = Math.max(1, Math.min(targetCount, itemCount));
    if (count === 1) return [0];
    const indexes = [];
    for (let i = 0; i < count; i++) {
      indexes.push(Math.round(i * (itemCount - 1) / (count - 1)));
    }
    return [...new Set(indexes)];
  }

  // src/energy-cost-breakdown-card.js
  var EnergyCostBreakdownCard = class extends HTMLElement {
    setConfig(config) {
      this._config = config || {};
      if (!this.shadowRoot) {
        this.attachShadow({ mode: "open" });
        this.shadowRoot.innerHTML = `
        <style>
          ${CHART_CARD_STYLES}
        </style>
        <ha-card>
          <div class="header"></div>
          <div class="total"></div>
          <div class="chart"></div>
        </ha-card>
      `;
      }
      const firstRender = !this._headerEl;
      this._headerEl = this.shadowRoot.querySelector(".header");
      this._totalEl = this.shadowRoot.querySelector(".total");
      this._chartEl = this.shadowRoot.querySelector(".chart");
      this._headerEl.textContent = this._config.title || "Grid Cost by Period";
      if (firstRender) {
        this._chartEl.addEventListener("pointermove", (e) => this._onPointerMove(e));
        this._chartEl.addEventListener("pointerleave", () => this._onPointerLeave());
        this._resizeObserver = observeChartResize(this._chartEl, () => {
          if (this._buckets) {
            this._renderChart(this._buckets);
          }
        });
      }
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
      return 3;
    }
    getLayoutOptions() {
      return {
        grid_columns: "full",
        grid_rows: 4,
        grid_min_rows: 3
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
          this._chartEl.innerHTML = `<div class="message">Waiting for an Energy date-selection card on this dashboard\u2026</div>`;
        }
      );
    }
    async _update(data) {
      const prefs = data.prefs;
      const stats = data.stats;
      const costStatIds = await discoverGridCostStatIds(this._hass, prefs);
      if (!costStatIds.length) {
        this._chartEl.innerHTML = `<div class="message">No grid source has cost tracking configured yet (Settings \u2192 Dashboards \u2192 Energy).</div>`;
        this._totalEl.textContent = "";
        return;
      }
      const costByBucketStart = sumCostByBucket(stats, costStatIds);
      const buckets = [...costByBucketStart.keys()].sort((a, b) => a - b).map((start) => ({ x: start, y: costByBucketStart.get(start) }));
      this._renderChart(buckets);
      if (buckets.length) {
        const highest = buckets.reduce((max, b) => b.y > max.y ? b : max, buckets[0]);
        this._totalEl.textContent = `Highest: ${this._formatCurrency(highest.y)} (${this._formatTime(highest.x)})`;
      } else {
        this._totalEl.textContent = "";
      }
    }
    _formatCurrency(value, compact = false) {
      return formatCurrency(value, {
        symbol: this._config.currency_symbol || "R",
        locale: this._hass?.locale?.language,
        compact
      });
    }
    // Three tiers instead of energy-cost-card.js's two: this chart can span
    // a full year of monthly buckets, where a day-of-month label (e.g. "Aug
    // 1" repeated on every bucket) reads oddly — drop the day and show
    // "MMM 'YY" once buckets are month-sized, matching the original
    // apexcharts card's month labels ("Sep '25", "Dec '25", ...).
    _formatTime(timestamp) {
      const locale = this._hass?.locale?.language;
      const spanMs = this._chartBounds ? this._chartBounds.dataMaxX - this._chartBounds.dataMinX : 0;
      const dayMs = 24 * 60 * 60 * 1e3;
      return formatTimeForSpan(timestamp, locale, spanMs, [
        { maxSpanMs: 2 * dayMs, options: { hour: "2-digit", minute: "2-digit" } },
        { maxSpanMs: 60 * dayMs, options: { month: "short", day: "numeric" } },
        { options: { month: "short", year: "2-digit" } }
      ]);
    }
    _renderChart(buckets) {
      this._buckets = buckets;
      if (!buckets.length) {
        this._chartEl.innerHTML = `<div class="message">Not enough data yet for this period.</div>`;
        this._buckets = void 0;
        return;
      }
      const { width, height } = measureChartBox(this._chartEl);
      const { left: padLeft, right: padRight, top: padTop, bottom: padBottom } = CHART_PADDING;
      const xs = buckets.map((b) => b.x);
      const dataMinX = Math.min(...xs);
      const dataMaxX = Math.max(...xs);
      const dataMaxY = Math.max(...buckets.map((b) => b.y), 1e-4);
      const { axisMax: domainMaxY, tickSpacing } = niceAxisScale(dataMaxY, 5);
      const plotLeft = padLeft;
      const plotWidth = width - padLeft - padRight;
      const slotWidth = plotWidth / buckets.length;
      const barWidth = Math.min(slotWidth * 0.6, 40);
      const scaleX = (i) => plotLeft + slotWidth * (i + 0.5);
      const scaleY = (y) => height - padBottom - y / domainMaxY * (height - padTop - padBottom);
      this._scaleX = scaleX;
      this._scaleY = scaleY;
      this._chartBounds = {
        width,
        height,
        padLeft,
        padRight,
        padTop,
        padBottom,
        dataMinX,
        dataMaxX,
        domainMaxY,
        slotWidth,
        barWidth,
        plotLeft
      };
      const bars = buckets.map((b, i) => {
        const cx = scaleX(i);
        const y = scaleY(b.y);
        const barHeight = height - padBottom - y;
        return `<rect x="${(cx - barWidth / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(barHeight, 0).toFixed(1)}" fill="var(--energy-grid-consumption-color, #dc7500)" rx="2"></rect>`;
      }).join("");
      const yGridlines = renderYGridlines({
        domainMaxY,
        tickSpacing,
        scaleY,
        padLeft,
        width,
        padRight,
        formatValue: (v) => this._formatCurrency(v, true)
      });
      const labelIndexes = selectLabelIndexes(buckets.length, 6);
      const xTicks = labelIndexes.map((i) => {
        const anchor = i === 0 ? "start" : i === buckets.length - 1 ? "end" : "middle";
        return `<text x="${scaleX(i).toFixed(1)}" y="${height - 6}" text-anchor="${anchor}" class="axis-label">${this._formatTime(buckets[i].x)}</text>`;
      }).join("");
      this._chartEl.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" style="height: ${height}px;" preserveAspectRatio="none">
        ${yGridlines}
        ${bars}
        ${xTicks}
        <rect class="hover-rect" fill="var(--info-color)" opacity="0.15" visibility="hidden"></rect>
      </svg>
      <div class="tooltip" hidden></div>
    `;
      this._svgEl = this._chartEl.querySelector("svg");
      this._hoverRect = this._chartEl.querySelector(".hover-rect");
      this._tooltipEl = this._chartEl.querySelector(".tooltip");
    }
    _onPointerMove(e) {
      if (!this._buckets || !this._svgEl || !this._chartBounds) {
        return;
      }
      const rect = this._svgEl.getBoundingClientRect();
      const { width, height, plotLeft, slotWidth, padTop, padBottom, barWidth } = this._chartBounds;
      const relX = (e.clientX - rect.left) / rect.width;
      const viewBoxX = relX * width;
      let index = Math.floor((viewBoxX - plotLeft) / slotWidth);
      index = Math.max(0, Math.min(this._buckets.length - 1, index));
      const bucket = this._buckets[index];
      const cx = this._scaleX(index);
      const barY = this._scaleY(bucket.y);
      this._hoverRect.setAttribute("x", (cx - barWidth / 2).toFixed(1));
      this._hoverRect.setAttribute("y", padTop);
      this._hoverRect.setAttribute("width", barWidth.toFixed(1));
      this._hoverRect.setAttribute("height", (height - padBottom - padTop).toFixed(1));
      this._hoverRect.setAttribute("visibility", "visible");
      this._tooltipEl.hidden = false;
      this._tooltipEl.textContent = `${this._formatTime(bucket.x)} \u2014 ${this._formatCurrency(bucket.y)}`;
      this._tooltipEl.style.left = `${cx / width * rect.width}px`;
      this._tooltipEl.style.top = `${barY / height * rect.height}px`;
    }
    _onPointerLeave() {
      if (this._hoverRect) this._hoverRect.setAttribute("visibility", "hidden");
      if (this._tooltipEl) this._tooltipEl.hidden = true;
    }
  };
  customElements.define("energy-cost-breakdown-card", EnergyCostBreakdownCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "energy-cost-breakdown-card",
    name: "Energy Cost Breakdown",
    description: "Per-bucket grid cost bars (hour/day/month depending on the Energy dashboard's selected period), synced to the date picker."
  });
})();
