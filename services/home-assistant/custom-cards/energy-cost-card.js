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
          :host { display: block; }
          ha-card { padding: 16px; }
          .header {
            font-size: 1rem;
            font-weight: 500;
            color: var(--primary-text-color);
            margin-bottom: 8px;
          }
          .total {
            font-size: 1.6rem;
            font-weight: 500;
            color: var(--primary-text-color);
            margin-bottom: 8px;
          }
          .chart { position: relative; }
          .chart svg { width: 100%; height: 220px; display: block; }
          .axis-label {
            font-size: 10px;
            fill: var(--secondary-text-color);
          }
          .tooltip {
            position: absolute;
            transform: translate(-50%, -100%) translateY(-6px);
            background: var(--card-background-color, #1c1c1c);
            border: 1px solid var(--divider-color);
            border-radius: 4px;
            padding: 4px 8px;
            font-size: 0.8rem;
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

    this._headerEl = this.shadowRoot.querySelector(".header");
    this._totalEl = this.shadowRoot.querySelector(".total");
    this._chartEl = this.shadowRoot.querySelector(".chart");
    this._headerEl.textContent = this._config.title || "Grid Cost";

    this._chartEl.addEventListener("pointermove", (e) => this._onPointerMove(e));
    this._chartEl.addEventListener("pointerleave", () => this._onPointerLeave());

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
    return 3;
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

  _formatCurrency(value, compact = false) {
    const currency = this._config.currency || "ZAR";
    const locale = this._hass?.locale?.language;
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        notation: compact ? "compact" : "standard",
        maximumFractionDigits: compact ? 0 : 2,
      }).format(value);
    } catch {
      return value.toFixed(2);
    }
  }

  // Sub-day ranges (the "Today" picker) get hour:minute labels; anything
  // longer gets a short date, since a time-of-day label on a month-long
  // range would be meaningless.
  _formatTime(timestamp) {
    const locale = this._hass?.locale?.language;
    const spanMs = this._chartBounds
      ? this._chartBounds.maxX - this._chartBounds.minX
      : 0;
    const isSubDay = spanMs < 2 * 24 * 60 * 60 * 1000;
    return new Intl.DateTimeFormat(
      locale,
      isSubDay
        ? { hour: "2-digit", minute: "2-digit" }
        : { month: "short", day: "numeric" }
    ).format(new Date(timestamp));
  }

  _renderChart(series) {
    this._series = series;

    if (series.length < 2) {
      this._chartEl.innerHTML = `<div class="message">Not enough data yet for this period.</div>`;
      this._series = undefined;
      return;
    }

    const width = 600;
    const height = 220;
    const padLeft = 56;
    const padRight = 8;
    const padTop = 10;
    const padBottom = 24;

    const xs = series.map((p) => p.x);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...series.map((p) => p.y), 0.0001);

    const scaleX = (x) =>
      padLeft + ((x - minX) / (maxX - minX || 1)) * (width - padLeft - padRight);
    const scaleY = (y) =>
      height - padBottom - (y / maxY) * (height - padTop - padBottom);

    this._scaleX = scaleX;
    this._scaleY = scaleY;
    this._chartBounds = { width, height, padLeft, padRight, padTop, padBottom, minX, maxX, maxY };

    const linePoints = series
      .map((p) => `${scaleX(p.x).toFixed(1)},${scaleY(p.y).toFixed(1)}`)
      .join(" ");
    const areaPoints = `${scaleX(minX).toFixed(1)},${height - padBottom} ${linePoints} ${scaleX(
      maxX
    ).toFixed(1)},${height - padBottom}`;

    // 3 gridlines (0 / half / max) — a "nice round numbers" axis algorithm
    // would be overkill for a small embedded-card chart.
    const yGridlines = [0, maxY / 2, maxY]
      .map((v) => {
        const y = scaleY(v).toFixed(1);
        return `
          <line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" stroke="var(--divider-color)" stroke-width="1"></line>
          <text x="${padLeft - 6}" y="${y}" text-anchor="end" dominant-baseline="middle" class="axis-label">${this._formatCurrency(v, true)}</text>
        `;
      })
      .join("");

    const xTickIndexes = [...new Set([0, Math.floor((series.length - 1) / 2), series.length - 1])];
    const xTicks = xTickIndexes
      .map((i) => {
        const p = series[i];
        const x = scaleX(p.x).toFixed(1);
        return `<text x="${x}" y="${height - 6}" text-anchor="middle" class="axis-label">${this._formatTime(p.x)}</text>`;
      })
      .join("");

    this._chartEl.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
        ${yGridlines}
        <polygon points="${areaPoints}" fill="var(--primary-color)" opacity="0.25"></polygon>
        <polyline points="${linePoints}" fill="none" stroke="var(--primary-color)" stroke-width="2"></polyline>
        ${xTicks}
        <line class="hover-line" x1="0" y1="${padTop}" x2="0" y2="${height - padBottom}" stroke="var(--secondary-text-color)" stroke-width="1" stroke-dasharray="3,3" visibility="hidden"></line>
        <circle class="hover-dot" r="4" fill="var(--primary-color)" visibility="hidden"></circle>
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
    const { width, height, padLeft, padRight, minX, maxX } = this._chartBounds;

    const relX = (e.clientX - rect.left) / rect.width;
    const viewBoxX = relX * width;
    const targetX =
      minX + ((viewBoxX - padLeft) / (width - padLeft - padRight)) * (maxX - minX);

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
