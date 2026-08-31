// Energy Cost Breakdown Card
//
// Per-bucket grid cost — one bar per hour/day/month, whichever HA's own
// period-based bucketing already chose for the selected date range —
// as opposed to energy-cost-card.js's cumulative running total. Bucket
// granularity isn't detected here; it falls out for free from the
// shared collection's already-fetched statistics (hour buckets for a
// same-day range, day buckets for a month, month buckets for a year).
//
// Deliberately duplicates energy-cost-card.js's collection-attachment,
// cost-discovery (energy/get_prefs + energy/info), nice-axis-scale, and
// resize/SVG-sizing logic rather than sharing it. This is the second
// custom card in this directory, and per custom-cards/CLAUDE.md that's
// the documented trigger to add a bundler and extract shared modules —
// deliberately deferred to a separate session kept free of the context
// this one accumulated. Read CLAUDE.md before touching this file.

class EnergyCostBreakdownCard extends HTMLElement {
  setConfig(config) {
    this._config = config || {};

    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.innerHTML = `
        <style>
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

      this._resizeObserver = new ResizeObserver(() => {
        if (this._resizeFrame) {
          cancelAnimationFrame(this._resizeFrame);
        }
        this._resizeFrame = requestAnimationFrame(() => {
          this._resizeFrame = undefined;
          if (this._buckets) {
            this._renderChart(this._buckets);
          }
        });
      });
      this._resizeObserver.observe(this._chartEl);
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
      this._unsub = undefined;
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
      grid_min_rows: 3,
    };
  }

  _collectionKey() {
    const collectionKey = this._config.collection_key;
    if (collectionKey) {
      return `_${collectionKey}`;
    }
    if (this._hass?.panelUrl) {
      return `_energy_${this._hass.panelUrl}`;
    }
    return "_energy";
  }

  _attachToCollection() {
    if (!this._hass || !this._connected || this._unsub) {
      return;
    }

    const conn = this._hass.connection;
    const key = this._collectionKey();
    const collection = conn[key];

    if (!collection) {
      this._chartEl.innerHTML = `<div class="message">Waiting for an Energy date-selection card on this dashboard…</div>`;
      return;
    }

    this._unsub = collection.subscribe((data) => this._update(data));
  }

  async _update(data) {
    const prefs = data.prefs;
    const stats = data.stats;

    const info = await this._hass.callWS({ type: "energy/info" });
    const costSensors = info.cost_sensors || {};

    const costStatIds = (prefs.energy_sources || [])
      .filter((source) => source.type === "grid")
      .map((source) => source.stat_cost || costSensors[source.stat_energy_from])
      .filter(Boolean);

    if (!costStatIds.length) {
      this._chartEl.innerHTML = `<div class="message">No grid source has cost tracking configured yet (Settings → Dashboards → Energy).</div>`;
      this._totalEl.textContent = "";
      return;
    }

    // Sum every source's cost delta per bucket — each bucket stands alone
    // here (unlike energy-cost-card.js's running total), since this card
    // shows discrete per-period cost, not a cumulative trend.
    const costByBucketStart = new Map();
    for (const statId of costStatIds) {
      for (const point of stats[statId] || []) {
        if (point.change == null) continue;
        costByBucketStart.set(
          point.start,
          (costByBucketStart.get(point.start) || 0) + point.change
        );
      }
    }

    const buckets = [...costByBucketStart.keys()]
      .sort((a, b) => a - b)
      .map((start) => ({ x: start, y: costByBucketStart.get(start) }));

    const total = buckets.reduce((sum, b) => sum + b.y, 0);
    this._totalEl.textContent = this._formatCurrency(total);

    this._renderChart(buckets);
  }

  _formatCurrency(value, compact = false) {
    const symbol = this._config.currency_symbol || "R";
    const locale = this._hass?.locale?.language;
    const forceDecimal = compact && Math.abs(value) >= 1000;
    let number;
    try {
      number = new Intl.NumberFormat(locale, {
        notation: compact ? "compact" : "standard",
        maximumFractionDigits: compact ? 1 : 2,
        minimumFractionDigits: forceDecimal ? 1 : compact ? 0 : 2,
      }).format(value);
    } catch {
      number = value.toFixed(compact ? 0 : 2);
    }
    return `${symbol} ${number}`;
  }

  // Three tiers instead of energy-cost-card.js's two: this chart can span
  // a full year of monthly buckets, where a day-of-month label (e.g. "Aug
  // 1" repeated on every bucket) reads oddly — drop the day and show
  // "MMM 'YY" once buckets are month-sized, matching the original
  // apexcharts card's month labels ("Sep '25", "Dec '25", ...).
  _formatTime(timestamp) {
    const locale = this._hass?.locale?.language;
    const spanMs = this._chartBounds
      ? this._chartBounds.dataMaxX - this._chartBounds.dataMinX
      : 0;
    const dayMs = 24 * 60 * 60 * 1000;
    const date = new Date(timestamp);
    if (spanMs < 2 * dayMs) {
      return new Intl.DateTimeFormat(locale, {
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
    }
    if (spanMs < 60 * dayMs) {
      return new Intl.DateTimeFormat(locale, {
        month: "short",
        day: "numeric",
      }).format(date);
    }
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      year: "2-digit",
    }).format(date);
  }

  // Classic "nice numbers" axis algorithm (Heckbert) — see
  // energy-cost-card.js for the fuller explanation of why this replaced
  // a flat percentage headroom.
  _niceNumber(range, round) {
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

  _niceAxisScale(dataMax, targetTickCount) {
    const niceRange = this._niceNumber(dataMax, false);
    const tickSpacing = this._niceNumber(
      niceRange / Math.max(targetTickCount - 1, 1),
      true
    );
    const axisMax = Math.ceil(dataMax / tickSpacing) * tickSpacing;
    return { axisMax, tickSpacing };
  }

  _renderChart(buckets) {
    this._buckets = buckets;

    // Unlike a line (which needs 2 points for a segment), a single bar
    // is a perfectly meaningful chart on its own — only bail if there's
    // truly nothing to show.
    if (!buckets.length) {
      this._chartEl.innerHTML = `<div class="message">Not enough data yet for this period.</div>`;
      this._buckets = undefined;
      return;
    }

    const width = this._chartEl.clientWidth || 600;
    const height = this._chartEl.clientHeight || Math.max(width / 2, 200);
    const padLeft = 56;
    const padRight = 12;
    const padTop = 10;
    const padBottom = 24;

    const xs = buckets.map((b) => b.x);
    const dataMinX = Math.min(...xs);
    const dataMaxX = Math.max(...xs);
    const dataMaxY = Math.max(...buckets.map((b) => b.y), 0.0001);

    const { axisMax: domainMaxY, tickSpacing } = this._niceAxisScale(dataMaxY, 5);

    const plotLeft = padLeft;
    const plotWidth = width - padLeft - padRight;
    const slotWidth = plotWidth / buckets.length;
    const barWidth = Math.min(slotWidth * 0.6, 40);

    const scaleX = (i) => plotLeft + slotWidth * (i + 0.5);
    const scaleY = (y) =>
      height - padBottom - (y / domainMaxY) * (height - padTop - padBottom);

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
      plotLeft,
    };

    const bars = buckets
      .map((b, i) => {
        const cx = scaleX(i);
        const y = scaleY(b.y);
        const barHeight = height - padBottom - y;
        return `<rect x="${(cx - barWidth / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(barHeight, 0).toFixed(1)}" fill="var(--energy-grid-consumption-color, #dc7500)" rx="2"></rect>`;
      })
      .join("");

    // Solid gridlines at each clean tick-spacing multiple — matches
    // ha-chart-base's ~5-gridline splitNumber and its solid (non-dashed)
    // splitLine style.
    const tickCount = Math.round(domainMaxY / tickSpacing);
    const yGridlines = Array.from({ length: tickCount + 1 }, (_, i) => i * tickSpacing)
      .map((v) => {
        const y = scaleY(v).toFixed(1);
        return `
          <line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" stroke="var(--divider-color)" stroke-width="1"></line>
          <text x="${padLeft - 6}" y="${y}" text-anchor="end" dominant-baseline="middle" class="axis-label">${this._formatCurrency(v, true)}</text>
        `;
      })
      .join("");

    // Evenly spaced x labels rather than just first/middle/last — a bar
    // chart with 30 daily bars needs more reference points than a line
    // chart's 2-3 ticks to actually identify which bar is which day.
    const targetLabelCount = Math.min(6, buckets.length);
    const labelStep = Math.max(
      1,
      Math.round((buckets.length - 1) / Math.max(targetLabelCount - 1, 1))
    );
    const labelIndexes = [];
    for (let i = 0; i < buckets.length; i += labelStep) {
      labelIndexes.push(i);
    }
    if (labelIndexes[labelIndexes.length - 1] !== buckets.length - 1) {
      labelIndexes.push(buckets.length - 1);
    }
    const xTicks = labelIndexes
      .map((i) => {
        const anchor = i === 0 ? "start" : i === buckets.length - 1 ? "end" : "middle";
        return `<text x="${scaleX(i).toFixed(1)}" y="${height - 6}" text-anchor="${anchor}" class="axis-label">${this._formatTime(buckets[i].x)}</text>`;
      })
      .join("");

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
    const { width, height, plotLeft, slotWidth, padTop, padBottom, barWidth } =
      this._chartBounds;

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
    this._tooltipEl.textContent = `${this._formatTime(bucket.x)} — ${this._formatCurrency(bucket.y)}`;
    this._tooltipEl.style.left = `${(cx / width) * rect.width}px`;
    this._tooltipEl.style.top = `${(barY / height) * rect.height}px`;
  }

  _onPointerLeave() {
    if (this._hoverRect) this._hoverRect.setAttribute("visibility", "hidden");
    if (this._tooltipEl) this._tooltipEl.hidden = true;
  }
}

customElements.define("energy-cost-breakdown-card", EnergyCostBreakdownCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "energy-cost-breakdown-card",
  name: "Energy Cost Breakdown",
  description:
    "Per-bucket grid cost bars (hour/day/month depending on the Energy dashboard's selected period), synced to the date picker.",
});
