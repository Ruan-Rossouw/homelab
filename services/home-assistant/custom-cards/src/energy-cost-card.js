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
//
// This file is compiled by esbuild (see ../package.json) — edit this
// source, not the generated ../energy-cost-card.js.

import { CHART_CARD_STYLES } from "./lib/card-shell.js";
import { attachToEnergyCollection } from "./lib/energy-collection.js";
import { discoverGridCostStatIds, sumCostByBucket } from "./lib/energy-cost-sources.js";
import { niceAxisScale } from "./lib/nice-axis.js";
import { formatCurrency, formatTimeForSpan } from "./lib/format.js";
import {
  CHART_PADDING,
  measureChartBox,
  observeChartResize,
  renderYGridlines,
  DRAG_ZOOM_THRESHOLD_PX,
} from "./lib/svg-chart.js";
import { selectEvenTimestamps, DEFAULT_TICK_COUNT, inferFixedStepMs, snapToStep } from "./lib/tick-labels.js";
import { createPointerPin } from "./lib/pointer-interaction.js";

class EnergyCostCard extends HTMLElement {
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
      this._pointerPin = createPointerPin();
      this._zoomRange = null;
      this._dragging = false;
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
      this._projectedEl.hidden = true;
      return;
    }

    // Merge every source's per-bucket delta into one summed series, then
    // turn deltas into a running total — this is the "Bill So Far" shape.
    const deltaByBucketStart = sumCostByBucket(stats, costStatIds);

    const bucketStarts = [...deltaByBucketStart.keys()].sort((a, b) => a - b);
    let runningTotal = 0;
    const series = bucketStarts.map((start) => {
      runningTotal += deltaByBucketStart.get(start);
      return { x: start, y: runningTotal };
    });

    this._totalEl.textContent = this._formatCurrency(runningTotal);

    const projection = this._computeProjection(data, series, runningTotal);
    // The header text is only meaningful as a forward-looking estimate —
    // for an already-elapsed period (e.g. "Yesterday"), projection.total
    // *is* runningTotal, so showing "Projected: R X" under the identical
    // "R X" total would just be a redundant duplicate.
    if (projection && projection.isEstimate) {
      this._projectedEl.hidden = false;
      this._projectedEl.textContent = `Projected: ${this._formatCurrency(projection.total)}`;
    } else {
      this._projectedEl.hidden = true;
    }

    const periodStartMs = data.start ? data.start.getTime() : undefined;
    // An active zoom's timestamps almost certainly don't make sense against
    // a completely different selected period — a live stats refresh for
    // the *same* period should leave the zoom alone, only a period change
    // clears it.
    if (this._zoomRange && periodStartMs !== this._periodStartMs) {
      this._zoomRange = null;
    }
    this._renderChart(series, projection, periodStartMs);
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
      compact,
    });
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
    return formatTimeForSpan(timestamp, locale, spanMs, [
      { maxSpanMs: 2 * 24 * 60 * 60 * 1000, options: { hour: "2-digit", minute: "2-digit" } },
      { options: { month: "short", day: "numeric" } },
    ]);
  }

  _renderChart(series, projection, periodStartMs) {
    // Anchor the left edge at the period's true start (R0), not just
    // wherever the first real bucket happens to fall — symmetric with
    // using the period end for the right edge (via projection). Without
    // this, a period whose cost tracking began partway through (like
    // this month, since native tracking was only just wired up) shows a
    // truncated chart instead of the full period, which is exactly what
    // makes day-to-day usage comparison useful. Before real tracking
    // began, cost genuinely was 0 (not unknown), so R0 is accurate here,
    // not a guess filling a data gap.
    if (periodStartMs != null && series.length && periodStartMs < series[0].x) {
      series = [{ x: periodStartMs, y: 0 }, ...series];
    }

    this._series = series;
    this._projection = projection;
    this._periodStartMs = periodStartMs;

    if (series.length < 2) {
      this._chartEl.innerHTML = `<div class="message">Not enough data yet for this period.</div>`;
      this._series = undefined;
      this._projection = undefined;
      return;
    }

    const { width, height } = measureChartBox(this._chartEl);
    const { left: padLeft, right: padRight, top: padTop, bottom: padBottom } = CHART_PADDING;

    const xs = series.map((p) => p.x);
    const dataMinX = Math.min(...xs);
    const dataMaxX = Math.max(...xs);
    const dataMaxY = Math.max(...series.map((p) => p.y), 0.0001);

    // With a projection, the period end (not just the last real data
    // point) is the natural right edge, and the axis needs to fit
    // whichever is bigger — actual so far, or the projected total. When
    // zoomed, the domain becomes the zoom window itself, and the Y-axis
    // rescales to just what's visible in it — matching HA's confirmed
    // dataZoom filterMode behavior (ha-chart-base.ts) rather than keeping
    // the full-range max while zoomed in on a small slice of it.
    let domainMinX, domainMaxX, yMaxWithProjection, tickRangeStartMs, tickRangeEndMs;
    if (this._zoomRange) {
      domainMinX = this._zoomRange.startMs;
      domainMaxX = this._zoomRange.endMs;
      const visiblePoints = series.filter((p) => p.x >= domainMinX && p.x <= domainMaxX);
      const yCandidates = (visiblePoints.length ? visiblePoints : series).map((p) => p.y);
      // Only let the projection influence the zoomed Y-max if its endpoint
      // actually falls inside the zoomed window — otherwise an off-screen
      // projected total (hidden by the clip-path below anyway) would
      // needlessly stretch the axis of a zoomed-in view, working against
      // the point of zooming in for a closer look.
      if (projection && projection.endMs >= domainMinX && projection.endMs <= domainMaxX) {
        yCandidates.push(projection.total);
      }
      yMaxWithProjection = Math.max(...yCandidates, 0.0001);
      tickRangeStartMs = domainMinX;
      tickRangeEndMs = domainMaxX;
    } else {
      domainMinX = dataMinX;
      domainMaxX = projection ? projection.endMs : dataMaxX + (dataMaxX - dataMinX || 1) * 0.04;
      yMaxWithProjection = projection ? Math.max(dataMaxY, projection.total) : dataMaxY;
      tickRangeStartMs = domainMinX;
      tickRangeEndMs = projection ? projection.endMs : dataMaxX;
    }
    const { axisMax: domainMaxY, tickSpacing } = niceAxisScale(yMaxWithProjection, 5);

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

    // A straight reference line spanning the *whole* period at the
    // constant rate implied by the projection (period start, R0, to
    // period end, projected total) — not just a tail continuing from the
    // last actual point. Since the projection itself is that same
    // constant rate extended forward, this line passes exactly through
    // "now" on the actual series too, so days where the actual (blue)
    // line runs above it spent faster than the projected average pace,
    // and below it spent slower — the point of drawing it full-span.
    const projectionLine = projection
      ? `<polyline points="${scaleX(periodStartMs ?? dataMinX).toFixed(1)},${scaleY(0).toFixed(1)} ${scaleX(
          projection.endMs
        ).toFixed(1)},${scaleY(projection.total).toFixed(1)}" fill="none" stroke="var(--warning-color)" stroke-width="1.5" stroke-dasharray="6,8"></polyline>`
      : "";

    const yGridlines = renderYGridlines({
      domainMaxY,
      tickSpacing,
      scaleY,
      padLeft,
      width,
      padRight,
      formatValue: (v) => this._formatCurrency(v, true),
    });

    // Ticks at evenly-spaced *timestamps* across the plotted domain, not
    // evenly-spaced indices into `series` — those aren't the same thing
    // once a projection extends the domain well past the real data (e.g.
    // "Today" at noon, plotted out to midnight): picking indices out of
    // only the real (so far, first-half-of-the-day) series bunches every
    // interior tick into the already-elapsed portion, then jumps straight
    // to the far edge for the last one. The right edge is the period end
    // when there's a projection, otherwise the last actual point.
    //
    // Uses the same DEFAULT_TICK_COUNT and the same evenly-spaced-in-time
    // algorithm as energy-cost-breakdown-card.js's bar chart, so the two
    // cards' x-axes land on the same dates/times for the same period
    // instead of each picking its own count independently. Snapped onto
    // the real bucket grid (inferred the same way the breakdown card
    // infers its padding step) so labels land on round times like
    // "5:00 AM" — splitting the domain into equal fractions alone would
    // land on whatever arbitrary time each fraction happens to be (e.g.
    // "4:48 AM" for a 24-hour domain split 5 ways).
    const step = inferFixedStepMs(series.map((p) => p.x));
    const idealTicks = selectEvenTimestamps(tickRangeStartMs, tickRangeEndMs, DEFAULT_TICK_COUNT);
    // Only the interior ticks get snapped — the first and last are pinned
    // exactly at tickRangeStartMs/tickRangeEndMs (e.g. the real period end, often
    // 23:59:59.999) on purpose, and rounding that to the nearest step
    // could overshoot past it (23:59:59.999 rounds *up* to next midnight
    // at an hourly step), turning a correct "11:59 PM" edge label into a
    // wrong "12:00 AM".
    const tickTimestamps = step
      ? [
          ...new Set(
            idealTicks.map((t, i) =>
              i === 0 || i === idealTicks.length - 1 ? t : snapToStep(t, domainMinX, step)
            )
          ),
        ]
      : idealTicks;
    const xTicks = tickTimestamps
      .map((t, i, all) => {
        const x = scaleX(t).toFixed(1);
        const anchor = i === 0 ? "start" : i === all.length - 1 ? "end" : "middle";
        return `<text x="${x}" y="${height - 6}" text-anchor="${anchor}" class="axis-label">${this._formatTime(t)}</text>`;
      })
      .join("");

    // Vertical gradient area fill (denser near the line, fading toward the
    // baseline) rather than a flat opacity — matches HA's Energy panel
    // "Power sources" line+area chart (power-sources-graph-data.ts: 0.75
    // opacity at the line down to 0.25 at the baseline). Lower confidence
    // than the bar-chart styling above: no native Energy-dashboard chart
    // is this exact shape (cumulative currency-over-time), so this is an
    // extrapolation from a differently-shaped chart, not a direct match —
    // worth a close look once deployed. Gradient id is safely scoped to
    // this card instance's own shadow root, so no cross-instance collision
    // even with multiple cards of this type on one dashboard.
    // Zooming changes domainMinX/domainMaxX to the zoom window, so a point
    // outside it now maps to a pixel outside the plot rect rather than
    // being excluded from the series — the clip-path is what actually
    // hides that overflow (nothing needs it while unzoomed, since the
    // domain already spans the full series then, but applying it
    // unconditionally is simpler than branching the markup).
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
        <g clip-path="url(#plot-clip)">
          <polygon points="${areaPoints}" fill="url(#area-fill)"></polygon>
          <polyline points="${linePoints}" fill="none" stroke="var(--primary-color)" stroke-width="2"></polyline>
          ${projectionLine}
        </g>
        ${xTicks}
        <line class="hover-line" x1="0" y1="${padTop}" x2="0" y2="${height - padBottom}" stroke="var(--info-color)" stroke-width="1" stroke-dasharray="3,3" visibility="hidden"></line>
        <circle class="hover-dot" r="4" fill="var(--info-color)" visibility="hidden"></circle>
        <rect class="zoom-select-rect" fill="var(--info-color)" opacity="0.15" visibility="hidden"></rect>
      </svg>
      <div class="tooltip" hidden></div>
      <button type="button" class="zoom-reset" ${this._zoomRange ? "" : "hidden"}>Reset zoom</button>
    `;

    this._svgEl = this._chartEl.querySelector("svg");
    this._hoverLine = this._chartEl.querySelector(".hover-line");
    this._hoverDot = this._chartEl.querySelector(".hover-dot");
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

    const rect = this._svgEl.getBoundingClientRect();
    const { width, height } = this._chartBounds;

    const relX = (e.clientX - rect.left) / rect.width;
    const viewBoxX = relX * width;
    const targetX = this._viewBoxXToMs(viewBoxX);

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
    this._dragStartMs = undefined;
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

    // Don't commit a zoom into an empty range — no real point and no
    // visible projection endpoint inside it.
    const hasVisibleData =
      this._series.some((p) => p.x >= startMs && p.x <= endMs) ||
      (this._projection && this._projection.endMs >= startMs && this._projection.endMs <= endMs);
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
      this._dragStartMs = undefined;
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
    if (this._tooltipEl) this._tooltipEl.hidden = true;
  }

  // ms → viewBox-x and back, using the chart's current (possibly
  // zoomed) domain — shared by hover, drag-to-zoom start/end conversion,
  // and redrawing the drag-selection rect.
  _viewBoxXToMs(viewBoxX) {
    const { padLeft, padRight, width, domainMinX, domainMaxX } = this._chartBounds;
    return domainMinX + ((viewBoxX - padLeft) / (width - padLeft - padRight)) * (domainMaxX - domainMinX);
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
    return step ? step * 2 : 3 * 60 * 60 * 1000;
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
}

customElements.define("energy-cost-card", EnergyCostCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "energy-cost-card",
  name: "Energy Cost (Combined Grid)",
  description:
    "Cumulative grid cost so far, summed across all configured grid sources, synced to the Energy dashboard's date picker.",
});
