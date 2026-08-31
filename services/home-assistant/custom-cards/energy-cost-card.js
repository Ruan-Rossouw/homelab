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
          .chart svg { width: 100%; height: auto; display: block; }
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

  _formatCurrency(value) {
    const currency = this._config.currency || "ZAR";
    const locale = this._hass?.locale?.language;
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
      }).format(value);
    } catch {
      return value.toFixed(2);
    }
  }

  _renderChart(series) {
    if (series.length < 2) {
      this._chartEl.innerHTML = `<div class="message">Not enough data yet for this period.</div>`;
      return;
    }

    const width = 600;
    const height = 200;
    const pad = 8;

    const xs = series.map((p) => p.x);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...series.map((p) => p.y), 0.0001);

    const scaleX = (x) =>
      pad + ((x - minX) / (maxX - minX || 1)) * (width - 2 * pad);
    const scaleY = (y) => height - pad - (y / maxY) * (height - 2 * pad);

    const linePoints = series
      .map((p) => `${scaleX(p.x).toFixed(1)},${scaleY(p.y).toFixed(1)}`)
      .join(" ");
    const areaPoints = `${scaleX(minX).toFixed(1)},${height - pad} ${linePoints} ${scaleX(
      maxX
    ).toFixed(1)},${height - pad}`;

    this._chartEl.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
        <polygon points="${areaPoints}" fill="var(--primary-color)" opacity="0.25"></polygon>
        <polyline points="${linePoints}" fill="none" stroke="var(--primary-color)" stroke-width="2"></polyline>
      </svg>
    `;
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
