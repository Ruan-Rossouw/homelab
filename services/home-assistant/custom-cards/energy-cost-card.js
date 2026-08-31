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

  // src/energy-cost-card.js
  var EnergyCostCard = class extends HTMLElement {
    setConfig(config) {
      this._config = config || {};
      if (!this.shadowRoot) {
        this.attachShadow({ mode: "open" });
        this.shadowRoot.innerHTML = `
        <style>
          ${CHART_CARD_STYLES}
          .projected {
            font-size: var(--ha-font-size-s, 12px);
            color: var(--secondary-text-color);
            margin-bottom: 8px;
            flex: none;
          }
        </style>
        <ha-card>
          <div class="header"></div>
          <div class="total"></div>
          <div class="projected" hidden></div>
          <div class="chart"></div>
        </ha-card>
      `;
      }
      const firstRender = !this._headerEl;
      this._headerEl = this.shadowRoot.querySelector(".header");
      this._totalEl = this.shadowRoot.querySelector(".total");
      this._projectedEl = this.shadowRoot.querySelector(".projected");
      this._chartEl = this.shadowRoot.querySelector(".chart");
      this._headerEl.textContent = this._config.title || "Grid Cost";
      if (firstRender) {
        this._chartEl.addEventListener("pointermove", (e) => this._onPointerMove(e));
        this._chartEl.addEventListener("pointerleave", () => this._onPointerLeave());
        this._resizeObserver = observeChartResize(this._chartEl, () => {
          if (this._series) {
            this._renderChart(this._series, this._projection, this._periodStartMs);
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
    // Sections-view sizing default — a time-series chart reads better wide
    // and needs more vertical room than a plain stat tile. Since the chart
    // now fills whatever box Sections view gives it (see _renderChart),
    // this is just a starting point — drag-resize the card's row span in
    // the dashboard editor to taste, or override via grid_options in the
    // card's own config.
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
        this._projectedEl.hidden = true;
        return;
      }
      const deltaByBucketStart = sumCostByBucket(stats, costStatIds);
      const bucketStarts = [...deltaByBucketStart.keys()].sort((a, b) => a - b);
      let runningTotal = 0;
      const series = bucketStarts.map((start) => {
        runningTotal += deltaByBucketStart.get(start);
        return { x: start, y: runningTotal };
      });
      this._totalEl.textContent = this._formatCurrency(runningTotal);
      const projection = this._computeProjection(data, series, runningTotal);
      if (projection && projection.isEstimate) {
        this._projectedEl.hidden = false;
        this._projectedEl.textContent = `Projected: ${this._formatCurrency(projection.total)}`;
      } else {
        this._projectedEl.hidden = true;
      }
      this._renderChart(series, projection, data.start ? data.start.getTime() : void 0);
    }
    // The reference line spans the period at a constant rate — while the
    // period is still ongoing, that rate is a linear extrapolation from
    // data so far (an estimate of where the total will land); once the
    // period is over, the real final total is already known, so the same
    // line becomes the period's actual average pace instead of a forecast
    // — still useful (which hours/days ran above or below that average),
    // just no longer something to also announce as a "projected" total.
    // Deliberately simple and self-contained either way — no reaching
    // outside the data this card already has, at the cost of not
    // anticipating a tariff tier crossover late in an ongoing period (see
    // the "linear vs tariff-aware" discussion this was chosen over).
    _computeProjection(data, series, runningTotal) {
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
    _formatCurrency(value, compact = false) {
      return formatCurrency(value, {
        symbol: this._config.currency_symbol || "R",
        locale: this._hass?.locale?.language,
        compact
      });
    }
    // Sub-day ranges (the "Today" picker) get hour:minute labels; anything
    // longer gets a short date, since a time-of-day label on a month-long
    // range would be meaningless. Based on the real data span, not the
    // padded plotting domain.
    _formatTime(timestamp) {
      const locale = this._hass?.locale?.language;
      const spanMs = this._chartBounds ? this._chartBounds.dataMaxX - this._chartBounds.dataMinX : 0;
      return formatTimeForSpan(timestamp, locale, spanMs, [
        { maxSpanMs: 2 * 24 * 60 * 60 * 1e3, options: { hour: "2-digit", minute: "2-digit" } },
        { options: { month: "short", day: "numeric" } }
      ]);
    }
    _renderChart(series, projection, periodStartMs) {
      if (periodStartMs != null && series.length && periodStartMs < series[0].x) {
        series = [{ x: periodStartMs, y: 0 }, ...series];
      }
      this._series = series;
      this._projection = projection;
      this._periodStartMs = periodStartMs;
      if (series.length < 2) {
        this._chartEl.innerHTML = `<div class="message">Not enough data yet for this period.</div>`;
        this._series = void 0;
        this._projection = void 0;
        return;
      }
      const { width, height } = measureChartBox(this._chartEl);
      const { left: padLeft, right: padRight, top: padTop, bottom: padBottom } = CHART_PADDING;
      const xs = series.map((p) => p.x);
      const dataMinX = Math.min(...xs);
      const dataMaxX = Math.max(...xs);
      const dataMaxY = Math.max(...series.map((p) => p.y), 1e-4);
      const domainMinX = dataMinX;
      const domainMaxX = projection ? projection.endMs : dataMaxX + (dataMaxX - dataMinX || 1) * 0.04;
      const yMaxWithProjection = projection ? Math.max(dataMaxY, projection.total) : dataMaxY;
      const { axisMax: domainMaxY, tickSpacing } = niceAxisScale(yMaxWithProjection, 5);
      const scaleX = (x) => padLeft + (x - domainMinX) / (domainMaxX - domainMinX || 1) * (width - padLeft - padRight);
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
        domainMinX,
        domainMaxX,
        domainMaxY
      };
      const linePoints = series.map((p) => `${scaleX(p.x).toFixed(1)},${scaleY(p.y).toFixed(1)}`).join(" ");
      const areaPoints = `${scaleX(dataMinX).toFixed(1)},${height - padBottom} ${linePoints} ${scaleX(
        dataMaxX
      ).toFixed(1)},${height - padBottom}`;
      const projectionLine = projection ? `<polyline points="${scaleX(periodStartMs ?? dataMinX).toFixed(1)},${scaleY(0).toFixed(1)} ${scaleX(
        projection.endMs
      ).toFixed(1)},${scaleY(projection.total).toFixed(1)}" fill="none" stroke="var(--warning-color)" stroke-width="1.5" stroke-dasharray="6,8"></polyline>` : "";
      const yGridlines = renderYGridlines({
        domainMaxY,
        tickSpacing,
        scaleY,
        padLeft,
        width,
        padRight,
        formatValue: (v) => this._formatCurrency(v, true)
      });
      const middleIndexes = selectLabelIndexes(series.length, 5).slice(0, -1);
      const middleTicks = middleIndexes.map((i) => {
        const p = series[i];
        const x = scaleX(p.x).toFixed(1);
        return `<text x="${x}" y="${height - 6}" text-anchor="${i === 0 ? "start" : "middle"}" class="axis-label">${this._formatTime(p.x)}</text>`;
      });
      const lastTickMs = projection ? projection.endMs : dataMaxX;
      const lastTickX = scaleX(lastTickMs).toFixed(1);
      const xTicks = [
        ...middleTicks,
        `<text x="${lastTickX}" y="${height - 6}" text-anchor="end" class="axis-label">${this._formatTime(lastTickMs)}</text>`
      ].join("");
      this._chartEl.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" style="height: ${height}px;" preserveAspectRatio="none">
        ${yGridlines}
        <polygon points="${areaPoints}" fill="var(--primary-color)" opacity="0.25"></polygon>
        <polyline points="${linePoints}" fill="none" stroke="var(--primary-color)" stroke-width="2"></polyline>
        ${projectionLine}
        ${xTicks}
        <line class="hover-line" x1="0" y1="${padTop}" x2="0" y2="${height - padBottom}" stroke="var(--info-color)" stroke-width="1" stroke-dasharray="3,3" visibility="hidden"></line>
        <circle class="hover-dot" r="4" fill="var(--info-color)" visibility="hidden"></circle>
      </svg>
      <div class="tooltip" hidden></div>
    `;
      this._svgEl = this._chartEl.querySelector("svg");
      this._hoverLine = this._chartEl.querySelector(".hover-line");
      this._hoverDot = this._chartEl.querySelector(".hover-dot");
      this._tooltipEl = this._chartEl.querySelector(".tooltip");
    }
    _onPointerMove(e) {
      if (!this._series || !this._svgEl || !this._chartBounds) {
        return;
      }
      const rect = this._svgEl.getBoundingClientRect();
      const { width, height, padLeft, padRight, domainMinX, domainMaxX } = this._chartBounds;
      const relX = (e.clientX - rect.left) / rect.width;
      const viewBoxX = relX * width;
      const targetX = domainMinX + (viewBoxX - padLeft) / (width - padLeft - padRight) * (domainMaxX - domainMinX);
      let nearest = this._series[0];
      let nearestDist = Infinity;
      for (const point of this._series) {
        const dist = Math.abs(point.x - targetX);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = point;
        }
      }
      const px = this._scaleX(nearest.x);
      const py = this._scaleY(nearest.y);
      this._hoverLine.setAttribute("x1", px);
      this._hoverLine.setAttribute("x2", px);
      this._hoverLine.setAttribute("visibility", "visible");
      this._hoverDot.setAttribute("cx", px);
      this._hoverDot.setAttribute("cy", py);
      this._hoverDot.setAttribute("visibility", "visible");
      this._tooltipEl.hidden = false;
      this._tooltipEl.textContent = `${this._formatTime(nearest.x)} \u2014 ${this._formatCurrency(nearest.y)}`;
      this._tooltipEl.style.left = `${px / width * rect.width}px`;
      this._tooltipEl.style.top = `${py / height * rect.height}px`;
    }
    _onPointerLeave() {
      if (this._hoverLine) this._hoverLine.setAttribute("visibility", "hidden");
      if (this._hoverDot) this._hoverDot.setAttribute("visibility", "hidden");
      if (this._tooltipEl) this._tooltipEl.hidden = true;
    }
  };
  customElements.define("energy-cost-card", EnergyCostCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "energy-cost-card",
    name: "Energy Cost (Combined Grid)",
    description: "Cumulative grid cost so far, summed across all configured grid sources, synced to the Energy dashboard's date picker."
  });
})();
