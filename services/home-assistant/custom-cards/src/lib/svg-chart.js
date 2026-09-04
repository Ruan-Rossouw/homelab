// Shared SVG chart infrastructure: sizing, resize handling, and axis
// gridlines. Deliberately stops there — how to draw the data (line+area
// with point hover vs. discrete bars with slot hover) stays per-card. See
// ../../CLAUDE.md "Minimizing duplication" for why the split lands here.

// top: 14, not 10 — leaves headroom for the y-axis unit-name label (see
// renderYGridlines' axisName) that now sits just above the topmost
// gridline, matching HA's own grid.top: 15 (energy-chart-options.ts
// getCommonOptions) rather than the plot area running edge-to-edge.
//
// No `left` here — unlike the other three sides, the left margin has to
// fit whatever the y-axis's actual tick labels currently need (a "1.5K"
// max is wider than a "40" max), so it's computed per-render by
// computeYAxisLeftPadding below instead of reserved as a flat constant.
// See that function's comment for why a fixed value was wrong.
export const CHART_PADDING = { right: 12, top: 14, bottom: 24 };

// Font used to measure y-axis label width — matches card-shell.js's
// .axis-label rule (Roboto/Noto, HA's --ha-font-size-s var). Canvas
// measureText can't read a CSS custom property, so this hardcodes that
// var's fallback value (12px), which is also what it resolves to in HA's
// default theme — a deliberate fixed-value approximation for sizing
// purposes, not pixel-perfect under every possible theme override.
const AXIS_LABEL_FONT = "12px Roboto, Noto, sans-serif";

let _measureCtx;
export function measureTextWidth(text, font = AXIS_LABEL_FONT) {
  if (!_measureCtx) {
    _measureCtx = document.createElement("canvas").getContext("2d");
  }
  _measureCtx.font = font;
  return _measureCtx.measureText(text).width;
}

// Sizes the left margin to whatever the y-axis's actual tick labels need
// for the current render, instead of a flat generous reservation that
// wastes space when the labels are short (a "40"/"R 40" case) and could in
// principle clip when they're long. Matches HA's real behavior: its chart
// grid uses ECharts' `containLabel: true` (confirmed via
// energy-chart-options.ts's getCommonOptions: `grid: { top: 15, bottom: 0,
// left: 1, right: 1, containLabel: true }`), which auto-fits the plot area
// to the actual rendered label widths rather than reserving fixed space
// regardless of content — the flat 56px this replaced was the "wasted left
// space on mobile" the user reported.
export function computeYAxisLeftPadding({ domainMaxY, tickSpacing, formatValue, minPadding = 24 }) {
  const tickCount = Math.round(domainMaxY / tickSpacing);
  const widths = Array.from({ length: tickCount + 1 }, (_, i) => measureTextWidth(formatValue(i * tickSpacing)));
  // +6 matches renderYGridlines' existing 6px gap between a label's right
  // edge and the gridline (`x="${padLeft - 6}"`); +2 more so text doesn't
  // sit flush against the card's own edge. HA's own containLabel margin is
  // tighter still (`left: 1`), but that's ECharts sizing its own rendered
  // label element exactly — this is a hand-measured estimate, not that.
  return Math.max(minPadding, Math.ceil(Math.max(...widths, 0)) + 8);
}

// Screen-space pixel threshold a mouse drag must clear before it commits to
// a zoom range rather than being treated as a plain click — shared so both
// cards agree on what counts as "an intentional drag."
export const DRAG_ZOOM_THRESHOLD_PX = 8;

// Sections view reserves a fixed-height box via grid_rows and clips
// anything taller than it, rather than growing to fit content the way
// masonry view does — so prefer the container's actual measured height,
// falling back to a width-based formula only when no real height is
// available yet (e.g. masonry view, or before first layout). See
// ../../CLAUDE.md "Sections-view vs. masonry-view height".
export function measureChartBox(chartEl) {
  const width = chartEl.clientWidth || 600;
  const height = chartEl.clientHeight || Math.max(width / 2, 200);
  return { width, height };
}

// Match the viewBox to the container's real pixel box so the coordinate
// system is 1:1 with CSS pixels on both axes, and debounce through rAF so
// a continuous drag-resize doesn't re-render on every tick. See
// ../../CLAUDE.md "SVG stretch distortion" for why an untracked resize
// (preserveAspectRatio="none" against a fixed viewBox) is a real bug, not
// just a nice-to-have.
export function observeChartResize(chartEl, onResize) {
  let frame;
  const observer = new ResizeObserver(() => {
    if (frame) {
      cancelAnimationFrame(frame);
    }
    frame = requestAnimationFrame(() => {
      frame = undefined;
      onResize();
    });
  });
  observer.observe(chartEl);
  return observer;
}

// Solid gridlines at each clean tick-spacing multiple up to the nice axis
// max — matches ha-chart-base's ~5-gridline splitNumber and its solid
// (non-dashed) splitLine style, without hardcoding "divide by 4" (which
// doesn't line up with a tickSpacing that isn't axisMax/4).
// axisName (optional): the unit, rendered ONCE just above the topmost
// gridline instead of on every tick — matches HA's real yAxis config
// (energy-chart-options.ts getCommonOptions: `yAxis: { name: unit, nameGap:
// 2, nameTextStyle: { align: "left" } }`, ECharts' default nameLocation
// "end" puts a value axis's name above its max). formatValue should return
// a bare number with no unit for this to read correctly (see format.js's
// formatCurrency: pass `symbol: ""` and it drops the unit/leading space) —
// per-tick labels stay bare, the name carries the unit alone.
export function renderYGridlines({ domainMaxY, tickSpacing, scaleY, padLeft, width, padRight, formatValue, axisName }) {
  const tickCount = Math.round(domainMaxY / tickSpacing);
  const gridlines = Array.from({ length: tickCount + 1 }, (_, i) => i * tickSpacing)
    .map((v) => {
      const y = scaleY(v).toFixed(1);
      return `
        <line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" stroke="var(--divider-color)" stroke-width="1"></line>
        <text x="${padLeft - 6}" y="${y}" text-anchor="end" dominant-baseline="middle" class="axis-label">${formatValue(v)}</text>
      `;
    })
    .join("");
  const nameLabel = axisName
    ? `<text x="${padLeft}" y="${(scaleY(domainMaxY) - 2).toFixed(1)}" text-anchor="start" class="axis-label">${axisName}</text>`
    : "";
  return gridlines + nameLabel;
}

// Solid vertical gridlines at each x-axis tick position — matches
// ha-chart-base.ts's own defaulting for any time-type xAxis
// (`_createOptions`: `splitLine: { show: true }` merged in ahead of the
// caller's axis config, never overridden off by the Energy dashboard's own
// xAxis options) plus its `timeAxis` theme block
// (`splitLine: { show: true, lineStyle: { color: --divider-color } }`) —
// same solid --divider-color treatment as the Y gridlines above, just on
// the other axis. Takes the already-computed pixel x for each tick
// (callers already have these from building their own tick labels) rather
// than timestamps, so it works identically for the breakdown card's
// index-based ticks and the cost card's timestamp-based ones.
export function renderXGridlines({ tickXs, padTop, padBottom, height }) {
  const y2 = (height - padBottom).toFixed(1);
  return tickXs
    .map(
      (x) =>
        `<line x1="${x.toFixed(1)}" y1="${padTop}" x2="${x.toFixed(1)}" y2="${y2}" stroke="var(--divider-color)" stroke-width="1"></line>`
    )
    .join("");
}
