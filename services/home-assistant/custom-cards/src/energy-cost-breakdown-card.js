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
import { formatCurrency, formatTimeForSpan, haStyleTimeTiers } from "./lib/format.js";
import {
  CHART_PADDING,
  measureChartBox,
  observeChartResize,
  renderYGridlines,
  renderXGridlines,
  DRAG_ZOOM_THRESHOLD_PX,
} from "./lib/svg-chart.js";
import { selectLabelIndexesForTimestamps, DEFAULT_TICK_COUNT, inferFixedStepMs } from "./lib/tick-labels.js";
import { createPointerPin } from "./lib/pointer-interaction.js";

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
          <div class="chart"></div>
        </ha-card>
      `;
    }

    const firstRender = !this._headerEl;

    this._headerEl = this.shadowRoot.querySelector(".header");
    this._chartEl = this.shadowRoot.querySelector(".chart");
    // See energy-cost-card.js: HA's own energy-usage-graph card only shows
    // a header when a title is explicitly configured, no default fallback.
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
      return;
    }

    // Each bucket stands alone here (unlike energy-cost-card.js's running
    // total), since this card shows discrete per-period cost, not a
    // cumulative trend.
    const costByBucketStart = sumCostByBucket(stats, costStatIds);

    const buckets = [...costByBucketStart.keys()]
      .sort((a, b) => a - b)
      .map((start) => ({ x: start, y: costByBucketStart.get(start) }));

    // Pad the tail with zero-cost placeholder buckets out to the period's
    // true end. Without this, a period still in progress (e.g. "Today")
    // stops drawing at whatever hour it currently is, while
    // energy-cost-card.js's line chart already extends to the full period
    // via its projection — the two charts otherwise end up spanning
    // visibly different widths side by side. A future bucket's cost really
    // is 0 (nothing has happened there yet), unlike a historical gap
    // before tracking existed, so only the tail gets this treatment, not
    // the start. inferFixedStepMs bails (returns undefined) for a
    // month-bucketed year view, whose variable-length buckets (28-31
    // days) this fixed-step arithmetic would drift on.
    const step = inferFixedStepMs(buckets.map((b) => b.x));
    if (step && data.end) {
      const periodEndMs = data.end.getTime();
      let nextStart = buckets[buckets.length - 1].x + step;
      while (nextStart < periodEndMs) {
        buckets.push({ x: nextStart, y: 0 });
        nextStart += step;
      }
    }

    const periodStartMs = data.start ? data.start.getTime() : undefined;
    const periodEndMs = data.end ? data.end.getTime() : undefined;
    // An active zoom's timestamps almost certainly don't make sense against
    // a completely different selected period (e.g. the dashboard's
    // date-picker switching from "This month" to "Last year") — a live
    // stats refresh for the *same* period should leave the zoom alone,
    // only a period change clears it.
    if (this._zoomRange && (periodStartMs !== this._periodStartMs || periodEndMs !== this._periodEndMs)) {
      this._zoomRange = null;
    }
    this._renderChart(buckets, periodStartMs, periodEndMs);
  }

  _formatCurrency(value, compact = false) {
    return formatCurrency(value, {
      symbol: this._config.currency_symbol || "R",
      locale: this._hass?.locale?.language,
      compact,
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
    const spanMs = this._chartBounds
      ? this._chartBounds.dataMaxX - this._chartBounds.dataMinX
      : 0;
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
      compact: true,
    });
  }

  _renderChart(buckets, periodStartMs, periodEndMs) {
    this._buckets = buckets;
    this._periodStartMs = periodStartMs;
    this._periodEndMs = periodEndMs;

    // Unlike a line (which needs 2 points for a segment), a single bar
    // is a perfectly meaningful chart on its own — only bail if there's
    // truly nothing to show.
    if (!buckets.length) {
      this._chartEl.innerHTML = `<div class="message">Not enough data yet for this period.</div>`;
      this._buckets = undefined;
      this._visibleBuckets = undefined;
      return;
    }

    // this._buckets stays the full, unfiltered backing array (needed by
    // both the resize observer and Reset) — only the locally-scoped
    // render/hover view narrows to the zoomed window. See _onPointerUp for
    // how a drag sets this._zoomRange.
    let renderBuckets = buckets;
    if (this._zoomRange) {
      const filtered = buckets.filter((b) => b.x >= this._zoomRange.startMs && b.x <= this._zoomRange.endMs);
      if (filtered.length) {
        renderBuckets = filtered;
      } else {
        // The zoomed window no longer overlaps the data (e.g. it was set
        // against a since-changed period) — fall back to the full view
        // rather than render an empty chart with a Reset button that
        // wouldn't actually change anything.
        this._zoomRange = null;
      }
    }
    this._visibleBuckets = renderBuckets;

    const { width, height } = measureChartBox(this._chartEl);
    const { left: padLeft, right: padRight, top: padTop, bottom: padBottom } = CHART_PADDING;

    const xs = renderBuckets.map((b) => b.x);
    const dataMinX = Math.min(...xs);
    const dataMaxX = Math.max(...xs);
    const dataMaxY = Math.max(...renderBuckets.map((b) => b.y), 0.0001);

    const { axisMax: domainMaxY, tickSpacing } = niceAxisScale(dataMaxY, 5);

    const plotLeft = padLeft;
    const plotWidth = width - padLeft - padRight;
    const slotWidth = plotWidth / renderBuckets.length;
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

    // Rounded top corners only (square bottom), matching HA's own Energy
    // bar charts (hui-energy-usage-graph-card.ts: borderRadius [4,4,0,0]) —
    // <rect> only supports a uniform rx/ry on all four corners, so this
    // needs an explicit <path>. Translucent fill + opaque same-color
    // border mimics HA's getEnergyColor() trick (base color + hex alpha
    // 0x7F ≈ 0.5 for the fill, base color at full opacity for the border,
    // 1.5px width matching HA's theme-wide barBorderWidth).
    const bars = renderBuckets
      .map((b, i) => {
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
        const path =
          `M ${barLeft.toFixed(1)},${(barTop + r).toFixed(1)} ` +
          `Q ${barLeft.toFixed(1)},${barTop.toFixed(1)} ${(barLeft + r).toFixed(1)},${barTop.toFixed(1)} ` +
          `L ${(barRight - r).toFixed(1)},${barTop.toFixed(1)} ` +
          `Q ${barRight.toFixed(1)},${barTop.toFixed(1)} ${barRight.toFixed(1)},${(barTop + r).toFixed(1)} ` +
          `L ${barRight.toFixed(1)},${barBottom.toFixed(1)} ` +
          `L ${barLeft.toFixed(1)},${barBottom.toFixed(1)} Z`;
        return `<path d="${path}" fill="var(--energy-grid-consumption-color, #dc7500)" fill-opacity="0.5" stroke="var(--energy-grid-consumption-color, #dc7500)" stroke-width="1.5"></path>`;
      })
      .join("");

    const yGridlines = renderYGridlines({
      domainMaxY,
      tickSpacing,
      scaleY,
      padLeft,
      width,
      padRight,
      formatValue: (v) => this._formatCompactNumber(v),
      axisName: this._config.currency_symbol || "R",
    });

    // Evenly spaced x labels rather than just first/middle/last, snapped
    // to the nearest real bucket for each ideal evenly-spaced timestamp —
    // uses the same DEFAULT_TICK_COUNT and the same period bounds
    // (data.start/data.end, not just this chart's own first/last bucket)
    // as energy-cost-card.js's line chart, so the two cards' x-axes land
    // on the same dates/times for the same period. When zoomed, the tick
    // bounds become the zoom window itself rather than the full period.
    const tickStartMs = this._zoomRange ? this._zoomRange.startMs : periodStartMs ?? dataMinX;
    const tickEndMs = this._zoomRange ? this._zoomRange.endMs : periodEndMs ?? dataMaxX;
    const labelIndexes = selectLabelIndexesForTimestamps(xs, tickStartMs, tickEndMs, DEFAULT_TICK_COUNT);
    const xTicks = labelIndexes
      .map((i) => {
        const anchor = i === 0 ? "start" : i === renderBuckets.length - 1 ? "end" : "middle";
        return `<text x="${scaleX(i).toFixed(1)}" y="${height - 6}" text-anchor="${anchor}" class="axis-label">${this._formatTime(renderBuckets[i].x)}</text>`;
      })
      .join("");

    // Vertical gridlines at the same ticks as the x-axis labels above —
    // matches ha-chart-base.ts's own default for any time-type xAxis
    // (verified: _createOptions force-defaults splitLine.show:true, never
    // overridden off by the Energy dashboard's own xAxis options; the
    // timeAxis theme block confirms solid --divider-color, same as the Y
    // gridlines).
    const xGridlines = renderXGridlines({
      tickXs: labelIndexes.map((i) => scaleX(i)),
      padTop,
      padBottom,
      height,
    });

    // Mouse-drag-to-zoom selection overlay (see _onPointerDown/_onPointerMove)
    // and a Reset chip shown only while zoomed — both mirror HA's own
    // dataZoom + restart-icon reset button (ha-chart-base.ts), hand-rolled
    // here since this codebase doesn't use ECharts. Touch keeps tap-to-pin
    // only (see lib/pointer-interaction.js) — no touch-zoom in this version.
    //
    // .hover-line is the crosshair through the hovered/pinned bar's x
    // position — matches HA's own axisPointer (ha-chart-base.ts theme:
    // `lineStyle: { color: --info-color }`, dashed by ECharts' own
    // axisPointer default), and gives the tooltip a visible anchor to the
    // selected bar instead of floating disconnected above it. No
    // background-highlight rect on the hovered bar — verified HA's own
    // charts don't draw one either, only the crosshair + tooltip.
    //
    // .scrub-handle is the small draggable nub HA shows on touch devices at
    // the axis-pointer's x position while the tooltip is pinned — verified
    // against ha-chart-base.ts's "show axis pointer handle on touch
    // devices" block (axisPointer.handle: { color: --primary-color, margin:
    // 0, size: 20 }, shown on the chart's "showTip" event, hidden on a real
    // "hideTip"). ECharts' actual handle icon is a custom pin/diamond
    // shape from its own bundled asset — approximated here as a plain
    // filled circle at the same color/size/position, since replicating the
    // exact icon path would mean pulling in ECharts itself, which this
    // codebase deliberately doesn't depend on. The underlying scrub-by-drag
    // behavior already works via the existing touch pointermove handling
    // below — this is purely the visual affordance that was missing.
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
    // Touch only — matches HA's own axisPointer.handle, gated behind
    // _isTouchDevice in ha-chart-base.ts, never shown for mouse/pen.
    if (this._scrubHandle) {
      if (e.pointerType === "touch") {
        this._scrubHandle.setAttribute("cx", cx.toFixed(1));
        this._scrubHandle.setAttribute("cy", (height - padBottom).toFixed(1));
        this._scrubHandle.setAttribute("visibility", "visible");
      } else {
        this._scrubHandle.setAttribute("visibility", "hidden");
      }
    }

    // Bold date header + a colored-dot value row — matches the shape of
    // HA's own tooltip (energy-chart-options.ts formatTooltip: bold <h4>
    // period header, one <ha-chart-tooltip-marker>-prefixed row per
    // series), adapted for this card's single series (no "Total" row,
    // since HA's own total line only appears when there's more than one
    // series to sum).
    this._tooltipEl.hidden = false;
    this._tooltipEl.innerHTML = `
      <div class="tooltip-header">${this._formatTime(bucket.x)}</div>
      <div class="tooltip-row"><span class="tooltip-dot" style="background:var(--energy-grid-consumption-color, #dc7500)"></span>${this._formatCurrency(bucket.y)}</div>
    `;
    this._tooltipEl.style.left = `${(cx / width) * rect.width}px`;
    this._tooltipEl.style.top = `${(barY / height) * rect.height}px`;
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

    // Don't commit a zoom into a range with nothing in it — e.g. a drag
    // that lands entirely inside a gap wider than any real bucket.
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
    return step ? step * 2 : 2 * 24 * 60 * 60 * 1000;
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
}

customElements.define("energy-cost-breakdown-card", EnergyCostBreakdownCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "energy-cost-breakdown-card",
  name: "Energy Cost Breakdown",
  description:
    "Per-bucket grid cost bars (hour/day/month depending on the Energy dashboard's selected period), synced to the date picker.",
});
