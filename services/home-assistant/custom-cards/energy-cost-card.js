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
  .chart { position: relative; flex: 1; min-height: 0; touch-action: pan-y; }
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
  .tooltip-header {
    font-weight: bold;
    text-align: center;
    margin-bottom: 2px;
  }
  .tooltip-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .tooltip-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex: none;
  }
  .message {
    color: var(--secondary-text-color);
    font-size: 0.9rem;
    padding: 8px 0;
  }
  .zoom-reset {
    position: absolute;
    top: 4px;
    right: 4px;
    padding: 2px 8px;
    font-family: Roboto, Noto, sans-serif;
    font-size: var(--ha-font-size-s, 12px);
    color: var(--primary-text-color);
    background: var(--card-background-color, #1c1c1c);
    border: 1px solid var(--divider-color);
    border-radius: 4px;
    cursor: pointer;
  }
  /* Togglable series legend \u2014 matches ha-chart-base.ts's real chart-legend
     markup (a plain <ul><li><button> HTML legend, not an ECharts canvas
     one): mdiCheckCircle/mdiCircleOutline toggle icon, secondary-text-color
     on a hidden item, opacity-0.5 hover, larger touch targets on coarse
     pointers. Simplified from HA's version (no overflow/expand chip, no
     more-info-clickable label) since this card only ever has 1-2 series. */
  .legend {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: var(--ha-space-2, 8px);
    font-family: Roboto, Noto, sans-serif;
    font-size: var(--ha-font-size-s, 12px);
    color: var(--primary-text-color);
    flex: none;
  }
  .legend-item {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 24px;
  }
  .legend-item.hidden {
    color: var(--secondary-text-color);
  }
  .legend-toggle {
    background: none;
    border: none;
    color: inherit;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 4px;
    margin: -4px;
  }
  .legend-toggle:hover {
    opacity: 0.5;
  }
  .legend-label {
    cursor: default;
  }
  @media (pointer: coarse) {
    .legend-item {
      height: 40px;
    }
    .legend-toggle {
      padding: 11px;
      margin: 0;
    }
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
  var CHART_PADDING = { left: 56, right: 12, top: 14, bottom: 24 };
  var DRAG_ZOOM_THRESHOLD_PX = 8;
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
  function renderYGridlines({ domainMaxY, tickSpacing, scaleY, padLeft, width, padRight, formatValue, axisName }) {
    const tickCount = Math.round(domainMaxY / tickSpacing);
    const gridlines = Array.from({ length: tickCount + 1 }, (_, i) => i * tickSpacing).map((v) => {
      const y = scaleY(v).toFixed(1);
      return `
        <line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" stroke="var(--divider-color)" stroke-width="1"></line>
        <text x="${padLeft - 6}" y="${y}" text-anchor="end" dominant-baseline="middle" class="axis-label">${formatValue(v)}</text>
      `;
    }).join("");
    const nameLabel = axisName ? `<text x="${padLeft}" y="${(scaleY(domainMaxY) - 2).toFixed(1)}" text-anchor="start" class="axis-label">${axisName}</text>` : "";
    return gridlines + nameLabel;
  }
  function renderXGridlines({ tickXs, padTop, padBottom, height }) {
    const y2 = (height - padBottom).toFixed(1);
    return tickXs.map(
      (x) => `<line x1="${x.toFixed(1)}" y1="${padTop}" x2="${x.toFixed(1)}" y2="${y2}" stroke="var(--divider-color)" stroke-width="1"></line>`
    ).join("");
  }

  // src/lib/tick-labels.js
  var DEFAULT_TICK_COUNT = 6;
  function selectEvenTimestamps(startMs, endMs, count) {
    if (count <= 1) return [startMs];
    return Array.from({ length: count }, (_, i) => startMs + (endMs - startMs) * i / (count - 1));
  }
  var DAY_MS2 = 24 * 60 * 60 * 1e3;
  var DAY_INTERVAL_CANDIDATES_DAYS = [1, 2, 3, 4, 5, 7, 10, 14, 21, 30, 60, 90, 120, 182, 365];
  var MAX_DAY_TICK_COUNT = 8;
  function selectNiceDayTicks(startMs, endMs, maxTicks = MAX_DAY_TICK_COUNT) {
    const spanDays = (endMs - startMs) / DAY_MS2;
    let intervalDays = DAY_INTERVAL_CANDIDATES_DAYS[DAY_INTERVAL_CANDIDATES_DAYS.length - 1];
    for (const candidate of DAY_INTERVAL_CANDIDATES_DAYS) {
      const count = Math.floor(spanDays / candidate) + 1;
      if (count <= maxTicks) {
        intervalDays = candidate;
        break;
      }
    }
    const intervalMs = intervalDays * DAY_MS2;
    const ticks = [];
    for (let t = startMs; t <= endMs; t += intervalMs) {
      ticks.push(t);
    }
    return ticks;
  }
  function inferFixedStepMs(sortedTimestamps) {
    if (sortedTimestamps.length < 2) return void 0;
    const step = sortedTimestamps[1] - sortedTimestamps[0];
    return step > 0 && step <= 24 * 60 * 60 * 1e3 ? step : void 0;
  }
  function snapToStep(t, originMs, stepMs) {
    return originMs + Math.round((t - originMs) / stepMs) * stepMs;
  }

  // src/lib/pointer-interaction.js
  function createPointerPin() {
    let pinned = false;
    return {
      // Call from a card's pointerdown handler once it's decided this is a
      // touch tap that should pin.
      pin() {
        pinned = true;
      },
      clear() {
        pinned = false;
      },
      isPinned() {
        return pinned;
      },
      // Call at the top of _onPointerMove. Mouse/pen: always update (today's
      // behavior). Touch: only update while the pointer is actually down —
      // i.e. the initial tap or a drag-to-scrub — not on a stray move event.
      shouldUpdateOnMove(e) {
        return e.pointerType !== "touch" || e.buttons > 0;
      },
      // Call from _onPointerLeave. A pinned touch tap must survive
      // pointerleave/finger-lift; mouse/pen (or an unpinned touch) clears as
      // before.
      shouldClearOnLeave(e) {
        return !(e && e.pointerType === "touch" && pinned);
      }
    };
  }

  // src/energy-cost-card.js
  var CHECK_CIRCLE_PATH = "M12 2C6.5 2 2 6.5 2 12S6.5 22 12 22 22 17.5 22 12 17.5 2 12 2M10 17L5 12L6.41 10.59L10 14.17L17.59 6.58L19 8L10 17Z";
  var CIRCLE_OUTLINE_PATH = "M12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z";
  var EnergyCostCard = class extends HTMLElement {
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
          <div class="chart"></div>
          <ul class="legend"></ul>
        </ha-card>
      `;
      }
      const firstRender = !this._headerEl;
      this._headerEl = this.shadowRoot.querySelector(".header");
      this._chartEl = this.shadowRoot.querySelector(".chart");
      this._headerEl.hidden = !this._config.title;
      this._headerEl.textContent = this._config.title || "";
      this._legendEl = this.shadowRoot.querySelector(".legend");
      if (firstRender) {
        this._pointerPin = createPointerPin();
        this._zoomRange = null;
        this._dragging = false;
        this._hiddenSeries = /* @__PURE__ */ new Set();
        this._legendEl.addEventListener("click", (e) => {
          const target = e.target.closest("[data-series]");
          if (target) this._toggleSeries(target.dataset.series);
        });
        this._chartEl.addEventListener("pointerdown", (e) => this._onPointerDown(e));
        this._chartEl.addEventListener("pointermove", (e) => this._onPointerMove(e));
        this._chartEl.addEventListener("pointerup", (e) => this._onPointerUp(e));
        this._chartEl.addEventListener("pointercancel", (e) => this._onPointerCancel(e));
        this._chartEl.addEventListener("pointerleave", (e) => this._onPointerLeave(e));
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
        return;
      }
      const deltaByBucketStart = sumCostByBucket(stats, costStatIds);
      const { series, runningTotal } = buildRunningTotalSeries(deltaByBucketStart);
      const projection = computeProjection(data, series, runningTotal);
      const periodStartMs = data.start ? data.start.getTime() : void 0;
      if (this._zoomRange && periodStartMs !== this._periodStartMs) {
        this._zoomRange = null;
      }
      this._renderChart(series, projection, periodStartMs);
    }
    _formatCurrency(value, compact = false) {
      return formatCurrency(value, {
        symbol: this._config.currency_symbol || "R",
        locale: this._hass?.locale?.language,
        compact
      });
    }
    // Ported byte-for-byte from HA's own axis-label.ts formatTimeLabel()
    // cascade — see format.js's haStyleTimeTiers() for the exact thresholds/
    // formats and what's deliberately not replicated (bold-only distinctions,
    // the unreachable <5-minute tier).
    //
    // spanMs MUST be the plotted *domain* span (this._chartBounds.domainMaxX
    // - domainMinX), matching HA's own axis.max - axis.min — not
    // dataMaxX - dataMinX (the real-series-only span). This card's domain
    // extends past the real series via the projection line out to the
    // period end (or zoom range, when zoomed); using the real-data-only span
    // here was a real bug (fixed): early in a still-short period, dataMaxX
    // stays small even though the plotted/visible domain already spans the
    // whole period, so ticks near the end of a long period were wrongly
    // formatted as if the chart were only a few days wide (e.g. weekday
    // labels showing up on a month-long view). domainMinX/domainMaxX already
    // account for this (and for an active zoom), so no other change is
    // needed here beyond reading the right field.
    _formatTime(timestamp) {
      const locale = this._hass?.locale?.language;
      const spanMs = this._chartBounds ? this._chartBounds.domainMaxX - this._chartBounds.domainMinX : 0;
      return formatTimeForSpan(timestamp, locale, spanMs, haStyleTimeTiers());
    }
    // Bare number for the y-axis's per-tick labels (no currency symbol) — the
    // unit is shown once instead, via renderYGridlines' axisName. See
    // format.js's formatCurrency: an empty symbol drops the unit/leading
    // space entirely.
    _formatCompactNumber(value) {
      return formatCurrency(value, {
        symbol: "",
        locale: this._hass?.locale?.language,
        compact: true
      });
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
      const showActual = !this._hiddenSeries.has("actual");
      const showProjected = !this._hiddenSeries.has("projected");
      let domainMinX, domainMaxX, yMaxWithProjection, tickRangeStartMs, tickRangeEndMs;
      if (this._zoomRange) {
        domainMinX = this._zoomRange.startMs;
        domainMaxX = this._zoomRange.endMs;
        const yCandidates = [];
        if (showActual) {
          const visiblePoints = series.filter((p) => p.x >= domainMinX && p.x <= domainMaxX);
          yCandidates.push(...(visiblePoints.length ? visiblePoints : series).map((p) => p.y));
        }
        if (showProjected && projection && projection.endMs >= domainMinX && projection.endMs <= domainMaxX) {
          yCandidates.push(projection.total);
        }
        yMaxWithProjection = Math.max(...yCandidates, 1e-4);
        tickRangeStartMs = domainMinX;
        tickRangeEndMs = domainMaxX;
      } else {
        domainMinX = dataMinX;
        domainMaxX = projection ? projection.endMs : dataMaxX + (dataMaxX - dataMinX || 1) * 0.04;
        const yCandidates = [];
        if (showActual) yCandidates.push(dataMaxY);
        if (showProjected && projection) yCandidates.push(projection.total);
        yMaxWithProjection = Math.max(...yCandidates, 1e-4);
        tickRangeStartMs = domainMinX;
        tickRangeEndMs = projection ? projection.endMs : dataMaxX;
      }
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
      const projectionLine = projection && showProjected ? `<polyline points="${scaleX(periodStartMs ?? dataMinX).toFixed(1)},${scaleY(0).toFixed(1)} ${scaleX(
        projection.endMs
      ).toFixed(1)},${scaleY(projection.total).toFixed(1)}" fill="none" stroke="var(--warning-color)" stroke-width="1.5" stroke-dasharray="6,8"></polyline>` : "";
      const yGridlines = renderYGridlines({
        domainMaxY,
        tickSpacing,
        scaleY,
        padLeft,
        width,
        padRight,
        formatValue: (v) => this._formatCompactNumber(v),
        axisName: this._config.currency_symbol || "R"
      });
      const tickRangeSpanMs = tickRangeEndMs - tickRangeStartMs;
      let tickTimestamps;
      if (tickRangeSpanMs >= 24 * 60 * 60 * 1e3) {
        tickTimestamps = selectNiceDayTicks(tickRangeStartMs, tickRangeEndMs, MAX_DAY_TICK_COUNT);
      } else {
        const step = inferFixedStepMs(series.map((p) => p.x));
        const idealTicks = selectEvenTimestamps(tickRangeStartMs, tickRangeEndMs, DEFAULT_TICK_COUNT);
        tickTimestamps = step ? [
          ...new Set(
            idealTicks.map(
              (t, i) => i === 0 || i === idealTicks.length - 1 ? t : snapToStep(t, domainMinX, step)
            )
          )
        ] : idealTicks;
      }
      const xTicks = tickTimestamps.map((t, i, all) => {
        const x = scaleX(t).toFixed(1);
        const isLast = i === all.length - 1;
        const nearRightEdge = isLast && tickRangeEndMs - t <= (all.length > 1 ? all[1] - all[0] : 0);
        const anchor = i === 0 ? "start" : nearRightEdge ? "end" : "middle";
        return `<text x="${x}" y="${height - 6}" text-anchor="${anchor}" class="axis-label">${this._formatTime(t)}</text>`;
      }).join("");
      const xGridlines = renderXGridlines({
        tickXs: tickTimestamps.map((t) => scaleX(t)),
        padTop,
        padBottom,
        height
      });
      this._chartEl.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" style="height: ${height}px;" preserveAspectRatio="none">
        <defs>
          <linearGradient id="area-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--primary-color)" stop-opacity="0.75"></stop>
            <stop offset="100%" stop-color="var(--primary-color)" stop-opacity="0.25"></stop>
          </linearGradient>
          <clipPath id="plot-clip">
            <rect x="${padLeft}" y="${padTop}" width="${(width - padLeft - padRight).toFixed(1)}" height="${(height - padTop - padBottom).toFixed(1)}"></rect>
          </clipPath>
        </defs>
        ${yGridlines}
        ${xGridlines}
        <g clip-path="url(#plot-clip)">
          ${showActual ? `<polygon points="${areaPoints}" fill="url(#area-fill)"></polygon>
          <polyline points="${linePoints}" fill="none" stroke="var(--primary-color)" stroke-width="2"></polyline>` : ""}
          ${projectionLine}
        </g>
        ${xTicks}
        <line class="hover-line" x1="0" y1="${padTop}" x2="0" y2="${height - padBottom}" stroke="var(--info-color)" stroke-width="1" stroke-dasharray="3,3" visibility="hidden"></line>
        <circle class="hover-dot" r="4" fill="var(--info-color)" visibility="hidden"></circle>
        <circle class="scrub-handle" r="10" fill="var(--primary-color)" visibility="hidden"></circle>
        <rect class="zoom-select-rect" fill="var(--info-color)" opacity="0.15" visibility="hidden"></rect>
      </svg>
      <div class="tooltip" hidden></div>
      <button type="button" class="zoom-reset" ${this._zoomRange ? "" : "hidden"}>Reset zoom</button>
    `;
      this._svgEl = this._chartEl.querySelector("svg");
      this._hoverLine = this._chartEl.querySelector(".hover-line");
      this._hoverDot = this._chartEl.querySelector(".hover-dot");
      this._scrubHandle = this._chartEl.querySelector(".scrub-handle");
      this._zoomSelectRect = this._chartEl.querySelector(".zoom-select-rect");
      this._tooltipEl = this._chartEl.querySelector(".tooltip");
      this._resetEl = this._chartEl.querySelector(".zoom-reset");
      this._resetEl.addEventListener("click", () => this._clearZoom());
      this._renderLegend();
    }
    // Plain HTML legend (matches ha-chart-base.ts's real chart-legend, which
    // is itself a <ul><li><button> template, not an ECharts canvas legend —
    // verified against current source before implementing). "Projected" only
    // appears once a projection actually exists for the current period.
    _renderLegend() {
      const items = [{ id: "actual", label: "Grid Cost", color: "var(--primary-color)" }];
      if (this._projection) {
        items.push({ id: "projected", label: "Projected", color: "var(--warning-color)" });
      }
      this._legendEl.innerHTML = items.map((item) => {
        const isHidden = this._hiddenSeries.has(item.id);
        const iconPath = isHidden ? CIRCLE_OUTLINE_PATH : CHECK_CIRCLE_PATH;
        return `
          <li class="legend-item${isHidden ? " hidden" : ""}">
            <button type="button" class="legend-toggle" data-series="${item.id}" aria-pressed="${!isHidden}" title="Toggle visibility">
              <svg viewBox="0 0 24 24" width="18" height="18" style="${isHidden ? "" : `color:${item.color}`}"><path fill="currentColor" d="${iconPath}"></path></svg>
            </button>
            <span class="legend-label" data-series="${item.id}">${item.label}</span>
          </li>
        `;
      }).join("");
    }
    _toggleSeries(id) {
      if (this._hiddenSeries.has(id)) {
        this._hiddenSeries.delete(id);
      } else {
        this._hiddenSeries.add(id);
      }
      if (this._series) {
        this._renderChart(this._series, this._projection, this._periodStartMs);
      } else {
        this._renderLegend();
      }
    }
    // Linear interpolation along the same reference line _renderChart draws
    // as the dashed projection (period start, R0 → projection.endMs,
    // projection.total) — lets the tooltip report the projected-pace value
    // at any hovered x, not just the discrete real-data points nearest.x
    // already covers.
    _projectedValueAt(x) {
      if (!this._projection || !this._chartBounds) return null;
      const startX = this._periodStartMs ?? this._chartBounds.dataMinX;
      const endX = this._projection.endMs;
      if (endX === startX) return this._projection.total;
      const t = (x - startX) / (endX - startX);
      return t * this._projection.total;
    }
    // Touch: pin the tap so the overlay/tooltip survives finger-lift (see
    // lib/pointer-interaction.js). Mouse/pen: start a drag-to-zoom gesture —
    // recorded in time-domain (ms), not pixel space, so an in-progress drag
    // survives a window resize instead of going stale.
    _onPointerDown(e) {
      if (e.pointerType === "touch") {
        this._pointerPin.pin();
        this._onPointerMove(e);
        return;
      }
      if (e.pointerType !== "mouse" || !this._svgEl || !this._chartBounds || !this._series) {
        return;
      }
      const rect = this._svgEl.getBoundingClientRect();
      const relX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const viewBoxX = relX * this._chartBounds.width;
      this._dragStartMs = this._viewBoxXToMs(viewBoxX);
      this._dragging = true;
      this._chartEl.setPointerCapture(e.pointerId);
      if (this._hoverLine) this._hoverLine.setAttribute("visibility", "hidden");
      if (this._hoverDot) this._hoverDot.setAttribute("visibility", "hidden");
      if (this._scrubHandle) this._scrubHandle.setAttribute("visibility", "hidden");
      if (this._tooltipEl) this._tooltipEl.hidden = true;
    }
    _onPointerMove(e) {
      if (this._dragging && e.pointerType === "mouse") {
        this._updateDragSelection(e);
        return;
      }
      if (!this._series || !this._svgEl || !this._chartBounds || !this._pointerPin.shouldUpdateOnMove(e)) {
        return;
      }
      const showActual = !this._hiddenSeries.has("actual");
      const showProjected = !this._hiddenSeries.has("projected") && this._projection != null;
      if (!showActual && !showProjected) {
        this._onPointerLeave(e);
        return;
      }
      const rect = this._svgEl.getBoundingClientRect();
      const { width, height, padBottom, dataMaxX, domainMaxX } = this._chartBounds;
      const relX = (e.clientX - rect.left) / rect.width;
      const viewBoxX = relX * width;
      const targetX = Math.min(this._viewBoxXToMs(viewBoxX), domainMaxX);
      const beyondRealData = targetX > dataMaxX;
      let px, py, headerX, rows;
      if (showActual && !beyondRealData) {
        let nearest = this._series[0];
        let nearestDist = Infinity;
        for (const point of this._series) {
          const dist = Math.abs(point.x - targetX);
          if (dist < nearestDist) {
            nearestDist = dist;
            nearest = point;
          }
        }
        px = this._scaleX(nearest.x);
        py = this._scaleY(nearest.y);
        headerX = nearest.x;
        rows = `<div class="tooltip-row"><span class="tooltip-dot" style="background:var(--primary-color)"></span>Grid Cost: ${this._formatCurrency(nearest.y)}</div>`;
        if (showProjected && nearest.x <= this._projection.endMs) {
          rows += `<div class="tooltip-row"><span class="tooltip-dot" style="background:var(--warning-color)"></span>Projected: ${this._formatCurrency(this._projectedValueAt(nearest.x))}</div>`;
        }
      } else if (showProjected) {
        const startX = this._periodStartMs ?? this._chartBounds.dataMinX;
        const clampedX = Math.max(startX, Math.min(targetX, this._projection.endMs));
        const projY = this._projectedValueAt(clampedX);
        px = this._scaleX(clampedX);
        py = this._scaleY(projY);
        headerX = clampedX;
        rows = `<div class="tooltip-row"><span class="tooltip-dot" style="background:var(--warning-color)"></span>Projected: ${this._formatCurrency(projY)}</div>`;
      } else {
        this._onPointerLeave(e);
        return;
      }
      this._hoverLine.setAttribute("x1", px);
      this._hoverLine.setAttribute("x2", px);
      this._hoverLine.setAttribute("visibility", "visible");
      this._hoverDot.setAttribute("cx", px);
      this._hoverDot.setAttribute("cy", py);
      this._hoverDot.setAttribute("visibility", "visible");
      if (this._scrubHandle) {
        if (e.pointerType === "touch") {
          this._scrubHandle.setAttribute("cx", px);
          this._scrubHandle.setAttribute("cy", (height - padBottom).toFixed(1));
          this._scrubHandle.setAttribute("visibility", "visible");
        } else {
          this._scrubHandle.setAttribute("visibility", "hidden");
        }
      }
      this._tooltipEl.hidden = false;
      this._tooltipEl.innerHTML = `
      <div class="tooltip-header">${this._formatTime(headerX)}</div>
      ${rows}
    `;
      this._tooltipEl.style.left = `${px / width * rect.width}px`;
      this._tooltipEl.style.top = `${py / height * rect.height}px`;
    }
    // Touch: leave the tap pinned — do not clear on lift. Mouse: finish the
    // drag-to-zoom gesture — below the pixel threshold is treated as a plain
    // click (no zoom), otherwise commits this._zoomRange and re-renders.
    _onPointerUp(e) {
      if (e.pointerType === "touch") {
        return;
      }
      if (e.pointerType !== "mouse" || !this._dragging) {
        return;
      }
      this._dragging = false;
      if (this._chartEl.hasPointerCapture && this._chartEl.hasPointerCapture(e.pointerId)) {
        this._chartEl.releasePointerCapture(e.pointerId);
      }
      this._hideDragSelection();
      const dragStartMs = this._dragStartMs;
      this._dragStartMs = void 0;
      if (dragStartMs == null || !this._svgEl || !this._chartBounds || !this._series) {
        return;
      }
      const rect = this._svgEl.getBoundingClientRect();
      const relX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const viewBoxX = relX * this._chartBounds.width;
      const startPixelX = this._msToViewBoxX(dragStartMs);
      const pixelDelta = Math.abs(viewBoxX - startPixelX);
      if (pixelDelta < DRAG_ZOOM_THRESHOLD_PX) {
        return;
      }
      const endMsRaw = this._viewBoxXToMs(viewBoxX);
      let startMs = Math.min(dragStartMs, endMsRaw);
      let endMs = Math.max(dragStartMs, endMsRaw);
      const minSpan = this._minZoomSpanMs();
      if (endMs - startMs < minSpan) {
        const mid = (startMs + endMs) / 2;
        startMs = mid - minSpan / 2;
        endMs = mid + minSpan / 2;
      }
      const hasVisibleData = this._series.some((p) => p.x >= startMs && p.x <= endMs) || this._projection && this._projection.endMs >= startMs && this._projection.endMs <= endMs;
      if (!hasVisibleData) {
        return;
      }
      this._zoomRange = { startMs, endMs };
      this._renderChart(this._series, this._projection, this._periodStartMs);
    }
    // A cancelled gesture (e.g. an OS-level interruption) never commits a
    // zoom — just drop whatever drag was in progress. Touch's tap-pin state
    // is untouched here, matching _onPointerUp's touch branch.
    _onPointerCancel(e) {
      if (e.pointerType === "touch") {
        return;
      }
      if (this._dragging) {
        this._dragging = false;
        this._dragStartMs = void 0;
        this._hideDragSelection();
      }
    }
    _onPointerLeave(e) {
      if (!this._pointerPin.shouldClearOnLeave(e)) {
        return;
      }
      this._pointerPin.clear();
      if (this._hoverLine) this._hoverLine.setAttribute("visibility", "hidden");
      if (this._hoverDot) this._hoverDot.setAttribute("visibility", "hidden");
      if (this._scrubHandle) this._scrubHandle.setAttribute("visibility", "hidden");
      if (this._tooltipEl) this._tooltipEl.hidden = true;
    }
    // ms → viewBox-x and back, using the chart's current (possibly
    // zoomed) domain — shared by hover, drag-to-zoom start/end conversion,
    // and redrawing the drag-selection rect.
    _viewBoxXToMs(viewBoxX) {
      const { padLeft, padRight, width, domainMinX, domainMaxX } = this._chartBounds;
      return domainMinX + (viewBoxX - padLeft) / (width - padLeft - padRight) * (domainMaxX - domainMinX);
    }
    _msToViewBoxX(ms) {
      return this._scaleX(ms);
    }
    // A zoom narrower than a couple of real bucket steps isn't a meaningful
    // zoom on a per-bucket line chart — expand around the drag's midpoint
    // instead. Falls back to a flat few-hour floor when inferFixedStepMs
    // can't estimate a step (e.g. too few points yet).
    _minZoomSpanMs() {
      const step = inferFixedStepMs(this._series ? this._series.map((p) => p.x) : []);
      return step ? step * 2 : 3 * 60 * 60 * 1e3;
    }
    _updateDragSelection(e) {
      if (!this._zoomSelectRect || !this._svgEl || !this._chartBounds || this._dragStartMs == null) {
        return;
      }
      const rect = this._svgEl.getBoundingClientRect();
      const relX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const viewBoxX = relX * this._chartBounds.width;
      const startPixelX = this._msToViewBoxX(this._dragStartMs);
      const x1 = Math.min(startPixelX, viewBoxX);
      const x2 = Math.max(startPixelX, viewBoxX);
      const { padTop, padBottom, height } = this._chartBounds;
      this._zoomSelectRect.setAttribute("x", x1.toFixed(1));
      this._zoomSelectRect.setAttribute("y", padTop);
      this._zoomSelectRect.setAttribute("width", Math.max(x2 - x1, 0).toFixed(1));
      this._zoomSelectRect.setAttribute("height", (height - padTop - padBottom).toFixed(1));
      this._zoomSelectRect.setAttribute("visibility", "visible");
    }
    _hideDragSelection() {
      if (this._zoomSelectRect) this._zoomSelectRect.setAttribute("visibility", "hidden");
    }
    _clearZoom() {
      this._zoomRange = null;
      this._renderChart(this._series, this._projection, this._periodStartMs);
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
