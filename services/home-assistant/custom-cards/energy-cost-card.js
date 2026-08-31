// Energy Cost Card
//
// Cumulative grid cost so far, summed across every "grid" source
// configured in the HA Energy dashboard, with no hardcoded entity IDs and
// no helper entities (Group/Utility Meter) of any kind.
//
// Source discovery: reads `energy/get_prefs` (the same data the native
// energy-* cards use) and collects each grid source's `stat_cost` field —
// the cost statistic HA auto-generates once a price is configured on that
// source. Add or remove a grid source in Energy settings and this card's
// input list changes with it automatically.
//
// Date range: does NOT implement its own picker. It attaches to the exact
// same shared data collection that `energy-date-selection` drives
// (cached on `hass.connection`, the same object instance every native
// energy-* card subscribes to), so it always reflects whatever range is
// selected there. This card is not useful on its own — pair it with an
// `energy-date-selection` card on the same dashboard view.

class EnergyCostCard extends HTMLElement {
  setConfig(config) {
    this._config = config || {};

    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.innerHTML = `
        <style>
          /* Sections-view gives this card a fixed-height box via
             grid_rows and clips anything taller — unlike masonry view,
             it never grows to fit content. So the card fills whatever
             height it's given (flex column) rather than dictating its
             own from a width formula. */
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
            /* Literal font stack, matching ha-chart-base.ts exactly — HA
               doesn't use a CSS variable for this, so neither do we. */
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
    this._headerEl.textContent = this._config.title || "Grid Cost";

    if (firstRender) {
      this._chartEl.addEventListener("pointermove", (e) => this._onPointerMove(e));
      this._chartEl.addEventListener("pointerleave", () => this._onPointerLeave());

      // The chart's viewBox width is measured from this element (see
      // _renderChart) so text isn't stretched non-uniformly under
      // preserveAspectRatio="none" — re-render on width changes (sidebar
      // toggle, column count change) so that stays accurate. Coalesced
      // through rAF so a continuous drag-resize doesn't re-render dozens
      // of times a second.
      this._resizeObserver = new ResizeObserver(() => {
        if (this._resizeFrame) {
          cancelAnimationFrame(this._resizeFrame);
        }
        this._resizeFrame = requestAnimationFrame(() => {
          this._resizeFrame = undefined;
          if (this._series) {
            this._renderChart(this._series);
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
      grid_min_rows: 3,
    };
  }

  // Same key derivation as home-assistant-frontend's
  // convertCollectionKeyToConnection, so we land on the exact cache slot
  // energy-date-selection uses on hass.connection.
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
      // Nothing to attach to yet — most likely an energy-date-selection
      // card on this view hasn't finished mounting/creating it. set hass
      // fires again shortly; try again then rather than building our own
      // fallback collection.
      this._chartEl.innerHTML = `<div class="message">Waiting for an Energy date-selection card on this dashboard…</div>`;
      return;
    }

    this._unsub = collection.subscribe((data) => this._update(data));
  }

  async _update(data) {
    const prefs = data.prefs;
    const stats = data.stats;

    // source.stat_cost (energy/get_prefs) is only populated when a source
    // points directly at a pre-existing cost-tracking entity. When cost is
    // derived from a price entity/static price (our case), the generated
    // cost stat only shows up in energy/info's cost_sensors map, keyed by
    // the consumption stat_id — same lookup the native cards use.
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

    // Merge every source's per-bucket delta into one summed series, then
    // turn deltas into a running total — this is the "Bill So Far" shape.
    const deltaByBucketStart = new Map();
    for (const statId of costStatIds) {
      for (const point of stats[statId] || []) {
        if (point.change == null) continue;
        deltaByBucketStart.set(
          point.start,
          (deltaByBucketStart.get(point.start) || 0) + point.change
        );
      }
    }

    const bucketStarts = [...deltaByBucketStart.keys()].sort((a, b) => a - b);
    let runningTotal = 0;
    const series = bucketStarts.map((start) => {
      runningTotal += deltaByBucketStart.get(start);
      return { x: start, y: runningTotal };
    });

    this._totalEl.textContent = this._formatCurrency(runningTotal);
    this._renderChart(series);
  }

  // Intl's currency style prints the ISO code ("ZAR") unless the active
  // locale has its own localized formatting for that currency baked in —
  // not reliable across HA installs/languages, so the symbol is plain
  // config instead: format just the number (still locale-aware for
  // decimal/grouping separators) and prefix our own symbol.
  _formatCurrency(value, compact = false) {
    const symbol = this._config.currency_symbol || "R";
    const locale = this._hass?.locale?.language;
    let number;
    try {
      number = new Intl.NumberFormat(locale, {
        notation: compact ? "compact" : "standard",
        // 0 fraction digits on compact axis labels collapses distinct
        // gridline values (1500 and 2000 both print as "2K") — 1 digit
        // keeps them distinguishable (1.5K vs 2K).
        maximumFractionDigits: compact ? 1 : 2,
        minimumFractionDigits: compact ? 0 : 2,
      }).format(value);
    } catch {
      number = value.toFixed(compact ? 0 : 2);
    }
    return `${symbol} ${number}`;
  }

  // Sub-day ranges (the "Today" picker) get hour:minute labels; anything
  // longer gets a short date, since a time-of-day label on a month-long
  // range would be meaningless. Based on the real data span, not the
  // padded plotting domain.
  _formatTime(timestamp) {
    const locale = this._hass?.locale?.language;
    const spanMs = this._chartBounds
      ? this._chartBounds.dataMaxX - this._chartBounds.dataMinX
      : 0;
    const isSubDay = spanMs < 2 * 24 * 60 * 60 * 1000;
    return new Intl.DateTimeFormat(
      locale,
      isSubDay
        ? { hour: "2-digit", minute: "2-digit" }
        : { month: "short", day: "numeric" }
    ).format(new Date(timestamp));
  }

  // Rounds a raw axis max up to a "clean" step (1/2/5/10 × a power of ten)
  // times segmentCount, the same class of algorithm ECharts uses — this is
  // what gives native charts their headroom (a round number above the
  // actual peak) rather than a flat percentage padding.
  _niceAxisMax(rawMax, segmentCount) {
    if (rawMax <= 0) return segmentCount;
    const roughStep = rawMax / segmentCount;
    const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
    const residual = roughStep / magnitude;
    let niceStep;
    if (residual > 5) niceStep = 10 * magnitude;
    else if (residual > 2) niceStep = 5 * magnitude;
    else if (residual > 1) niceStep = 2 * magnitude;
    else niceStep = magnitude;
    return niceStep * segmentCount;
  }

  _renderChart(series) {
    this._series = series;

    if (series.length < 2) {
      this._chartEl.innerHTML = `<div class="message">Not enough data yet for this period.</div>`;
      this._series = undefined;
      return;
    }

    // Match the viewBox to the container's real pixel box so the
    // coordinate system is 1:1 with CSS pixels on both axes — otherwise
    // preserveAspectRatio="none" stretches X and Y independently, and
    // that distorts text glyphs (they end up looking squashed) along
    // with the plotted lines.
    //
    // Height prefers the container's actual measured height (the .chart
    // div fills whatever box Sections-view's grid_rows gives it, via
    // flex) over a width-derived formula — Sections view clips content
    // taller than its declared row box rather than growing to fit it,
    // unlike masonry view where a width-based height works fine because
    // the card's real height *is* the layout. Falls back to that
    // formula only if the container hasn't been given a real height
    // (e.g. masonry view, or before first layout).
    const width = this._chartEl.clientWidth || 600;
    const height = this._chartEl.clientHeight || Math.max(width / 2, 200);
    const padLeft = 56;
    const padRight = 12;
    const padTop = 10;
    const padBottom = 24;

    const xs = series.map((p) => p.x);
    const dataMinX = Math.min(...xs);
    const dataMaxX = Math.max(...xs);
    const dataMaxY = Math.max(...series.map((p) => p.y), 0.0001);

    // Small right-hand pad so the line doesn't run flush to the edge; Y
    // headroom instead comes from rounding up to a nice axis max (below).
    const domainMinX = dataMinX;
    const domainMaxX = dataMaxX + (dataMaxX - dataMinX || 1) * 0.04;
    const domainMaxY = this._niceAxisMax(dataMaxY, 4);

    const scaleX = (x) =>
      padLeft +
      ((x - domainMinX) / (domainMaxX - domainMinX || 1)) *
        (width - padLeft - padRight);
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
      domainMinX,
      domainMaxX,
      domainMaxY,
    };

    const linePoints = series
      .map((p) => `${scaleX(p.x).toFixed(1)},${scaleY(p.y).toFixed(1)}`)
      .join(" ");
    const areaPoints = `${scaleX(dataMinX).toFixed(1)},${height - padBottom} ${linePoints} ${scaleX(
      dataMaxX
    ).toFixed(1)},${height - padBottom}`;

    // 5 gridlines, solid — matches ha-chart-base's splitNumber: 5 and its
    // solid (non-dashed) splitLine style.
    const yGridlines = [0, 1, 2, 3, 4]
      .map((i) => (domainMaxY * i) / 4)
      .map((v) => {
        const y = scaleY(v).toFixed(1);
        return `
          <line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" stroke="var(--divider-color)" stroke-width="1"></line>
          <text x="${padLeft - 6}" y="${y}" text-anchor="end" dominant-baseline="middle" class="axis-label">${this._formatCurrency(v, true)}</text>
        `;
      })
      .join("");

    // First/middle/last tick, anchored start/middle/end respectively so the
    // outer two labels don't clip past the viewBox edges.
    const xTickIndexes = [...new Set([0, Math.floor((series.length - 1) / 2), series.length - 1])];
    const anchorFor = (i) => (i === 0 ? "start" : i === series.length - 1 ? "end" : "middle");
    const xTicks = xTickIndexes
      .map((i) => {
        const p = series[i];
        const x = scaleX(p.x).toFixed(1);
        return `<text x="${x}" y="${height - 6}" text-anchor="${anchorFor(i)}" class="axis-label">${this._formatTime(p.x)}</text>`;
      })
      .join("");

    this._chartEl.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" style="height: ${height}px;" preserveAspectRatio="none">
        ${yGridlines}
        <polygon points="${areaPoints}" fill="var(--primary-color)" opacity="0.25"></polygon>
        <polyline points="${linePoints}" fill="none" stroke="var(--primary-color)" stroke-width="2"></polyline>
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
    const targetX =
      domainMinX +
      ((viewBoxX - padLeft) / (width - padLeft - padRight)) *
        (domainMaxX - domainMinX);

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
    this._tooltipEl.textContent = `${this._formatTime(nearest.x)} — ${this._formatCurrency(nearest.y)}`;
    this._tooltipEl.style.left = `${(px / width) * rect.width}px`;
    this._tooltipEl.style.top = `${(py / height) * rect.height}px`;
  }

  _onPointerLeave() {
    if (this._hoverLine) this._hoverLine.setAttribute("visibility", "hidden");
    if (this._hoverDot) this._hoverDot.setAttribute("visibility", "hidden");
    if (this._tooltipEl) this._tooltipEl.hidden = true;
  }
}

customElements.define("energy-cost-card", EnergyCostCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "energy-cost-card",
  name: "Energy Cost (Combined Grid)",
  description:
    "Cumulative grid cost so far, summed across all configured grid sources, synced to the Energy dashboard's date picker.",
});
