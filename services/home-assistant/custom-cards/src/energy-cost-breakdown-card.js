// Energy Cost Breakdown Card
//
// Per-bucket grid cost — one bar per hour/day/month, whichever HA's own
// period-based bucketing already chose for the selected date range —
// as opposed to energy-cost-card.js's cumulative running total. Bucket
// granularity isn't detected here; it falls out for free from the
// shared collection's already-fetched statistics (hour buckets for a
// same-day range, day buckets for a month, month buckets for a year).
//
// Shares collection-attachment, cost-stat discovery, per-bucket summing,
// axis scaling, and SVG sizing/resize infrastructure with
// energy-cost-card.js via ./lib — see ../CLAUDE.md "Minimizing
// duplication" for the boundary and why bar-vs-line rendering and hover
// stayed card-specific instead of being forced into one shared renderer.
//
// This file is compiled by esbuild (see ../package.json) — edit this
// source, not the generated ../energy-cost-breakdown-card.js.

import { CHART_CARD_STYLES } from "./lib/card-shell.js";
import { attachToEnergyCollection } from "./lib/energy-collection.js";
import { discoverGridCostStatIds, sumCostByBucket } from "./lib/energy-cost-sources.js";
import { niceAxisScale } from "./lib/nice-axis.js";
import { formatCurrency, formatTimeForSpan } from "./lib/format.js";
import { CHART_PADDING, measureChartBox, observeChartResize, renderYGridlines } from "./lib/svg-chart.js";
import { selectLabelIndexes } from "./lib/tick-labels.js";

class EnergyCostBreakdownCard extends HTMLElement {
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

  _attachToCollection() {
    if (!this._hass || !this._connected || this._unsub) {
      return;
    }

    this._unsub = attachToEnergyCollection(
      this._hass,
      this._config,
      (data) => this._update(data),
      () => {
        this._chartEl.innerHTML = `<div class="message">Waiting for an Energy date-selection card on this dashboard…</div>`;
      }
    );
  }

  async _update(data) {
    const prefs = data.prefs;
    const stats = data.stats;

    const costStatIds = await discoverGridCostStatIds(this._hass, prefs);

    if (!costStatIds.length) {
      this._chartEl.innerHTML = `<div class="message">No grid source has cost tracking configured yet (Settings → Dashboards → Energy).</div>`;
      this._totalEl.textContent = "";
      return;
    }

    // Each bucket stands alone here (unlike energy-cost-card.js's running
    // total), since this card shows discrete per-period cost, not a
    // cumulative trend.
    const costByBucketStart = sumCostByBucket(stats, costStatIds);

    const buckets = [...costByBucketStart.keys()]
      .sort((a, b) => a - b)
      .map((start) => ({ x: start, y: costByBucketStart.get(start) }));

    // The running total already lives on energy-cost-card.js right next
    // to this card — repeating it here would just be the same number
    // twice. The highest single bucket is genuinely new information: the
    // bars make it easy to spot *that* one is tallest, but not its exact
    // value or which day/hour it was. Compute this after _renderChart (not
    // before) so _formatTime's sub-day/day/month tiering has this card's
    // real data span to work from.
    this._renderChart(buckets);

    if (buckets.length) {
      const highest = buckets.reduce((max, b) => (b.y > max.y ? b : max), buckets[0]);
      this._totalEl.textContent = `Highest: ${this._formatCurrency(highest.y)} (${this._formatTime(highest.x)})`;
    } else {
      this._totalEl.textContent = "";
    }
  }

  _formatCurrency(value, compact = false) {
    return formatCurrency(value, {
      symbol: this._config.currency_symbol || "R",
      locale: this._hass?.locale?.language,
      compact,
    });
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
    return formatTimeForSpan(timestamp, locale, spanMs, [
      { maxSpanMs: 2 * dayMs, options: { hour: "2-digit", minute: "2-digit" } },
      { maxSpanMs: 60 * dayMs, options: { month: "short", day: "numeric" } },
      { options: { month: "short", year: "2-digit" } },
    ]);
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

    const { width, height } = measureChartBox(this._chartEl);
    const { left: padLeft, right: padRight, top: padTop, bottom: padBottom } = CHART_PADDING;

    const xs = buckets.map((b) => b.x);
    const dataMinX = Math.min(...xs);
    const dataMaxX = Math.max(...xs);
    const dataMaxY = Math.max(...buckets.map((b) => b.y), 0.0001);

    const { axisMax: domainMaxY, tickSpacing } = niceAxisScale(dataMaxY, 5);

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

    const yGridlines = renderYGridlines({
      domainMaxY,
      tickSpacing,
      scaleY,
      padLeft,
      width,
      padRight,
      formatValue: (v) => this._formatCurrency(v, true),
    });

    // Evenly spaced x labels rather than just first/middle/last — a bar
    // chart with 30 daily bars needs more reference points than a line
    // chart's few ticks to actually identify which bar is which day.
    const labelIndexes = selectLabelIndexes(buckets.length, 6);
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
