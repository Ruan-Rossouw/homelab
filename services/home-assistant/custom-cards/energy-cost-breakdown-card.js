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
  function selectLabelIndexesForTimestamps(itemTimestamps, startMs, endMs, count) {
    const indexes = selectEvenTimestamps(startMs, endMs, count).map((target) => {
      let nearest = 0;
      let nearestDist = Infinity;
      for (let i = 0; i < itemTimestamps.length; i++) {
        const dist = Math.abs(itemTimestamps[i] - target);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = i;
        }
      }
      return nearest;
    });
    return [...new Set(indexes)];
  }
  function inferFixedStepMs(sortedTimestamps) {
    if (sortedTimestamps.length < 2) return void 0;
    const step = sortedTimestamps[1] - sortedTimestamps[0];
    return step > 0 && step <= 24 * 60 * 60 * 1e3 ? step : void 0;
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
          <div class="chart"></div>
        </ha-card>
      `;
      }
      const firstRender = !this._headerEl;
      this._headerEl = this.shadowRoot.querySelector(".header");
      this._chartEl = this.shadowRoot.querySelector(".chart");
      this._headerEl.hidden = !this._config.title;
      this._headerEl.textContent = this._config.title || "";
      if (firstRender) {
        this._pointerPin = createPointerPin();
        this._zoomRange = null;
        this._dragging = false;
        this._chartEl.addEventListener("pointerdown", (e) => this._onPointerDown(e));
        this._chartEl.addEventListener("pointermove", (e) => this._onPointerMove(e));
        this._chartEl.addEventListener("pointerup", (e) => this._onPointerUp(e));
        this._chartEl.addEventListener("pointercancel", (e) => this._onPointerCancel(e));
        this._chartEl.addEventListener("pointerleave", (e) => this._onPointerLeave(e));
        this._resizeObserver = observeChartResize(this._chartEl, () => {
          if (this._buckets) {
            this._renderChart(this._buckets, this._periodStartMs, this._periodEndMs);
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
        return;
      }
      const costByBucketStart = sumCostByBucket(stats, costStatIds);
      const buckets = [...costByBucketStart.keys()].sort((a, b) => a - b).map((start) => ({ x: start, y: costByBucketStart.get(start) }));
      const step = inferFixedStepMs(buckets.map((b) => b.x));
      if (step && data.end) {
        const periodEndMs2 = data.end.getTime();
        let nextStart = buckets[buckets.length - 1].x + step;
        while (nextStart < periodEndMs2) {
          buckets.push({ x: nextStart, y: 0 });
          nextStart += step;
        }
      }
      const periodStartMs = data.start ? data.start.getTime() : void 0;
      const periodEndMs = data.end ? data.end.getTime() : void 0;
      if (this._zoomRange && (periodStartMs !== this._periodStartMs || periodEndMs !== this._periodEndMs)) {
        this._zoomRange = null;
      }
      this._renderChart(buckets, periodStartMs, periodEndMs);
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
    // formats and what's deliberately not replicated. Unlike
    // energy-cost-card.js, this card's dataMinX/dataMaxX (from
    // `_chartBounds`, derived from `renderBuckets`) already reflect the full
    // plotted domain and don't need a separate domain span: `_update()`
    // tail-pads `buckets` with zero-cost placeholders out to the period's
    // true end before `_renderChart` ever runs, and `renderBuckets` narrows
    // to the zoomed subset when zoomed — so this span was already correct
    // (this card never had the projection-domain bug energy-cost-card.js
    // did, since it has no projection concept extending its domain past its
    // own data).
    _formatTime(timestamp) {
      const locale = this._hass?.locale?.language;
      const spanMs = this._chartBounds ? this._chartBounds.dataMaxX - this._chartBounds.dataMinX : 0;
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
    _renderChart(buckets, periodStartMs, periodEndMs) {
      this._buckets = buckets;
      this._periodStartMs = periodStartMs;
      this._periodEndMs = periodEndMs;
      if (!buckets.length) {
        this._chartEl.innerHTML = `<div class="message">Not enough data yet for this period.</div>`;
        this._buckets = void 0;
        this._visibleBuckets = void 0;
        return;
      }
      let renderBuckets = buckets;
      if (this._zoomRange) {
        const filtered = buckets.filter((b) => b.x >= this._zoomRange.startMs && b.x <= this._zoomRange.endMs);
        if (filtered.length) {
          renderBuckets = filtered;
        } else {
          this._zoomRange = null;
        }
      }
      this._visibleBuckets = renderBuckets;
      const { width, height } = measureChartBox(this._chartEl);
      const { left: padLeft, right: padRight, top: padTop, bottom: padBottom } = CHART_PADDING;
      const xs = renderBuckets.map((b) => b.x);
      const dataMinX = Math.min(...xs);
      const dataMaxX = Math.max(...xs);
      const dataMaxY = Math.max(...renderBuckets.map((b) => b.y), 1e-4);
      const { axisMax: domainMaxY, tickSpacing } = niceAxisScale(dataMaxY, 5);
      const plotLeft = padLeft;
      const plotWidth = width - padLeft - padRight;
      const slotWidth = plotWidth / renderBuckets.length;
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
      const bars = renderBuckets.map((b, i) => {
        const cx = scaleX(i);
        const barTop = scaleY(b.y);
        const barBottom = height - padBottom;
        const barHeight = Math.max(barBottom - barTop, 0);
        if (barHeight <= 0) {
          return "";
        }
        const barLeft = cx - barWidth / 2;
        const barRight = cx + barWidth / 2;
        const r = Math.min(4, barHeight / 2, barWidth / 2);
        const path = `M ${barLeft.toFixed(1)},${(barTop + r).toFixed(1)} Q ${barLeft.toFixed(1)},${barTop.toFixed(1)} ${(barLeft + r).toFixed(1)},${barTop.toFixed(1)} L ${(barRight - r).toFixed(1)},${barTop.toFixed(1)} Q ${barRight.toFixed(1)},${barTop.toFixed(1)} ${barRight.toFixed(1)},${(barTop + r).toFixed(1)} L ${barRight.toFixed(1)},${barBottom.toFixed(1)} L ${barLeft.toFixed(1)},${barBottom.toFixed(1)} Z`;
        return `<path d="${path}" fill="var(--energy-grid-consumption-color, #dc7500)" fill-opacity="0.5" stroke="var(--energy-grid-consumption-color, #dc7500)" stroke-width="1.5"></path>`;
      }).join("");
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
      const tickStartMs = this._zoomRange ? this._zoomRange.startMs : periodStartMs ?? dataMinX;
      const tickEndMs = this._zoomRange ? this._zoomRange.endMs : periodEndMs ?? dataMaxX;
      const labelIndexes = selectLabelIndexesForTimestamps(xs, tickStartMs, tickEndMs, DEFAULT_TICK_COUNT);
      const xTicks = labelIndexes.map((i) => {
        const anchor = i === 0 ? "start" : i === renderBuckets.length - 1 ? "end" : "middle";
        return `<text x="${scaleX(i).toFixed(1)}" y="${height - 6}" text-anchor="${anchor}" class="axis-label">${this._formatTime(renderBuckets[i].x)}</text>`;
      }).join("");
      const xGridlines = renderXGridlines({
        tickXs: labelIndexes.map((i) => scaleX(i)),
        padTop,
        padBottom,
        height
      });
      this._chartEl.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" style="height: ${height}px;" preserveAspectRatio="none">
        ${yGridlines}
        ${xGridlines}
        ${bars}
        ${xTicks}
        <line class="hover-line" x1="0" y1="${padTop}" x2="0" y2="${height - padBottom}" stroke="var(--info-color)" stroke-width="1" stroke-dasharray="3,3" visibility="hidden"></line>
        <circle class="scrub-handle" r="10" fill="var(--primary-color)" visibility="hidden"></circle>
        <rect class="zoom-select-rect" fill="var(--info-color)" opacity="0.15" visibility="hidden"></rect>
      </svg>
      <div class="tooltip" hidden></div>
      <button type="button" class="zoom-reset" ${this._zoomRange ? "" : "hidden"}>Reset zoom</button>
    `;
      this._svgEl = this._chartEl.querySelector("svg");
      this._hoverLine = this._chartEl.querySelector(".hover-line");
      this._scrubHandle = this._chartEl.querySelector(".scrub-handle");
      this._zoomSelectRect = this._chartEl.querySelector(".zoom-select-rect");
      this._tooltipEl = this._chartEl.querySelector(".tooltip");
      this._resetEl = this._chartEl.querySelector(".zoom-reset");
      this._resetEl.addEventListener("click", () => this._clearZoom());
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
      if (e.pointerType !== "mouse" || !this._svgEl || !this._chartBounds || !this._visibleBuckets) {
        return;
      }
      const rect = this._svgEl.getBoundingClientRect();
      const relX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const viewBoxX = relX * this._chartBounds.width;
      this._dragStartMs = this._viewBoxXToMs(viewBoxX);
      this._dragging = true;
      this._chartEl.setPointerCapture(e.pointerId);
      if (this._hoverLine) this._hoverLine.setAttribute("visibility", "hidden");
      if (this._scrubHandle) this._scrubHandle.setAttribute("visibility", "hidden");
      if (this._tooltipEl) this._tooltipEl.hidden = true;
    }
    _onPointerMove(e) {
      if (this._dragging && e.pointerType === "mouse") {
        this._updateDragSelection(e);
        return;
      }
      if (!this._visibleBuckets || !this._svgEl || !this._chartBounds || !this._pointerPin.shouldUpdateOnMove(e)) {
        return;
      }
      const rect = this._svgEl.getBoundingClientRect();
      const { width, height, padBottom } = this._chartBounds;
      const relX = (e.clientX - rect.left) / rect.width;
      const viewBoxX = relX * width;
      const index = this._indexForViewBoxX(viewBoxX);
      const bucket = this._visibleBuckets[index];
      const cx = this._scaleX(index);
      const barY = this._scaleY(bucket.y);
      if (this._hoverLine) {
        this._hoverLine.setAttribute("x1", cx.toFixed(1));
        this._hoverLine.setAttribute("x2", cx.toFixed(1));
        this._hoverLine.setAttribute("visibility", "visible");
      }
      if (this._scrubHandle) {
        if (e.pointerType === "touch") {
          this._scrubHandle.setAttribute("cx", cx.toFixed(1));
          this._scrubHandle.setAttribute("cy", (height - padBottom).toFixed(1));
          this._scrubHandle.setAttribute("visibility", "visible");
        } else {
          this._scrubHandle.setAttribute("visibility", "hidden");
        }
      }
      this._tooltipEl.hidden = false;
      this._tooltipEl.innerHTML = `
      <div class="tooltip-header">${this._formatTime(bucket.x)}</div>
      <div class="tooltip-row"><span class="tooltip-dot" style="background:var(--energy-grid-consumption-color, #dc7500)"></span>${this._formatCurrency(bucket.y)}</div>
    `;
      this._tooltipEl.style.left = `${cx / width * rect.width}px`;
      this._tooltipEl.style.top = `${barY / height * rect.height}px`;
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
      if (dragStartMs == null || !this._svgEl || !this._chartBounds || !this._visibleBuckets) {
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
      const filtered = this._buckets.filter((b) => b.x >= startMs && b.x <= endMs);
      if (!filtered.length) {
        return;
      }
      this._zoomRange = { startMs, endMs };
      this._renderChart(this._buckets, this._periodStartMs, this._periodEndMs);
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
      if (this._scrubHandle) this._scrubHandle.setAttribute("visibility", "hidden");
      if (this._tooltipEl) this._tooltipEl.hidden = true;
    }
    // Slot index (nearest visible bucket) for a viewBox-space x coordinate —
    // shared by hover and the drag-to-zoom start/end conversion below.
    _indexForViewBoxX(viewBoxX) {
      const { plotLeft, slotWidth } = this._chartBounds;
      const index = Math.floor((viewBoxX - plotLeft) / slotWidth);
      return Math.max(0, Math.min(this._visibleBuckets.length - 1, index));
    }
    _viewBoxXToMs(viewBoxX) {
      return this._visibleBuckets[this._indexForViewBoxX(viewBoxX)].x;
    }
    // Inverse of the above: nearest visible bucket to a timestamp, mapped
    // forward through the current (possibly just-resized) scale — used to
    // redraw the drag-selection rect and to re-derive the drag start's pixel
    // position at pointerup without having stored it directly.
    _msToViewBoxX(ms) {
      let nearest = 0;
      let nearestDist = Infinity;
      for (let i = 0; i < this._visibleBuckets.length; i++) {
        const dist = Math.abs(this._visibleBuckets[i].x - ms);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = i;
        }
      }
      return this._scaleX(nearest);
    }
    // A zoom narrower than ~2 buckets isn't a meaningful zoom — expand
    // around the drag's midpoint instead. Falls back to a flat 2-day floor
    // for month-bucketed year views, whose variable-length buckets
    // inferFixedStepMs deliberately won't estimate a step for.
    _minZoomSpanMs() {
      const step = inferFixedStepMs(this._buckets.map((b) => b.x));
      return step ? step * 2 : 2 * 24 * 60 * 60 * 1e3;
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
      this._renderChart(this._buckets, this._periodStartMs, this._periodEndMs);
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
